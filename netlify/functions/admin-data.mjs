// Serves the merged tester view for admin.html. Password-gated, server
// side -- this is the only place that can read waitlist_signups or
// early_access_codes at all, since neither table grants anon SELECT
// (verified directly against pg_policies before writing this: only an
// anon INSERT policy exists on waitlist_signups, nothing else, on either
// table). The service key is the only way in, which is exactly why this
// has to be a function rather than a page that queries Supabase directly.
//
// Set in Netlify: Site configuration → Environment variables
//   SUPABASE_URL          same as the other functions
//   SUPABASE_SERVICE_KEY  same as the other functions
//   ADMIN_PASSWORD        shared password for this one dashboard

export default async (req) => {
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  const supaUrl = process.env.SUPABASE_URL;
  const supaKey = process.env.SUPABASE_SERVICE_KEY;
  const adminPassword = process.env.ADMIN_PASSWORD;
  if (!supaUrl || !supaKey || !adminPassword) {
    return new Response(JSON.stringify({ error: "Admin dashboard isn't fully configured on this site yet." }), {
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

  if (String(body?.password || "") !== adminPassword) {
    return new Response(JSON.stringify({ error: "Wrong password." }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }

  const supaHeaders = {
    apikey: supaKey,
    Authorization: `Bearer ${supaKey}`,
  };

  try {
    // The waitlist and access-code tables are the core dashboard data.
    // Feedback/activity were added later, so a missing migration/table must
    // not lock the owner out of the entire admin dashboard.
    const [signupsResp, codesResp, feedbackResp, activityResp, eventsResp] = await Promise.all([
      fetch(`${supaUrl}/rest/v1/waitlist_signups?select=*&order=created_at.desc`, { headers: supaHeaders }),
      fetch(`${supaUrl}/rest/v1/early_access_codes?select=*&order=code.asc`, { headers: supaHeaders }),
      fetch(`${supaUrl}/rest/v1/feedback?select=*&order=created_at.desc`, { headers: supaHeaders }),
      fetch(`${supaUrl}/rest/v1/tester_activity_status?select=*`, { headers: supaHeaders }),
      fetch(`${supaUrl}/rest/v1/tester_activity_events?select=device_ref,event_name,app_version,device_type,created_at&order=created_at.desc&limit=5000`, { headers: supaHeaders }),
    ]);
    if (!signupsResp.ok || !codesResp.ok) {
      const signupDetail = signupsResp.ok ? "" : ` waitlist_signups:${signupsResp.status}`;
      const codeDetail = codesResp.ok ? "" : ` early_access_codes:${codesResp.status}`;
      throw new Error(`Core Supabase read failed.${signupDetail}${codeDetail}`);
    }
    const signups = await signupsResp.json();
    const codes = await codesResp.json();
    const feedback = feedbackResp.ok ? await feedbackResp.json() : [];
    const activity = activityResp.ok ? await activityResp.json() : [];
    const events = eventsResp.ok ? await eventsResp.json() : [];
    const eventByDevice = new Map();
    for (const e of events) {
      if (!eventByDevice.has(e.device_ref)) eventByDevice.set(e.device_ref, []);
      eventByDevice.get(e.device_ref).push(e);
    }
    const activityByDevice = new Map(activity.map((a) => [a.device_ref, a]));

    // Group signups by email -- someone submitting the form more than
    // once (it happens) should show as one person with a signup count,
    // not several separate rows that make the list look bigger than it
    // actually is.
    const byEmail = new Map();
    for (const s of signups) {
      const key = String(s.email || "").trim().toLowerCase();
      if (!key) continue;
      if (!byEmail.has(key)) {
        byEmail.set(key, { ...s, signupCount: 1 });
      } else {
        const existing = byEmail.get(key);
        existing.signupCount += 1;
        // Keep the most recent submission's details (name spelling,
        // latest "why", etc) but the earliest created_at as when they
        // actually first showed interest -- signups arrive newest-first
        // from the query above, so the first one seen per email is the
        // most recent submission and the last one seen is the earliest.
        existing.created_at = s.created_at;
      }
    }

    // Match each unique signup to a claimed code by email, case
    // insensitive. A code claimed via the app gate directly (no email,
    // device-based) can never match here by design -- those are listed
    // separately below so nothing is silently dropped.
    const codesByEmail = new Map();
    for (const c of codes) {
      if (c.status === "claimed" && c.claimed_email) {
        codesByEmail.set(String(c.claimed_email).trim().toLowerCase(), c);
      }
    }

    const testers = Array.from(byEmail.values()).map((s) => {
      const key = String(s.email).trim().toLowerCase();
      const code = codesByEmail.get(key) || null;
      let status;
      if (!code) status = "no_code";
      else if (code.device_ref) status = "active";
      else status = "code_sent";
      return {
        name: s.name,
        email: s.email,
        role: s.role,
        participants_supported: s.participants_supported,
        why: s.why,
        joined_at: s.created_at,
        signup_count: s.signupCount,
        status,
        code: code ? code.code : null,
        claimed_at: code ? code.claimed_at : null,
        activity: code && code.device_ref ? (() => {
          const base=activityByDevice.get(code.device_ref) || {};
          const ev=eventByDevice.get(code.device_ref) || [];
          const last=ev[0] || null;
          const features=[...new Set(ev.filter(x=>x.event_name.startsWith("section_")).map(x=>x.event_name.replace("section_","")))];
          const activeDays=new Set(ev.map(x=>String(x.created_at||"").slice(0,10))).size;
          const sessions=ev.filter(x=>x.event_name==="app_opened").length;
          return {...base,last_seen_at:last?.created_at||base.last_meaningful_at||null,last_event:last?.event_name||null,
            app_version:last?.app_version||null,device_type:last?.device_type||null,features_used:features,active_days:activeDays,sessions};
        })() : null,
      };
    });
    // Most urgent first: no code sent at all is the thing that actually
    // needs a human to do something about it.
    const statusOrder = { no_code: 0, code_sent: 1, active: 2 };
    testers.sort((a, b) => statusOrder[a.status] - statusOrder[b.status] || new Date(b.joined_at) - new Date(a.joined_at));

    // Codes claimed with no email on file at all -- these are direct,
    // device-only claims through the app gate (the original manual
    // testing flow, before any of this automation existed) and can't be
    // matched to a waitlist signup by definition. Shown separately so
    // the total code count is always fully accounted for.
    const deviceOnlyClaims = codes.filter((c) => c.status === "claimed" && !c.claimed_email);

    const stats = {
      total_codes: codes.length,
      claimed_codes: codes.filter((c) => c.status === "claimed").length,
      available_codes: codes.filter((c) => c.status === "available").length,
      total_signups: signups.length,
      unique_signups: byEmail.size,
      no_code_count: testers.filter((t) => t.status === "no_code").length,
      active_count: testers.filter((t) => t.activity?.status === "active" || (!t.activity && t.status === "active")).length,
      grace_count: testers.filter((t) => t.activity?.status === "grace").length,
      release_eligible_count: testers.filter((t) => t.activity?.status === "release_eligible").length,
      reward_qualifying_count: testers.filter((t) => t.activity?.reward_qualifying).length,
    };

    return new Response(JSON.stringify({ ok: true, stats, testers, deviceOnlyClaims, feedback }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: "server_error", detail: String(e?.message || e) }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
};
