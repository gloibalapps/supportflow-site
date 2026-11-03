// Stripe tells us here when a credit pack purchase has been paid. This is
// the one function that actually adds credits to someone's account — so it
// verifies Stripe's signature on every request rather than trusting whatever
// hits the endpoint. Skipping that check would let anyone POST a fake
// "payment succeeded" event and grant themselves free credits.
//
// Set in Netlify: Site configuration → Environment variables
//   STRIPE_SECRET_KEY      same restricted key as create-checkout.mjs
//   STRIPE_WEBHOOK_SECRET  whsec_..., shown once you register this endpoint
//                          in Stripe: Developers → Webhooks → Add endpoint
//                          → https://supportflow.work/.netlify/functions/stripe-webhook
//                          (event: checkout.session.completed, plus
//                          checkout.session.async_payment_succeeded if you
//                          enable delayed payment methods)
//   SUPABASE_URL           your project's URL, from Supabase: Settings -> API
//   SUPABASE_SERVICE_KEY   the service_role key (server-side only, never the anon key)
//
// Database objects used (see CREDIT-PACKS-MIGRATION.sql):
//   accounts.credit_balance, credit_purchases table, add_credits() RPC.

import crypto from "node:crypto";

const TOLERANCE_SECONDS = 300; // reject anything claiming to be older than 5 minutes

// Kept in step with CREDIT_PACKS in invoice-credit-rules.js.
const PACK_CREDITS = Object.freeze({ casual: 10, popular: 30, value: 100, lifetime: 99999 });
// Fallback only, for sessions created without metadata: full-price amounts
// in cents. A discounted session without metadata won't match, and is
// retried/logged rather than guessed at.
const AMOUNT_TO_PACK = Object.freeze({ 799: "casual", 1999: "popular", 3999: "value", 4900: "lifetime" });

