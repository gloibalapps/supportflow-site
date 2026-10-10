// Replaces the old flow (waitlist signup recorded, then Ev manually picks
// a code and emails it) with one atomic step: record the signup, assign
// the next available code, email it, all in this one request. Nobody has
// to touch Supabase for a normal signup any more.
//
// Field validation and limits mirror the existing waitlist_join action on
// the public-api Supabase Edge Function exactly, since this replaces that
// action for the waitlist page specifically. waitlist_count stays on the
// Edge Function -- it's read-only and unrelated to sending email, no
// reason to move it here too.
//
// Set in Netlify: Site configuration → Environment variables
//   SUPABASE_URL          same as the other billing functions
//   SUPABASE_SERVICE_KEY  same as the other billing functions
//   RESEND_API_KEY        Resend, sending access only
//   SITE_URL              same as the other billing functions

const FROM_ADDRESS = "SupportFlow Early Access <early-access@supportflow.work>";
const REPLY_TO = "globalappsai@gmail.com";
const ADMIN_ADDRESS = "globalappsai@gmail.com";

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

async function sendEmail({ apiKey, to, subject, html, text }) {
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: FROM_ADDRESS,
      reply_to: REPLY_TO,
      to: [to],
      subject,
      html,
      text,
    }),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`Resend ${res.status}: ${detail}`);
  }
}

function invitedEmail({ name, code, siteUrl }) {
  const first = String(name).trim().split(/\s+/)[0] || "there";
  const appUrl = `${siteUrl}/app`;
  const text = `Hi ${first},

You're in. SupportFlow is opening to the first 50 support workers before anyone else gets in, and you've got one of the spots.

Your access code: ${code}

Open ${appUrl}, enter that code, and you're straight in -- free while beta testing, full app, nothing held back. This is free while testing -- no subscription, nothing charged. When SupportFlow officially launches, subscribing gets you your own 90 days free, starting the day you subscribe.

A couple of things worth knowing:
- This code is yours alone, one device at a time.
- Nothing about a participant is ever collected or seen by anyone but you -- records stay on your device.
- Found a bug or something confusing? Tap Feedback right in the app header, from any screen, and send it straight to me, or just reply to this email.

Thanks for being one of the first fifty.

Founder, Evan`;

  const html = `<div style="font-family:Georgia,serif;max-width:520px;margin:0 auto;color:#1A1B18">
  <p>Hi ${escapeHtml(first)},</p>
  <p>You're in. SupportFlow is opening to the first 50 support workers before anyone else gets in, and you've got one of the spots.</p>
  <p style="background:#F4F2EC;border-left:3px solid #C8913A;padding:14px 18px;font-size:15px">
    Your access code:<br><b style="font-size:20px;letter-spacing:.04em">${escapeHtml(code)}</b>
  </p>
  <p>Open <a href="${escapeHtml(appUrl)}">${escapeHtml(appUrl)}</a>, enter that code, and you're straight in — free while beta testing, full app, nothing held back.</p>
  <p style="font-size:13px;color:#6B6E64">This is free while testing — no subscription, nothing charged. When SupportFlow officially launches, subscribing gets you your own 90 days free, starting the day you subscribe.</p>
  <p style="font-size:14px;color:#4A4D45">A couple of things worth knowing:</p>
  <ul style="font-size:14px;color:#4A4D45">
    <li>This code is yours alone, one device at a time.</li>
    <li>Nothing about a participant is ever collected or seen by anyone but you -- records stay on your device.</li>
    <li>Found a bug or something confusing? Tap <b>Feedback</b> right in the app header, from any screen, and send it straight to me, or just reply to this email.</li>
  </ul>
  <p>Thanks for being one of the first fifty.</p>
  <p>Founder, Evan</p>
</div>`;
  return { subject: "You're in — your SupportFlow Early Access code", html, text };
}

function waitlistedEmail({ name }) {
  const first = String(name).trim().split(/\s+/)[0] || "there";
  const text = `Hi ${first},

All 50 beta testing spots are filled, so testing itself is closed for now. You're on the list to be notified the moment SupportFlow officially launches to everyone.

Your details are only used to send you that one notification -- never sold, shared, or used for anything else.

Thanks for your interest in SupportFlow.

Founder, Evan`;
  const html = `<div style="font-family:Georgia,serif;max-width:520px;margin:0 auto;color:#1A1B18">
  <p>Hi ${escapeHtml(first)},</p>
  <p>All 50 beta testing spots are filled, so testing itself is closed for now. You're on the list to be notified the moment SupportFlow officially launches to everyone.</p>
  <p>Your details are only used to send you that one notification — never sold, shared, or used for anything else.</p>
  <p>Thanks for your interest in SupportFlow.</p>
  <p>Founder, Evan</p>
</div>`;
  return { subject: "You're on the SupportFlow list for launch", html, text };
}

