// Stripe tells us here when a trial starts, converts, renews, fails, or gets
// cancelled. This is the one function that actually decides whether the app
// unlocks for someone — so it verifies Stripe's signature on every request
// rather than trusting whatever hits the endpoint. Skipping that check would
// let anyone POST a fake "payment succeeded" event and grant themselves access.
//
// Set in Netlify: Site configuration → Environment variables
//   STRIPE_SECRET_KEY      same restricted key as create-checkout.mjs
//   STRIPE_WEBHOOK_SECRET  whsec_..., shown once you register this endpoint
//                          in Stripe: Developers → Webhooks → Add endpoint
//                          → https://yoursite.netlify.app/.netlify/functions/stripe-webhook
//   SUPABASE_URL           your project's URL, from Supabase: Settings -> API
//   SUPABASE_SERVICE_KEY   the service_role key (server-side only, never the anon key)

import crypto from "node:crypto";

const TOLERANCE_SECONDS = 300; // reject anything claiming to be older than 5 minutes

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

async function supabaseUpsert(table, row, onConflict) {
  const url = `${process.env.SUPABASE_URL}/rest/v1/${table}?on_conflict=${onConflict}`;
  const resp = await fetch(url, {
    method: "POST",
    headers: {
      apikey: process.env.SUPABASE_SERVICE_KEY,
      Authorization: `Bearer ${process.env.SUPABASE_SERVICE_KEY}`,
      "Content-Type": "application/json",
      Prefer: "resolution=merge-duplicates,return=minimal",
    },
    body: JSON.stringify(row),
  });
  if (!resp.ok) {
    const text = await resp.text().catch(() => "");
    throw new Error(`Supabase upsert failed on ${table}: ${resp.status} ${text}`);
  }
}

async function findAccountByStripeCustomer(customerId) {
  const url = `${process.env.SUPABASE_URL}/rest/v1/accounts?stripe_customer_id=eq.${customerId}&select=id`;
  const resp = await fetch(url, {
    headers: {
      apikey: process.env.SUPABASE_SERVICE_KEY,
      Authorization: `Bearer ${process.env.SUPABASE_SERVICE_KEY}`,
    },
  });
  const rows = await resp.json();
  return rows?.[0]?.id || null;
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
      // A checkout completed — either the trial just started, or a paid
      // session finished. The device/account id we set as client_reference_id
      // in create-checkout.mjs is how we know whose row this is.
      case "checkout.session.completed": {
        const session = event.data.object;
        const accountRef = session.client_reference_id;
        const customerId = session.customer;
        if (accountRef && customerId) {
          await supabaseUpsert("accounts", {
            id: accountRef,
            stripe_customer_id: customerId,
            last_seen_at: new Date().toISOString(),
          }, "id");
        }
        break;
      }

      // Fires on creation, renewal, trial-to-paid conversion, plan changes,
      // and status changes generally. This is the main source of truth for
      // "is this subscription currently active."
      case "customer.subscription.created":
      case "customer.subscription.updated": {
        const sub = event.data.object;
        const accountId = await findAccountByStripeCustomer(sub.customer);
        if (!accountId) {
          // Stripe doesn't guarantee event order: this can arrive before
          // checkout.session.completed has created the accounts row for
          // this customer yet. Throwing (rather than logging and moving
          // on) makes Stripe retry with backoff, so the next attempt
          // succeeds once that row exists -- instead of silently losing
          // the subscription link forever.
          throw new Error(`No matching account yet for customer ${sub.customer} (will retry)`);
        }
        const price = sub.items?.data?.[0]?.price;
        await supabaseUpsert("subscriptions", {
          account_id: accountId,
          stripe_subscription_id: sub.id,
          status: sub.status, // trialing | active | past_due | canceled | incomplete
          plan: price?.recurring?.interval === "year" ? "yearly" : "monthly",
          trial_end: sub.trial_end ? new Date(sub.trial_end * 1000).toISOString() : null,
          current_period_end: sub.current_period_end ? new Date(sub.current_period_end * 1000).toISOString() : null,
          cancel_at_period_end: !!sub.cancel_at_period_end,
          updated_at: new Date().toISOString(),
        }, "stripe_subscription_id");
        break;
      }

      case "customer.subscription.deleted": {
        const sub = event.data.object;
        const accountId = await findAccountByStripeCustomer(sub.customer);
        if (!accountId) {
          throw new Error(`No matching account yet for customer ${sub.customer} (will retry)`);
        }
        await supabaseUpsert("subscriptions", {
          account_id: accountId,
          stripe_subscription_id: sub.id,
          status: "canceled",
          updated_at: new Date().toISOString(),
        }, "stripe_subscription_id");
        break;
      }

      // The trial ended without a payment method, or a renewal charge
      // failed. Reflect that as past_due; the app decides separately what
      // past_due actually means for access (full lock vs read-only).
      case "invoice.payment_failed": {
        const invoice = event.data.object;
        const accountId = await findAccountByStripeCustomer(invoice.customer);
        if (accountId && invoice.subscription) {
          await supabaseUpsert("subscriptions", {
            account_id: accountId,
            stripe_subscription_id: invoice.subscription,
            status: "past_due",
            updated_at: new Date().toISOString(),
          }, "stripe_subscription_id");
        }
        break;
      }

      default:
        // Unhandled event types are fine to ignore — Stripe sends many more
        // than we need, and acknowledging with 200 stops needless retries.
        break;
    }
  } catch (e) {
    console.error("stripe-webhook: handler error", e);
    // Return 500 so Stripe retries — an event we failed to record should not
    // be silently dropped.
    return new Response("Internal error", { status: 500 });
  }

  return new Response(JSON.stringify({ received: true }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
};
