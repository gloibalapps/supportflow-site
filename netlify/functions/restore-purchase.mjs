// Lets someone who has bought SupportFlow reconnect a new device to their
// purchase (Basic lifetime licence or credit balance) instead of losing it
// after reinstalling or switching phones. There's no password by design: the
// email they paid with at Stripe checkout ties a person to their purchase.
//
// Two steps, so typing someone else's email gets an attacker nothing:
//   1. POST { email }  -> if a purchase exists for that email, a link is
//      emailed to that address. The answer is always the same ("sent"), so
//      the form can't be used to find out who has bought.
//   2. POST { token }  -> the link opened on the new device. A valid, unexpired
//      token returns { deviceRef, credits, lifetime }. The browser adopts
//      deviceRef as its ndis:deviceRef, so the next status check
//      (check-status.mjs) resolves to the same licence.
//
// Links are valid for 15 minutes and signed with LICENCE_SECRET.
//
// Set in Netlify: Site configuration -> Environment variables
//   STRIPE_SECRET_KEY, SUPABASE_URL, SUPABASE_SERVICE_KEY   as the other billing functions
//   LICENCE_SECRET, RESEND_API_KEY, LICENCE_EMAIL_FROM, SITE_URL   as licence.mjs

import { signRestoreToken, verifyRestoreToken, sendEmail, RESTORE_LINK_MINUTES } from "../lib/licence.mjs";

const STRIPE_API = "https://api.stripe.com/v1";
const json = (obj, s = 200) => new Response(JSON.stringify(obj), { status: s, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });

// Best-effort limit per server instance: one email link per address per minute.
const lastSent = new Map();

async function findAccountByEmail(email, stripeKey, supaUrl, supaKey) {
  const custResp = await fetch(`${STRIPE_API}/customers?email=${encodeURIComponent(email)}&limit=5`, { headers: { Authorization: `Bearer ${stripeKey}` } });
  const customers = (await custResp.json())?.data || [];
  if (!customers.length) return null;
  const filter = customers.map((c) => `"${c.id}"`).join(",");
  const acctResp = await fetch(
    `${supaUrl}/rest/v1/accounts?stripe_customer_id=in.(${filter})&select=id,credit_balance&order=last_seen_at.desc&limit=1`,
    { headers: { apikey: supaKey, Authorization: `Bearer ${supaKey}` } }
  );
  return (await acctResp.json())?.[0] || null;
}

export default async (req) => {
  if (req.method !== "POST") return new Response("Method not allowed", { status: 405 });

  const stripeKey = process.env.STRIPE_SECRET_KEY;
  const supaUrl = process.env.SUPABASE_URL;
  const supaKey = process.env.SUPABASE_SERVICE_KEY;
  const site = (process.env.SITE_URL || "").replace(/\/$/, "");
  if (!stripeKey || !supaUrl || !supaKey || !site) return json({ error: "Billing isn't configured on this site yet." }, 500);

  let body;
  try { body = await req.json(); } catch { return json({ error: "Malformed request." }, 400); }

  try {
    // Step 2: the emailed link was opened on the new device.
    if (typeof body?.token === "string") {
      const t = verifyRestoreToken(body.token);
      if (!t) return json({ error: "That link has expired or isn't valid. Ask for a new one." }, 400);
      const acctResp = await fetch(`${supaUrl}/rest/v1/accounts?id=eq.${encodeURIComponent(t.a)}&select=id,credit_balance&limit=1`, { headers: { apikey: supaKey, Authorization: `Bearer ${supaKey}` } });
      const account = (await acctResp.json())?.[0];
      if (!account) return json({ error: "No purchase found for that link." }, 404);
      const credits = Number(account.credit_balance) || 0;
      return json({ deviceRef: account.id, credits, lifetime: credits >= 99999 });
    }

    // Step 1: send a confirmation link to the checkout email.
    const email = typeof body?.email === "string" ? body.email.trim().toLowerCase() : "";
    if (!email || !email.includes("@") || email.length > 254) return json({ error: "Enter the email you used at checkout." }, 400);

    const reply = { sent: true, minutes: RESTORE_LINK_MINUTES };
    const last = lastSent.get(email) || 0;
    if (Date.now() - last < 60000) return json(reply); // same answer, nothing sent
    lastSent.set(email, Date.now());
    if (lastSent.size > 500) lastSent.delete(lastSent.keys().next().value);

    const account = await findAccountByEmail(email, stripeKey, supaUrl, supaKey);
    if (account) {
      const token = signRestoreToken({ accountId: account.id, email });
      const link = `${site}/app#sf_restore=${encodeURIComponent(token)}`;
      await sendEmail(
        email,
        "Restore your SupportFlow licence",
        `Open this link on the device you want to restore SupportFlow on. It works for ${RESTORE_LINK_MINUTES} minutes.\n\n${link}\n\nIf you didn't ask for this, ignore this email. Nothing changes unless the link is opened.`
      );
    }
    return json(reply);
  } catch (e) {
    return json({ error: "Couldn't reach our payment service. Try again in a moment." }, 502);
  }
};
