// The app calls this on load to ask "how many invoice credits does this
// device's account have?" Read-only, uses the same device reference the
// checkout session was created with. Never exposes the Supabase service key
// to the browser — the app only ever gets a status and a number back.
//
// Credits (purchased + the 5 free starter credits) are valid for 30 days.
// Once credits_expire_at has passed, the account has 0 usable credits until
// the next purchase starts a fresh window (see add_credits in
// CREDIT-PACKS-MIGRATION.sql).
//
// Set in Netlify: Site configuration → Environment variables
//   SUPABASE_URL          same as stripe-webhook.mjs
//   SUPABASE_SERVICE_KEY  same as stripe-webhook.mjs
//
// Responses:
//   { status: "ok", credits: N, expired: false, expiresAt: ISO }
//   { status: "ok", credits: 0, expired: true }
//   { status: "none", credits: 5 }            no account yet (new user)
//   { status: "unconfigured" | "error", credits: N }

const FREE_STARTER_CREDITS = 5; // matches invoice-credit-rules.js

const json = (obj) =>
  new Response(JSON.stringify(obj), { status: 200, headers: { "Content-Type": "application/json" } });

export default async (req) => {
  const url = new URL(req.url);
  const deviceRef = url.searchParams.get("ref");

  if (!deviceRef) return json({ status: "none", credits: FREE_STARTER_CREDITS });

  const supaConfigured = process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_KEY;
  if (!supaConfigured) {
    // Billing isn't wired up on this deployment — assume the free starter
    // credits so the app stays usable.
    return json({ status: "unconfigured", credits: FREE_STARTER_CREDITS });
  }

  try {
    const resp = await fetch(
      `${process.env.SUPABASE_URL}/rest/v1/accounts?id=eq.${encodeURIComponent(deviceRef)}` +
        `&select=credit_balance,credits_expire_at,free_credits_remaining`,
      {
        headers: {
          apikey: process.env.SUPABASE_SERVICE_KEY,
          Authorization: `Bearer ${process.env.SUPABASE_SERVICE_KEY}`,
        },
      }
    );
    if (!resp.ok) throw new Error(`Supabase ${resp.status}`);
    const account = (await resp.json())?.[0];
    if (!account) return json({ status: "none", credits: FREE_STARTER_CREDITS });

    const expiresAt = account.credits_expire_at ? new Date(account.credits_expire_at) : null;
    if (!expiresAt || Number.isNaN(expiresAt.getTime()) || expiresAt.getTime() < Date.now()) {
      return json({ status: "ok", credits: 0, expired: true });
    }

    // Unexpired free starter credits count alongside purchased ones.
    const credits = (Number(account.credit_balance) || 0) + (Number(account.free_credits_remaining) || 0);
    // Lifetime licence: the webhook sets credit_balance to 99999 and the
    // expiry to 2099. Each invoice preview still decrements the balance, so
    // the 2099 expiry (or a balance near 99999) identifies it, not an exact 99999.
    const balance = Number(account.credit_balance) || 0;
    if (balance >= 99999 || (balance >= 90000 && expiresAt.getUTCFullYear() >= 2090)) {
      return json({ status: "ok", credits, expired: false, lifetime: true, expiresAt: null });
    }
    return json({ status: "ok", credits, expired: false, expiresAt: expiresAt.toISOString() });
  } catch {
    // A failed check should never brick the app. The caller treats "error"
    // as "couldn't confirm", not as "no credits".
    return json({ status: "error", credits: 0 });
  }
};