// This is the only thing that tells Ev a signup happened at all, now that
// the whole point of this function is that he doesn't have to be in the
// loop for the normal case. Without this, automating him out of assigning
// codes would have also automated him out of ever knowing someone joined.
function adminNotifyEmail({ name, email, role, participants_supported, why, assignedCode }) {
  const rows = [
    ["Name", name],
    ["Email", email],
    ["Role", role || "(not given)"],
    ["Participants supported", participants_supported || "(not given)"],
    ["Why", why || "(not given)"],
    ["Outcome", assignedCode ? `Assigned code ${assignedCode}` : "Waitlisted, no codes left"],
  ];
  const text = "New SupportFlow Early Access signup\n\n" +
    rows.map(([k, v]) => `${k}: ${v}`).join("\n");
  const html = `<div style="font-family:ui-sans-serif,system-ui;max-width:520px;margin:0 auto;color:#1A1B18">
  <h2 style="font-size:16px">New Early Access signup</h2>
  <table style="font-size:14px;border-collapse:collapse">
    ${rows.map(([k, v]) => `<tr><td style="padding:4px 12px 4px 0;color:#6B6E64;white-space:nowrap;vertical-align:top">${escapeHtml(k)}</td><td style="padding:4px 0">${escapeHtml(v)}</td></tr>`).join("")}
  </table>
</div>`;
  return { subject: `New Early Access signup — ${name}`, html, text };
}

export default async (req) => {
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  const supaUrl = process.env.SUPABASE_URL;
  const supaKey = process.env.SUPABASE_SERVICE_KEY;
  const resendKey = process.env.RESEND_API_KEY;
  const siteUrl = process.env.SITE_URL || "https://supportflow.work";
  if (!supaUrl || !supaKey || !resendKey) {
    return new Response(JSON.stringify({ error: "Early access isn't fully configured on this site yet." }), {
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

  const name = body?.name ? String(body.name).slice(0, 200) : "";
  const email = body?.email ? String(body.email).slice(0, 200).trim() : "";
  const role = body?.role ? String(body.role).slice(0, 100) : null;
  const participants_supported = body?.participants_supported ? String(body.participants_supported).slice(0, 20) : null;
  const why = body?.why ? String(body.why).slice(0, 2000) : null;

  if (!name || !email || !email.includes("@")) {
    return new Response(JSON.stringify({ error: "Name and a valid email are required." }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const supaHeaders = {
    apikey: supaKey,
    Authorization: `Bearer ${supaKey}`,
    "Content-Type": "application/json",
  };

  try {
    // 1. Record the signup. This happens regardless of whether a code is
    // available, so the waitlist itself stays a complete, accurate record
    // even once all 50 spots are gone.
    const insertResp = await fetch(`${supaUrl}/rest/v1/waitlist_signups`, {
      method: "POST",
      headers: supaHeaders,
      body: JSON.stringify({
        name, email, role, participants_supported, why,
        source: "waitlist_landing",
      }),
    });
    if (!insertResp.ok) {
      const detail = await insertResp.text().catch(() => "");
      throw new Error(`waitlist insert failed: ${detail}`);
    }

    // 2. Try to atomically claim the next available code.
    const rpcResp = await fetch(`${supaUrl}/rest/v1/rpc/assign_next_code`, {
      method: "POST",
      headers: supaHeaders,
      body: JSON.stringify({ p_email: email }),
    });
    if (!rpcResp.ok) {
      const detail = await rpcResp.text().catch(() => "");
      throw new Error(`code assignment failed: ${detail}`);
    }
    const assignedCode = await rpcResp.json(); // string, or null if none left

    // 3. Email them -- which email depends on whether a code was actually
    // available. Either way they get something, nobody is left wondering.
    const built = assignedCode
      ? invitedEmail({ name, code: assignedCode, siteUrl })
      : waitlistedEmail({ name });
    await sendEmail({ apiKey: resendKey, to: email, ...built });

    // 4. Tell Ev too. Wrapped separately so a problem here (a typo'd
    // address, Resend hiccup) never turns into an error shown to the
    // person signing up -- their signup already fully succeeded above.
    try {
      await sendEmail({
        apiKey: resendKey,
        to: ADMIN_ADDRESS,
        ...adminNotifyEmail({ name, email, role, participants_supported, why, assignedCode }),
      });
    } catch (e) {
      console.error("admin notify failed:", e?.message || e);
    }

    return new Response(JSON.stringify({ ok: true, invited: !!assignedCode }), {
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
