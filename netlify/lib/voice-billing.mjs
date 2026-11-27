// Voice notes checkout and entitlement. No audio and no transcripts.
//
// Prices are read from Netlify env vars. This file does not create Stripe
// products or prices. If a price id, STRIPE_SECRET_KEY, or SITE_URL is
// missing, checkout returns "isn't available yet" and does not call Stripe.
//
//   STRIPE_PRICE_VOICE_NOTES  recurring monthly Price, A$5.00 AUD
//   STRIPE_PRICE_VOICE_TOPUP  one-off Price, A$5.00 AUD, grants 120 minutes
//
// Premium (licence_payments product tracker_full, status paid) includes
// Voice notes. The monthly add-on is a row in voice_subscriptions. The
// top-up is 120 extra minutes in the usage record, used after the monthly
// 120, and it does not lift the 2-minute note cap.

import { TOPUP_SECONDS, usageKey, normalizeUsage, grantTopup } from "./voice-notes.mjs";

export const VOICE_KIND = "voice";
export const VOICE_MONTHLY = "voice_notes";
export const VOICE_TOPUP = "voice_topup";

export const VOICE_PRICE_ENV = Object.freeze({
  voice_notes: "STRIPE_PRICE_VOICE_NOTES",
  voice_topup: "STRIPE_PRICE_VOICE_TOPUP",
});

export function voicePriceId(product, env = process.env) {
  const name = VOICE_PRICE_ENV[product];
  if (!name) return "";
  return String(env[name] || "").trim();
}

export function voiceCheckoutReady(product, env = process.env) {
  return !!(voicePriceId(product, env) && String(env.STRIPE_SECRET_KEY || "").trim() && String(env.SITE_URL || "").trim());
}

export function voiceCheckoutFlags(env = process.env) {
  return {
    voice_notes: voiceCheckoutReady(VOICE_MONTHLY, env),
    voice_topup: voiceCheckoutReady(VOICE_TOPUP, env),
  };
}

export function voiceSubscriptionEntitled(status) {
  return status === "active" || status === "trialing";
}

export function premiumGrantsVoice(rows) {
  return Array.isArray(rows) && rows.some((row) => row && row.product === "tracker_full");
}

export async function defaultVoiceEntitlement(sub, supaFn) {
  const q = encodeURIComponent(sub);
  const premium = await supaFn(`licence_payments?google_sub=eq.${q}&product=eq.tracker_full&status=eq.paid&select=product&limit=1`);
  const subs = await supaFn(`voice_subscriptions?google_sub=eq.${q}&status=in.(active,trialing)&select=status&limit=1`);
  const premiumOk = premiumGrantsVoice(premium);
  const subscription = Array.isArray(subs) && subs.some((row) => voiceSubscriptionEntitled(row.status));
  return { ok: premiumOk || subscription, premium: premiumOk, subscription };
}

const formBody = (o) => Object.entries(o).map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join("&");

// Same Checkout Session shape as the payment-tracker checkout: price id from
// env, metadata on the session and on the subscription or payment intent.
export function voiceCheckoutForm({ product, price, site, sub, email, deviceId }) {
  const recurring = product === VOICE_MONTHLY;
  const meta = { kind: VOICE_KIND, product, google_sub: sub, device_id: deviceId || "" };
  const params = {
    mode: recurring ? "subscription" : "payment",
    "line_items[0][price]": price,
    "line_items[0][quantity]": 1,
    client_reference_id: sub,
    success_url: `${site}/app?voice=success`,
    cancel_url: `${site}/app?voice=cancelled`,
    "automatic_tax[enabled]": "true",
  };
  if (!recurring) {
    params.customer_creation = "always";
    params["invoice_creation[enabled]"] = "true";
  }
  if (email) params.customer_email = email;
  const metaKey = recurring ? "subscription_data[metadata]" : "payment_intent_data[metadata]";
  for (const [k, v] of Object.entries(meta)) {
    params[`metadata[${k}]`] = v;
    params[`${metaKey}[${k}]`] = v;
  }
  return params;
}

