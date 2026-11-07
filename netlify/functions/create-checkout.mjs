// Creates a Stripe Checkout Session for a one-time invoice credit pack.
// SupportFlow has no subscription: people start with 5 free credits and buy
// packs as they need them. The browser never sees a secret key or talks to
// Stripe directly — it calls this function, gets back a URL, and redirects.
//
// Set in Netlify: Site configuration → Environment variables
//   STRIPE_SECRET_KEY     the restricted key (rk_test_... while in the sandbox)
//   STRIPE_PRICE_CASUAL   Price ID of the one-time "10 credits" product (A$7.99)
//   STRIPE_PRICE_POPULAR  Price ID of the one-time "30 credits" product (A$19.99)
//   STRIPE_PRICE_VALUE    Price ID of the one-time "100 credits" product (A$39.99)
//   SITE_URL              e.g. https://supportflow.work (no trailing slash)

const STRIPE_API = "https://api.stripe.com/v1";

// Kept in step with CREDIT_PACKS in invoice-credit-rules.js. The credit
// count travels in session metadata so the webhook never has to guess it
// from the amount paid (which a promo code would change).
const PACKS = Object.freeze({
  casual: { credits: 10, env: "STRIPE_PRICE_CASUAL" },
  popular: { credits: 30, env: "STRIPE_PRICE_POPULAR" },
  value: { credits: 100, env: "STRIPE_PRICE_VALUE" },
  // Hidden owner test pack (A$0.50, Stripe's AUD minimum) for checking the
  // live purchase flow end to end. Only offered on /pricing?test=1.
  test: { credits: 1, env: "STRIPE_PRICE_TEST" },
});

const json = (obj, status = 200) =>
  new Response(JSON.stringify(obj), { status, headers: { "Content-Type": "application/json" } });

function formBody(obj) {
  // Stripe's API takes application/x-www-form-urlencoded, including for
  // nested fields like metadata[pack].
  return Object.entries(obj)
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    .join("&");
}

export default async (req) => {
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  const key = process.env.STRIPE_SECRET_KEY;
  const site = process.env.SITE_URL;
  if (!key || !site) {
    return json({ error: "Billing isn't configured on this site yet." }, 500);
  }

  let body;
  try {
    body = await req.json();
  } catch {
    return json({ error: "Malformed request." }, 400);
  }

  // `plan` accepted as an alias so an older app build sending the pack name
  // under that field still works.
  const packName = String(body?.pack ?? body?.plan ?? "").trim().toLowerCase();
  // Basic (shown as A$79, formerly the lifetime pack) is a Google-account
  // licence. It is started from the app via licence checkout product "one",
  // never from this anonymous device-ref endpoint.
  if (packName === "lifetime" || packName === "basic" || packName === "one") {
    return json({ error: "Basic is purchased after Google sign-in. Open SupportFlow and choose Basic." }, 400);
  }
  const pack = PACKS[packName];
  if (!pack) {
    return json({ error: "Unknown product. Please choose the Lifetime licence." }, 400);
  }
  const price = process.env[pack.env];
  if (!price) {
    return json({ error: "That product isn't available yet." }, 500);
  }

  // The device reference the app generated, so the webhook knows whose
  // account to add the credits to once Stripe confirms payment. Without
  // this, a completed checkout has no way back to the person who paid.
  const clientReferenceId = typeof body?.clientReferenceId === "string" ? body.clientReferenceId.trim() : "";
  if (!clientReferenceId) {
    return json({ error: "Missing device reference." }, 400);
  }

  // An optional promotion code typed on our pricing page. Stripe's own
  // "Add code" box is never shown; a valid code is pre-applied instead.
  const promoCode = typeof body?.promoCode === "string" ? body.promoCode.trim() : "";
  const INVALID_PROMO = "That promo code isn't valid or has expired.";

  const params = {
    mode: "payment",
    "line_items[0][price]": price,
    "line_items[0][quantity]": 1,
    client_reference_id: clientReferenceId,
    // Payment mode doesn't create a Stripe customer by default. We need one
    // so restore-purchase.mjs can find this buyer again by email later.
    customer_creation: "always",
    "metadata[pack]": packName,
    "metadata[credits]": pack.credits,
    "payment_intent_data[metadata][pack]": packName,
    success_url: `${site}/app?checkout=success`,
    cancel_url: `${site}/app?checkout=cancelled`,
    // allow_promotion_codes is deliberately omitted so Stripe never shows its
    // own "Add code" box (Stripe also rejects it alongside `discounts`).
  };

  if (promoCode) {
    // Try the code as typed, then upper-cased, so "freecredit" matches
    // "FREECREDIT" regardless of how Stripe compares codes.
    const candidates = [...new Set([promoCode, promoCode.toUpperCase()])];
    let match = null;
    try {
      for (const code of candidates) {
        const lookup = await fetch(
          `${STRIPE_API}/promotion_codes?code=${encodeURIComponent(code)}&active=true&limit=1`,
          { headers: { Authorization: `Bearer ${key}` } }
        );
        if (!lookup.ok) continue;
        const found = await lookup.json();
        const m = found?.data?.[0];
        const exhausted = m?.max_redemptions != null && m.times_redeemed >= m.max_redemptions;
        const expired = m?.expires_at && m.expires_at * 1000 <= Date.now();
        if (m && m.active && !exhausted && !expired) { match = m; break; }
      }
    } catch {
      return json({ error: "Couldn't check that promo code. Try again in a moment." }, 502);
    }
    if (!match) return json({ error: INVALID_PROMO }, 400);
    params["discounts[0][promotion_code]"] = match.id;
  }

  try {
    const resp = await fetch(`${STRIPE_API}/checkout/sessions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: formBody(params),
    });
    const session = await resp.json();

    if (!resp.ok) {
      return json({ error: session?.error?.message || "Stripe couldn't create the checkout session." }, 502);
    }

    return json({ url: session.url });
  } catch {
    return json({ error: "Couldn't reach Stripe. Try again in a moment." }, 502);
  }
};
