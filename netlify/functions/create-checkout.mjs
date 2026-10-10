// Creates a Stripe Checkout Session for whichever plan the user picked, with
// the 14-day trial applied. The browser never sees a secret key or talks to
// Stripe directly — it calls this function, gets back a URL, and redirects.
//
// Set in Netlify: Site configuration → Environment variables
//   STRIPE_SECRET_KEY   the restricted key (rk_test_... while in the sandbox)
//   STRIPE_PRICE_MONTHLY the monthly plan's Price ID, from Stripe: Product catalogue
//   STRIPE_PRICE_YEARLY  the yearly plan's Price ID, from Stripe: Product catalogue
//   SITE_URL             e.g. https://ndisapptest.netlify.app (no trailing slash)

const STRIPE_API = "https://api.stripe.com/v1";
const TRIAL_DAYS = 14;
// Early-access testers get 90 days instead of 14, applied automatically
// from the device reference set when they entered their access code at
// the app's gate — nobody has to type in a coupon at checkout.
const EARLY_ACCESS_TRIAL_DAYS = 90;

function priceFor(plan) {
  if (plan === "monthly") return process.env.STRIPE_PRICE_MONTHLY;
  if (plan === "yearly") return process.env.STRIPE_PRICE_YEARLY;
  return null;
}

function formBody(obj) {
  // Stripe's API takes application/x-www-form-urlencoded, including for
  // nested fields like subscription_data[trial_period_days].
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
    return new Response(JSON.stringify({ error: "Billing isn't configured on this site yet." }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }

  let body;
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: "Malformed request." }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const plan = body?.plan;
  const price = priceFor(plan);
  if (!price) {
    return new Response(JSON.stringify({ error: "Choose monthly or yearly." }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  // The device reference the app generated, so the webhook has something
  // stable to attach this subscription to in Supabase once Stripe confirms
  // the session. Without this, a completed checkout has no way back to the
  // person who paid.
  const clientReferenceId = typeof body?.clientReferenceId === "string" ? body.clientReferenceId.trim() : "";
  if (!clientReferenceId) {
    return new Response(JSON.stringify({ error: "Missing device reference." }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  // An optional promotion code (FREEYEAR / FREEMONTH) the user typed in.
  // Stripe validates it itself, including the redemption cap, so a used-up
  // or wrong code just fails at checkout with Stripe's own message.
  const promoCode = typeof body?.promoCode === "string" ? body.promoCode.trim() : "";

  // Was this device one of the 50 early-access testers? Checked against
  // Supabase directly with the service key — never trusts anything the
  // browser claims about itself. A failed check just falls back to the
  // normal 14-day trial rather than blocking checkout entirely.
  let trialDays = TRIAL_DAYS;
  const supaUrl = process.env.SUPABASE_URL;
  const supaKey = process.env.SUPABASE_SERVICE_KEY;
  if (supaUrl && supaKey) {
    try {
      const earlyResp = await fetch(`${supaUrl}/rest/v1/rpc/is_early_access_device`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          apikey: supaKey,
          Authorization: `Bearer ${supaKey}`,
        },
        body: JSON.stringify({ p_device_ref: clientReferenceId }),
      });
      const isEarlyAccess = await earlyResp.json();
      if (isEarlyAccess === true) trialDays = EARLY_ACCESS_TRIAL_DAYS;
    } catch {
      // Couldn't confirm either way — proceed with the standard trial
      // rather than failing checkout over a status lookup.
    }
  }

  const params = {
    mode: "subscription",
    "line_items[0][price]": price,
    "line_items[0][quantity]": 1,
    "subscription_data[trial_period_days]": trialDays,
    client_reference_id: clientReferenceId,
    success_url: `${site}/app?checkout=success`,
    cancel_url: `${site}/app?checkout=cancelled`,
    "payment_method_collection": "if_required", // no card needed to start the trial itself
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
      } else {
        // Invalid or exhausted code: fall back to letting Stripe's own
        // checkout page prompt for one, rather than failing the whole request.
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
      return new Response(JSON.stringify({ error: session?.error?.message || "Stripe couldn't create the checkout session." }), {
        status: 502,
        headers: { "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify({ url: session.url }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: "Couldn't reach Stripe. Try again in a moment." }), {
      status: 502,
      headers: { "Content-Type": "application/json" },
    });
  }
};
