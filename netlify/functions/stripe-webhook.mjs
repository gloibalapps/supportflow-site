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
import { supa, recomputeLicence, PRODUCTS, emailSub } from "../lib/licence.mjs";
import { isTrackerProduct } from "../lib/tracker.mjs";

const TOLERANCE_SECONDS = 300; // reject anything claiming to be older than 5 minutes

// Kept in step with CREDIT_PACKS in invoice-credit-rules.js.
const PACK_CREDITS = Object.freeze({ casual: 10, popular: 30, value: 100, lifetime: 99999 });
// Fallback only, for sessions created without metadata: full-price amounts
// in cents. A discounted session without metadata won't match, and is
// retried/logged rather than guessed at.
const AMOUNT_TO_PACK = Object.freeze({ 799: "casual", 1999: "popular", 3999: "value", 4900: "lifetime" });

// STRIPE_WEBHOOK_SECRET may hold one whsec_ value, or several separated by
// commas/spaces (e.g. the live and test-mode endpoint secrets, or old + new
// while rolling). Surrounding quotes/whitespace from copy-paste are stripped:
// a stray newline in the env value makes every HMAC miss.
function webhookSecrets() {
  return String(process.env.STRIPE_WEBHOOK_SECRET || "")
    .split(/[\s,]+/)
    .map((s) => s.trim().replace(/^['"]|['"]$/g, ""))
    .filter(Boolean);
}

// Returns { ok: true } or { ok: false, reason } so the logs say WHY a
// delivery was rejected (never the secret itself).
function verifyStripeSignature(payload, header, secrets) {
  if (!header) return { ok: false, reason: "no Stripe-Signature header" };
  let timestamp = null;
  const signatures = [];
  // Stripe can send several v1 entries (e.g. while a signing secret is being
  // rolled), so collect them all instead of keeping only the last one.
  for (const part of header.split(",")) {
    const i = part.indexOf("=");
    if (i < 0) continue;
    const k = part.slice(0, i).trim();
    const v = part.slice(i + 1).trim();
    if (k === "t") timestamp = v;
    else if (k === "v1" && /^[0-9a-f]{64}$/i.test(v)) signatures.push(Buffer.from(v, "hex"));
  }
  if (!timestamp || !signatures.length) return { ok: false, reason: "header has no t / v1" };

  const age = Math.abs(Date.now() / 1000 - Number(timestamp));
  if (!Number.isFinite(age) || age > TOLERANCE_SECONDS) return { ok: false, reason: `timestamp outside ${TOLERANCE_SECONDS}s tolerance` };

  for (const secret of secrets) {
    const expected = crypto.createHmac("sha256", secret).update(`${timestamp}.${payload}`, "utf8").digest();
    // constant-time comparison, so a timing attack can't be used to guess the
    // correct signature one byte at a time
    if (signatures.some((sig) => sig.length === expected.length && crypto.timingSafeEqual(sig, expected))) {
      return { ok: true };
    }
  }
  const badFormat = secrets.filter((s) => !s.startsWith("whsec_")).length;
  return {
    ok: false,
    reason: badFormat
      ? `STRIPE_WEBHOOK_SECRET doesn't look like a webhook signing secret (expected whsec_...; ${badFormat} of ${secrets.length} value(s) don't)`
      : `signature mismatch against ${secrets.length} configured secret(s): STRIPE_WEBHOOK_SECRET isn't this endpoint's signing secret (check live vs test mode and that it was copied from this exact endpoint)`,
  };
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

// ---------------------------------------------------------------------------
// Device licences (One device A$49 / Phone and computer A$69 / A$29 upgrade).
// Created by netlify/functions/licence.mjs with metadata.kind = "licence".
// This webhook is the ONLY thing that marks a Google account as paid; the
// browser's ?licence=success return never does. See LICENSING.md.
// ---------------------------------------------------------------------------
async function handleLicenceSession(session) {
  const email = session.customer_details?.email || session.customer_email || null;
  // No Google sub (e.g. a payment link): park it under "email:<address>"; the
  // buyer's next verified Google sign-in with that address adopts it.
  const sub = session.metadata?.google_sub || session.client_reference_id || (email ? emailSub(email) : null);
  const product = session.metadata?.product;
  // Payment tracker unlocks (metadata.kind = "tracker") are recorded in the
  // same licence_payments ledger with product tracker_base / tracker_addon / tracker_full, so
  // refunds and disputes reverse them through handleLicenceReversal below.
  if (!sub || !(PRODUCTS[product] || (session.metadata?.kind === "tracker" && isTrackerProduct(product)))) {
    console.error(`stripe-webhook: licence session ${session.id} missing google_sub/email/product`);
    return;
  }
  // Make sure the licence row exists (unpaid) so the payment can reference it.
  await supa("licences?on_conflict=google_sub", {
    method: "POST",
    body: { google_sub: sub, ...(email ? { email } : {}), updated_at: new Date().toISOString() },
    prefer: "resolution=merge-duplicates,return=minimal",
  });
  const inserted = await supa("licence_payments?on_conflict=stripe_session_id", {
    method: "POST",
    body: {
      stripe_session_id: session.id,
      stripe_payment_intent_id: typeof session.payment_intent === "string" ? session.payment_intent : session.payment_intent?.id || null,
      google_sub: sub,
      product,
      amount_aud: (Number(session.amount_total) || 0) / 100,
      status: "paid",
    },
    prefer: "resolution=ignore-duplicates,return=representation",
  });
  if (!Array.isArray(inserted) || !inserted.length) {
    console.log(`stripe-webhook: licence session ${session.id} already recorded`);
  }
  // Recompute every time (idempotent): plan comes from what is still paid.
  const lic = await recomputeLicence(sub);
  console.log(`stripe-webhook: licence ${product} for ${sub} -> plan ${lic.plan} ${lic.status}`);
}

// Refunds and disputes: mark the payment and recompute. A refunded $49/$69
// drops the account back to unpaid (it locks on the next server check); a
// refunded $29 upgrade drops Phone and computer back to One device.
async function handleLicenceReversal(paymentIntentId, status) {
  if (!paymentIntentId) return;
  const rows = await supa(`licence_payments?stripe_payment_intent_id=eq.${encodeURIComponent(paymentIntentId)}&select=google_sub,status`);
  if (!rows?.length) return; // not a licence payment (credit pack / legacy)
  await supa(`licence_payments?stripe_payment_intent_id=eq.${encodeURIComponent(paymentIntentId)}`, {
    method: "PATCH", body: { status, updated_at: new Date().toISOString() }, prefer: "return=minimal",
  });
  for (const sub of new Set(rows.map((r) => r.google_sub))) {
    const lic = await recomputeLicence(sub);
    console.log(`stripe-webhook: payment ${paymentIntentId} ${status} -> ${sub} plan ${lic.plan} ${lic.status}`);
  }
}

async function handlePaidSession(session) {
  if (session.mode !== "payment") return; // nothing else is sold
  if (session.payment_status !== "paid" && session.payment_status !== "no_payment_required") {
    // Delayed payment methods: wait for async_payment_succeeded.
    return;
  }
  if (session.metadata?.kind === "licence" || session.metadata?.kind === "tracker") return handleLicenceSession(session);

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
    // Not one of ours (e.g. a Payment Link or a price sold outside the app on
    // the same Stripe account). Stripe would resend the identical payload, so
    // a 500 can never succeed and only shows up as a failed delivery: log it
    // for a manual look and acknowledge.
    console.error(`stripe-webhook: session ${session.id} isn't a SupportFlow credit pack or licence (amount ${session.amount_total}, metadata ${JSON.stringify(session.metadata || {})}); acknowledged without changes`);
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

  const secrets = webhookSecrets();
  const supaConfigured = process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_KEY;
  if (!secrets.length || !supaConfigured) {
    // Fail loudly in the logs, but return 500 rather than 200 — a 200 tells
    // Stripe "handled", and a silently-dropped event is worse than a retry.
    console.error("stripe-webhook: missing STRIPE_WEBHOOK_SECRET or Supabase env vars");
    return new Response("Not configured", { status: 500 });
  }

  const payload = await req.text();
  const sigHeader = req.headers.get("stripe-signature");

  const sig = verifyStripeSignature(payload, sigHeader, secrets);
  if (!sig.ok) {
    console.error(`stripe-webhook: signature verification failed: ${sig.reason}`);
    return new Response(`Invalid signature: ${sig.reason}`, { status: 400 });
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

      // Licence reversals. Register these events on the webhook endpoint too.
      case "charge.refunded": {
        const charge = event.data.object;
        // Only a full refund removes the licence; a partial goodwill refund doesn't.
        if (charge.refunded === true || Number(charge.amount_refunded) >= Number(charge.amount)) {
          await handleLicenceReversal(charge.payment_intent, "refunded");
        }
        break;
      }
      case "charge.dispute.created":
        await handleLicenceReversal(event.data.object.payment_intent, "disputed");
        break;
      case "charge.dispute.closed":
        if (event.data.object.status === "won") await handleLicenceReversal(event.data.object.payment_intent, "paid");
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