export async function handleVoiceCheckout(body, { env = process.env, session, entitled, fetchImpl } = {}) {
  const product = body?.product === VOICE_TOPUP ? VOICE_TOPUP : body?.product === VOICE_MONTHLY ? VOICE_MONTHLY : "";
  if (!product) return { status: 400, body: { error: "bad request" } };
  const price = voicePriceId(product, env);
  const key = String(env.STRIPE_SECRET_KEY || "").trim();
  const site = String(env.SITE_URL || "").trim();
  if (!key || !site || !price) {
    return {
      status: 503,
      body: { error: "not-ready", message: "Voice notes checkout isn't available yet.", product, comingSoon: true },
    };
  }
  if (!session?.sub) {
    return { status: 401, body: { error: "sign-in-required", message: "Sign in with Google to add Voice notes." } };
  }
  let ent = { ok: false, premium: false, subscription: false };
  try {
    ent = (await entitled?.(session.sub)) || ent;
  } catch {
    return { status: 503, body: { error: "entitlement-unavailable", message: "Voice notes checkout isn't available yet.", product } };
  }
  if (product === VOICE_MONTHLY && ent.premium) {
    return { status: 409, body: { error: "included", message: "Premium already includes Voice notes." } };
  }
  if (product === VOICE_MONTHLY && ent.subscription) {
    return { status: 409, body: { error: "already-active", message: "Voice notes is already active on this account." } };
  }
  if (product === VOICE_TOPUP && !ent.ok) {
    return { status: 402, body: { error: "voice-notes-required", message: "Add Voice notes before buying extra minutes." } };
  }
  const params = voiceCheckoutForm({
    product, price, site, sub: session.sub, email: session.email || "", deviceId: session.deviceId || "",
  });
  const call = fetchImpl || fetch;
  try {
    const r = await call("https://api.stripe.com/v1/checkout/sessions", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/x-www-form-urlencoded" },
      body: formBody(params),
    });
    const data = await r.json().catch(() => ({}));
    if (!r.ok || !data.url) {
      return { status: 502, body: { error: "stripe", message: "Voice notes checkout isn't available yet." } };
    }
    return { status: 200, body: { url: data.url, product } };
  } catch {
    return { status: 502, body: { error: "stripe", message: "Voice notes checkout isn't available yet." } };
  }
}

export function voiceSubscriptionRow(sub, stripeSub, deleted) {
  const period = stripeSub?.current_period_end || stripeSub?.items?.data?.[0]?.current_period_end;
  return {
    stripe_subscription_id: stripeSub.id,
    google_sub: sub,
    stripe_customer_id: typeof stripeSub.customer === "string" ? stripeSub.customer : stripeSub.customer?.id || null,
    status: deleted ? "canceled" : (stripeSub.status || "active"),
    current_period_end: period ? new Date(1000 * period).toISOString() : null,
    cancel_at_period_end: !!stripeSub.cancel_at_period_end,
    updated_at: new Date().toISOString(),
  };
}

// Add 120 minutes once per Stripe session. A retried webhook does not add them again.
export function grantTopupOnce(usage, localDate, sessionId) {
  const next = normalizeUsage(usage, localDate);
  const grants = Array.isArray(next.topupGrants) ? next.topupGrants.filter((id) => typeof id === "string") : [];
  if (!sessionId || grants.includes(sessionId)) return { usage: { ...next, topupGrants: grants }, granted: false };
  const topped = grantTopup(next, localDate);
  topped.topupGrants = [...grants, sessionId].slice(-40);
  return { usage: topped, granted: true };
}

export function revokeTopupOnce(usage, sessionId) {
  if (!usage || !sessionId) return usage;
  const grants = Array.isArray(usage.topupGrants) ? usage.topupGrants : [];
  if (!grants.includes(sessionId)) return usage;
  return {
    ...usage,
    topupSecondsRemaining: Math.max(0, (Number(usage.topupSecondsRemaining) || 0) - TOPUP_SECONDS),
    topupGrants: grants.filter((id) => id !== sessionId),
  };
}

export async function grantVoiceTopupMinutes(store, sub, sessionId, localDate) {
  const key = usageKey({ sub });
  if (!key) return false;
  let granted = false;
  const { updateUsage } = await import("./voice-store.mjs");
  await updateUsage(store, key, (raw) => {
    const result = grantTopupOnce(raw, localDate, sessionId);
    granted = result.granted;
    return { write: true, value: result.usage };
  });
  return granted;
}
