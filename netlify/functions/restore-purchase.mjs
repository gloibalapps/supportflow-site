// Lets someone who already has an active trial or subscription reconnect a
// new device to it, instead of accidentally starting a second paid
// subscription. There's no login system by design (records stay local, no
// account/password to manage) — the email they paid with is the only thing
// that ties a person back to their Stripe subscription, so that's what this
// asks for.
//
// How it works: look up the Stripe customer by email, find the Supabase
// account already linked to that customer (created by stripe-webhook.mjs
// when they first checked out), and hand the browser that account's id.
// The browser then adopts it as its own ndis:deviceRef, so the very next
// status check (check-status.mjs) resolves to the existing subscription.
//
// Known trade-off, worth revisiting once email sending is wired up: this
// trusts whatever email is typed in, with no confirmation step. Someone
// who knows another person's checkout email could restore onto their own
// device too. It doesn't expose any of that person's app data (records are
// per-device, never uploaded) and doesn't charge anyone extra — the
// realistic downside is two devices sharing one seat, which is generally
// no different to how such device restores commonly begin. A proper fix
// is a magic-link confirmation email before restoring; add once Resend
// (or similar) is configured.
//
// Set in Netlify: Site configuration → Environment variables
//   STRIPE_SECRET_KEY     same restricted key as create-checkout.mjs
//   SUPABASE_URL          same as the other billing functions
//   SUPABASE_SERVICE_KEY  same as the other billing functions

const STRIPE_API = "https://api.stripe.com/v1";

export default async (req) => {
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  const stripeKey = process.env.STRIPE_SECRET_KEY;
  const supaUrl = process.env.SUPABASE_URL;
  const supaKey = process.env.SUPABASE_SERVICE_KEY;
  if (!stripeKey || !supaUrl || !supaKey) {
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

  const email = typeof body?.email === "string" ? body.email.trim().toLowerCase() : "";
  if (!email || !email.includes("@")) {
    return new Response(JSON.stringify({ error: "Enter the email you used to subscribe." }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  try {
    // Stripe's customer search matches case-insensitively already, but the
    // lowercased value keeps this predictable either way.
    const custResp = await fetch(
      `${STRIPE_API}/customers?email=${encodeURIComponent(email)}&limit=5`,
      { headers: { Authorization: `Bearer ${stripeKey}` } }
    );
    const custData = await custResp.json();
    const customers = custData?.data || [];
    if (!customers.length) {
      return new Response(JSON.stringify({ error: "No subscription found for that email." }), {
        status: 404,
        headers: { "Content-Type": "application/json" },
      });
    }

    // Ask Supabase for the account tied to any of these customer ids —
    // stripe-webhook.mjs is what originally wrote that link, at checkout.
    const customerIds = customers.map((c) => c.id);
    const filter = customerIds.map((id) => `"${id}"`).join(",");
    const acctResp = await fetch(
      `${supaUrl}/rest/v1/accounts?stripe_customer_id=in.(${filter})&select=id,stripe_customer_id&order=last_seen_at.desc&limit=1`,
      {
        headers: {
          apikey: supaKey,
          Authorization: `Bearer ${supaKey}`,
        },
      }
    );
    const accounts = await acctResp.json();
    const account = accounts?.[0];
    if (!account) {
      return new Response(JSON.stringify({ error: "No subscription found for that email." }), {
        status: 404,
        headers: { "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify({ deviceRef: account.id }), {
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
