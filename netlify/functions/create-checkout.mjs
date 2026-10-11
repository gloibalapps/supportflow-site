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
  const pack = PACKS[packName];
  if (!pack) {
    return json({ error: "Choose a credit pack: casual, popular or value." }, 400);
  }
  const price = process.env[pack.env];
  if (!price) {
    return json({ error: "That credit pack isn't available yet." }, 500);
  }

  // The device reference the app generated, so the webhook knows whose
  // account to add the credits to once Stripe confirms payment. Without
  // this, a completed checkout has no way back to the person who paid.
  const clientReferenceId = typeof body?.clientReferenceId === "string" ? body.clientReferenceId.trim() : "";
  if (!clientReferenceId) {
    return json({ error: "Missing device reference." }, 400);
  }

  // An optional promotion code the user typed in. Stripe validates it
  // itself, including any redemption cap.
  const promoCode = typeof body?.promoCode === "string" ? body.promoCode.trim() : "";

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
    allow_promotion_codes: promoCode ? "false" : "true", // manual code below takes precedence
  };

  // If the user typed a specific code, look it up and apply it directly so
  // it's pre-filled rather than making them re-type it on Stripe's page.
  if (promoCode) {
    try {
      const lookup = await fetch(
        `${STRIPE_API}/promotion_codes?code=${encodeURIComponent(promoCode)}&active=true&limit=1`,
        { headers: { Authorization: `Bearer ${key}` } }
      );
      const found = await lookup.json();
      const match = found?.data?.[0];
      if (match) {
        params["discounts[0][promotion_code]"] = match.id;
        delete params.allow_promotion_codes; // Stripe rejects both together
      } else {
        // Invalid or exhausted code: let Stripe's own checkout page prompt
        // for one, rather than failing the whole request.
        params.allow_promotion_codes = "true";
      }
    } catch {
      params.allow_promotion_codes = "true";
    }
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