function verifyStripeSignature(payload, header, secret) {
  if (!header) return false;
  const parts = Object.fromEntries(
    header.split(",").map((p) => p.split("=").map((s) => s.trim()))
  );
  const timestamp = parts.t;
  const signature = parts.v1;
  if (!timestamp || !signature) return false;

  const age = Math.abs(Date.now() / 1000 - Number(timestamp));
  if (!Number.isFinite(age) || age > TOLERANCE_SECONDS) return false;

  const expected = crypto
    .createHmac("sha256", secret)
    .update(`${timestamp}.${payload}`, "utf8")
    .digest("hex");

  // constant-time comparison, so a timing attack can't be used to guess the
  // correct signature one byte at a time
  const a = Buffer.from(expected, "hex");
  const b = Buffer.from(signature, "hex");
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

function supaHeaders(extra = {}) {
  return {
    apikey: process.env.SUPABASE_SERVICE_KEY,
    Authorization: `Bearer ${process.env.SUPABASE_SERVICE_KEY}`,
    "Content-Type": "application/json",
    ...extra,
  };
}

async function supabaseUpsert(table, row, onConflict) {
  const url = `${process.env.SUPABASE_URL}/rest/v1/${table}?on_conflict=${onConflict}`;
  const resp = await fetch(url, {
    method: "POST",
    headers: supaHeaders({ Prefer: "resolution=merge-duplicates,return=minimal" }),
    body: JSON.stringify(row),
  });
  if (!resp.ok) {
    const text = await resp.text().catch(() => "");
    throw new Error(`Supabase upsert failed on ${table}: ${resp.status} ${text}`);
  }
}

// Device refs (client_reference_id) are crypto.randomUUID() values and
// accounts.id is a uuid column; anything else can never be inserted.
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Makes sure the account row exists and links the Stripe customer to it (used
// by restore-purchase.mjs). checkout always creates a customer, so the link
// is always sent — but accounts.stripe_customer_id isn't created by any of the
// migrations in this repo. If the column is missing, PostgREST rejects the
// whole upsert and every purchase used to fail with a 500. Now the purchase is
// still credited and the missing column is logged.
async function ensureAccount(accountId, customer) {
  const row = { id: accountId, last_seen_at: new Date().toISOString() };
  const customerId = typeof customer === "string" ? customer : customer?.id;
  if (!customerId) return supabaseUpsert("accounts", row, "id");
  try {
    await supabaseUpsert("accounts", { ...row, stripe_customer_id: customerId }, "id");
  } catch (e) {
    if (!/stripe_customer_id/.test(String(e?.message))) throw e;
    console.warn("stripe-webhook: accounts.stripe_customer_id column is missing (run CREDIT-PACKS-MIGRATION.sql); crediting without the Stripe customer link");
    await supabaseUpsert("accounts", row, "id");
  }
}

// Records the purchase, keyed on the Stripe session id. Returns true only
// the first time a given session is seen — Stripe can deliver the same
// event more than once, and credits must never be added twice.
async function recordPurchaseOnce(row) {
  const url = `${process.env.SUPABASE_URL}/rest/v1/credit_purchases?on_conflict=stripe_session_id`;
  const resp = await fetch(url, {
    method: "POST",
    headers: supaHeaders({ Prefer: "resolution=ignore-duplicates,return=representation" }),
    body: JSON.stringify(row),
  });
  if (!resp.ok) {
    const text = await resp.text().catch(() => "");
    throw new Error(`Supabase insert failed on credit_purchases: ${resp.status} ${text}`);
  }
  const rows = await resp.json().catch(() => []);
  return Array.isArray(rows) && rows.length > 0;
}

async function deletePurchase(sessionId) {
  await fetch(
    `${process.env.SUPABASE_URL}/rest/v1/credit_purchases?stripe_session_id=eq.${encodeURIComponent(sessionId)}`,
    { method: "DELETE", headers: supaHeaders() }
  ).catch(() => {});
}

// Atomic increment via the add_credits RPC. Falls back to read-then-write
// if the RPC hasn't been created yet (PostgREST answers 404), or if the RPC
// returned 200 but the balance wasn't actually updated (can happen when an
// older version of the function exists in Supabase that only sets
// credits_expire_at without incrementing credit_balance).
async function addCredits(accountId, credits) {
  const base = process.env.SUPABASE_URL;
  const rpc = await fetch(`${base}/rest/v1/rpc/add_credits`, {
    method: "POST",
    headers: supaHeaders(),
    body: JSON.stringify({ p_account_id: accountId, p_credits: credits }),
  });
  if (rpc.ok) {
    // Verify the RPC actually updated credit_balance. An older version of the
    // function may exist in Supabase that only sets credits_expire_at without
    // touching credit_balance — in that case the webhook was silently treating
    // a no-credit update as success. Read back the balance and fall through to
    // the direct PATCH if it wasn't updated.
    const checkResp = await fetch(
      `${base}/rest/v1/accounts?id=eq.${encodeURIComponent(accountId)}&select=credit_balance`,
      { headers: supaHeaders() }
    );
    if (checkResp.ok) {
      const rows = await checkResp.json().catch(() => []);
      const balance = Number(rows?.[0]?.credit_balance) || 0;
      if (balance >= credits) return; // RPC updated the balance correctly
      // Balance is still 0 (or less than expected) — RPC ran but didn't help.
      console.warn(`stripe-webhook: add_credits RPC returned OK but credit_balance is ${balance} (expected >= ${credits}); using PATCH fallback`);
    } else {
      // Verification fetch failed — trust the RPC rather than risk double-credit.
      return;
    }
  } else if (rpc.status !== 404) {
    const text = await rpc.text().catch(() => "");
    throw new Error(`add_credits RPC failed: ${rpc.status} ${text}`);
  }

  console.warn("stripe-webhook: using non-atomic PATCH fallback to add credits");
  const cur = await fetch(
    `${base}/rest/v1/accounts?id=eq.${encodeURIComponent(accountId)}&select=credit_balance,credits_expire_at,free_credits_remaining`,
    { headers: supaHeaders() }
  );
  if (!cur.ok) throw new Error(`Couldn't read credit_balance: ${cur.status}`);
  const row = (await cur.json())?.[0] || {};
  // Same 30-day rule as the add_credits RPC: compound while the window is
  // open, start fresh once it has lapsed. Either way the window resets.
  const expireAt = row.credits_expire_at ? new Date(row.credits_expire_at) : null;
  const windowOpen = expireAt && expireAt.getTime() >= Date.now();
  const now = new Date();
  const update = {
    credit_balance: windowOpen ? (Number(row.credit_balance) || 0) + credits : credits,
    credits_expire_at: new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000).toISOString(),
    last_seen_at: now.toISOString(),
    ...(windowOpen ? {} : { free_credits_remaining: 0 }),
  };
  const patch = await fetch(`${base}/rest/v1/accounts?id=eq.${encodeURIComponent(accountId)}`, {
    method: "PATCH",
    headers: supaHeaders({ Prefer: "return=minimal" }),
    body: JSON.stringify(update),
  });
  if (!patch.ok) {
    const text = await patch.text().catch(() => "");
    throw new Error(`Couldn't update credit_balance: ${patch.status} ${text}`);
  }
}

// Lifetime licence: no schema change, just a balance that can't realistically
// run out and an expiry far in the future. check-status reports it as lifetime.
async function grantLifetime(accountId) {
  const base = process.env.SUPABASE_URL;
  const patch = await fetch(`${base}/rest/v1/accounts?id=eq.${encodeURIComponent(accountId)}`, {
    method: "PATCH",
    headers: supaHeaders({ Prefer: "return=minimal" }),
    body: JSON.stringify({
      credit_balance: 99999,
      credits_expire_at: "2099-01-01T00:00:00.000Z",
      last_seen_at: new Date().toISOString(),
      free_credits_remaining: 0,
    }),
  });
  if (!patch.ok) {
    const text = await patch.text().catch(() => "");
    throw new Error(`Couldn't grant lifetime licence: ${patch.status} ${text}`);
  }
}

async function handlePaidSession(session) {
  if (session.mode !== "payment") return; // nothing else is sold
  if (session.payment_status !== "paid" && session.payment_status !== "no_payment_required") {
    // Delayed payment methods: wait for async_payment_succeeded.
    return;
  }

  const accountId = session.client_reference_id;
  if (!accountId) {
    // Can't be retried into success, so log and acknowledge.
    console.error(`stripe-webhook: session ${session.id} has no client_reference_id`);
    return;
  }

  if (!UUID_RE.test(accountId)) {
    // Stripe resends the identical payload, so this can never succeed on retry.
    console.error(`stripe-webhook: session ${session.id} client_reference_id isn't a device ref (uuid); acknowledged without changes`);
    return;
  }

  const packName = session.metadata?.pack || AMOUNT_TO_PACK[session.amount_total];
  const credits = Number(session.metadata?.credits) || PACK_CREDITS[packName];
  if (!packName || !credits) {
    // Not one of ours (e.g. a Payment Link on the same Stripe account). A 500
    // can never succeed on retry, so log for a manual look and acknowledge.
    console.error(`stripe-webhook: session ${session.id} isn't a SupportFlow credit pack (amount ${session.amount_total}, metadata ${JSON.stringify(session.metadata || {})}); acknowledged without changes`);
    return;
  }

  // Make sure the account row exists before crediting it.
  await ensureAccount(accountId, session.customer);

  const isNew = await recordPurchaseOnce({
    account_id: accountId,
    // credit_purchases.pack only allows casual/popular/value; the hidden test
    // pack is recorded as casual (its 1 credit / A$0.50 tells it apart), and
    // the lifetime licence as value (its 99999 credits / A$49 tell it apart),
    // so no schema change is needed.
    pack: packName === "test" ? "casual" : packName === "lifetime" ? "value" : packName,
    credits,
    amount_aud: (Number(session.amount_total) || 0) / 100,
    stripe_session_id: session.id,
    purchased_at: new Date().toISOString(),
  });
  if (!isNew) {
    console.log(`stripe-webhook: session ${session.id} already credited, skipping`);
    return;
  }

  try {
    if (packName === "lifetime") await grantLifetime(accountId);
    else await addCredits(accountId, credits);
  } catch (e) {
    // Undo the purchase record so Stripe's retry can credit it properly,
    // instead of the retry seeing a "done" row and skipping.
    await deletePurchase(session.id);
    throw e;
  }
}

export default async (req) => {
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
  const supaConfigured = process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_KEY;
  if (!webhookSecret || !supaConfigured) {
    // Fail loudly in the logs, but return 500 rather than 200 — a 200 tells
    // Stripe "handled", and a silently-dropped event is worse than a retry.
    console.error("stripe-webhook: missing STRIPE_WEBHOOK_SECRET or Supabase env vars");
    return new Response("Not configured", { status: 500 });
  }

  const payload = await req.text();
  const sigHeader = req.headers.get("stripe-signature");

  if (!verifyStripeSignature(payload, sigHeader, webhookSecret)) {
    console.error("stripe-webhook: signature verification failed");
    return new Response("Invalid signature", { status: 400 });
  }

  let event;
  try {
    event = JSON.parse(payload);
  } catch {
    return new Response("Malformed payload", { status: 400 });
  }

  try {
    switch (event.type) {
      case "checkout.session.completed":
      case "checkout.session.async_payment_succeeded":
        await handlePaidSession(event.data.object);
        break;

      default:
        // Unhandled event types are fine to ignore — acknowledging with 200
        // stops needless retries.
        break;
    }
  } catch (e) {
    console.error("stripe-webhook: handler error", e);
    // Return 500 so Stripe retries — a purchase we failed to credit should
    // not be silently dropped.
    // The reason goes in the body too, so it shows in Stripe's delivery log
    // (Developers → Webhooks → event → Response) without opening Netlify logs.
    return new Response(`Internal error: ${String(e?.message || e).slice(0, 500)}`, { status: 500 });
  }

  return new Response(JSON.stringify({ received: true }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
};
