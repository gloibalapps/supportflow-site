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
const PACK_CREDITS = Object.freeze({ casual: 10, popular: 30, value: 100 });
// Fallback only, for sessions created without metadata: full-price amounts
// in cents. A discounted session without metadata won't match, and is
// retried/logged rather than guessed at.
const AMOUNT_TO_PACK = Object.freeze({ 799: "casual", 1999: "popular", 3999: "value" });

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
// only if the RPC hasn't been created yet (PostgREST answers 404).
async function addCredits(accountId, credits) {
  const base = process.env.SUPABASE_URL;
  const rpc = await fetch(`${base}/rest/v1/rpc/add_credits`, {
    method: "POST",
    headers: supaHeaders(),
    body: JSON.stringify({ p_account_id: accountId, p_credits: credits }),
  });
  if (rpc.ok) return;
  if (rpc.status !== 404) {
    const text = await rpc.text().catch(() => "");
    throw new Error(`add_credits RPC failed: ${rpc.status} ${text}`);
  }

  console.warn("stripe-webhook: add_credits RPC missing, using non-atomic fallback");
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

  const packName = session.metadata?.pack || AMOUNT_TO_PACK[session.amount_total];
  const credits = Number(session.metadata?.credits) || PACK_CREDITS[packName];
  if (!packName || !credits) {
    throw new Error(`Couldn't work out the credit pack for session ${session.id} (amount ${session.amount_total})`);
  }

  // Make sure the account row exists before crediting it.
  await supabaseUpsert("accounts", {
    id: accountId,
    ...(session.customer ? { stripe_customer_id: session.customer } : {}),
    last_seen_at: new Date().toISOString(),
  }, "id");

  const isNew = await recordPurchaseOnce({
    account_id: accountId,
    // credit_purchases.pack only allows casual/popular/value; the hidden test
    // pack is recorded as casual (its 1 credit / A$0.50 tells it apart).
    pack: packName === "test" ? "casual" : packName,
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
    await addCredits(accountId, credits);
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
    return new Response("Internal error", { status: 500 });
  }

  return new Response(JSON.stringify({ received: true }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
};
