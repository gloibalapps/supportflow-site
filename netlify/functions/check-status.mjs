// The app calls this on load to ask "is this device's trial or subscription
// still good?" Read-only, uses the same device reference the checkout
// session was created with. Never exposes the Supabase service key to the
// browser — the app only ever gets a plain status string back.
//
// Uses the same SUPABASE_URL / SUPABASE_SERVICE_KEY as stripe-webhook.mjs.

export default async (req) => {
  const url = new URL(req.url);
  const deviceRef = url.searchParams.get("ref");

  if (!deviceRef) {
    return new Response(JSON.stringify({ status: "none" }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }

  const supaConfigured = process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_KEY;
  if (!supaConfigured) {
    // Billing isn't wired up on this deployment at all — treat as no
    // subscription record rather than erroring, so the app can decide its
    // own default (e.g. a testing build with no billing enforced yet).
    return new Response(JSON.stringify({ status: "unconfigured" }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }

  try {
    const acctResp = await fetch(
      `${process.env.SUPABASE_URL}/rest/v1/accounts?id=eq.${encodeURIComponent(deviceRef)}&select=id`,
      {
        headers: {
          apikey: process.env.SUPABASE_SERVICE_KEY,
          Authorization: `Bearer ${process.env.SUPABASE_SERVICE_KEY}`,
        },
      }
    );
    const accounts = await acctResp.json();
    if (!accounts?.[0]) {
      return new Response(JSON.stringify({ status: "none" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }

    const subResp = await fetch(
      `${process.env.SUPABASE_URL}/rest/v1/subscriptions?account_id=eq.${encodeURIComponent(deviceRef)}&select=status,plan,trial_end,current_period_end,cancel_at_period_end&order=updated_at.desc&limit=1`,
      {
        headers: {
          apikey: process.env.SUPABASE_SERVICE_KEY,
          Authorization: `Bearer ${process.env.SUPABASE_SERVICE_KEY}`,
        },
      }
    );
    const subs = await subResp.json();
    const sub = subs?.[0];

    if (!sub) {
      return new Response(JSON.stringify({ status: "none" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify({
      status: sub.status, // trialing | active | past_due | canceled
      plan: sub.plan,
      trialEnd: sub.trial_end,
      currentPeriodEnd: sub.current_period_end,
      cancelAtPeriodEnd: sub.cancel_at_period_end,
    }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (e) {
    // A failed check should never brick the app. The caller treats an error
    // response as "couldn't confirm", not as "definitely not subscribed".
    return new Response(JSON.stringify({ status: "error" }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }
};
