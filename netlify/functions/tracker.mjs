// Payment tracker add-on API. See PAYMENT-TRACKER.md.
//
//   GET  ?action=config                       -> { offer, clientId, autosendServer, vapidPublicKey }
//   POST { action: "signin",   idToken, deviceId }            Google sign-in (works with licensing off)
//   POST { action: "status",   session, deviceId }            -> { unlocked, product, prefs }
//   POST { action: "checkout", session, deviceId, product }   -> { url }  (tracker | tracker_second_device)
//   POST { action: "sync",     session, deviceId, prefs, records[] }   needs unlock
//   POST { action: "forget",   session, deviceId }            turn auto-send off and delete synced records
//   POST { action: "log",      session, deviceId }            -> { log: [...] } this worker's send log
//   POST { action: "push",     session, deviceId, subscription | null }
//
// Nothing here sends email. The scheduled tracker-sender.mjs does, and only
// when TRACKER_AUTOSEND_ENABLED=true.
import crypto from "node:crypto";
import { json, supa, supaConfigured, signSession, verifySession, verifyGoogleIdToken, isUuid } from "../lib/licence.mjs";
import { TRACKER_PRODUCTS, isTrackerProduct, trackerOffer, trackerUnlock, trackerDeviceOk, autosendEnabled, seal, emailHash } from "../lib/tracker.mjs";
import { TRACKER_STATES } from "../../payment-tracker-rules.js";

const STRIPE_API = "https://api.stripe.com/v1";
const formBody = (o) => Object.entries(o).map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join("&");
const q = encodeURIComponent;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const EMAIL = /^[^\s@<>"]{1,64}@[^\s@<>"]{1,190}\.[a-z]{2,}$/i;
const clip = (s, n) => String(s ?? "").slice(0, n);

function sameOrigin(req) {
  const origin = req.headers.get("origin"), host = req.headers.get("host");
  if (!origin || !host) return true;
  try { return new URL(origin).host === host; } catch { return false; }
}
const recordId = (sub, invoiceId) => crypto.createHmac("sha256", process.env.LICENCE_SECRET || "").update(`${sub}|${invoiceId}`).digest("hex").slice(0, 40);

async function checkout(session, deviceId, body) {
  const key = process.env.STRIPE_SECRET_KEY, site = process.env.SITE_URL;
  if (!key || !site) return json({ error: "Payments aren't set up on this site yet." }, 500);
  const product = String(body?.product || "");
  if (!isTrackerProduct(product)) return json({ error: "Choose an option." }, 400);
  const price = process.env[TRACKER_PRODUCTS[product].env];
  if (!price) return json({ error: "That option isn't available yet." }, 500);
  const have = await trackerUnlock(session.sub);
  if (product === "tracker" && have) return json({ error: "Payment tracker is already unlocked on this Google account." }, 409);
  if (product === "tracker_second_device" && !have) return json({ error: "Unlock the Payment tracker first, then add a second device." }, 409);
  if (product === "tracker_second_device" && have.secondDevice) return json({ error: "This account already covers two devices." }, 409);
  const meta = { kind: "tracker", product, google_sub: session.sub, device_id: deviceId };
  const params = {
    mode: "payment",
    "line_items[0][price]": price,
    "line_items[0][quantity]": 1,
    client_reference_id: session.sub,
    customer_creation: "always",
    success_url: `${site}/app?tracker=success`,
    cancel_url: `${site}/app?tracker=cancelled`,
  };
  if (session.email) params.customer_email = session.email;
  for (const [k, v] of Object.entries(meta)) { params[`metadata[${k}]`] = v; params[`payment_intent_data[metadata][${k}]`] = v; }
  try {
    const r = await fetch(`${STRIPE_API}/checkout/sessions`, {
      method: "POST", headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/x-www-form-urlencoded" }, body: formBody(params),
    });
    const s = await r.json();
    if (!r.ok) return json({ error: s?.error?.message || "Stripe couldn't start checkout." }, 502);
    return json({ url: s.url });
  } catch { return json({ error: "Couldn't reach Stripe. Try again in a moment." }, 502); }
}

function cleanPrefs(p) {
  return {
    enabled: p?.enabled === true,
    state: TRACKER_STATES.includes(p?.state) ? p.state : "SA",
    notify_push: p?.notifyPush !== false,
    notify_email: p?.notifyEmail !== false,
  };
}
// Minimised record: scheduling fields in the clear, everything identifying sealed.
function cleanRecord(sub, r) {
  if (!r || !r.id || !DATE.test(r.sentAt || "")) return null;
  const payerType = ["plan", "self", "agency"].includes(r.payerType) ? r.payerType : "plan";
  const to = EMAIL.test(r.recipientEmail || "") ? r.recipientEmail.trim() : "";
  const th = Array.isArray(r.thresholds) && r.thresholds.length === 3 && r.thresholds.every((n) => Number.isInteger(n) && n > 0 && n < 120) ? r.thresholds : null;
  const msg = (m) => (m && typeof m === "object" ? { subject: clip(m.subject, 200), body: clip(m.body, 6000) } : null);
  return {
    id: recordId(sub, String(r.id)),
    google_sub: sub,
    sent_at: r.sentAt,
    due: DATE.test(r.due || "") ? r.due : null,
    payer_type: payerType,
    thresholds: th,
    paused: r.paused === true,
    closed: false,
    recipient_hash: to ? emailHash(to) : null,
    payload_enc: seal({
      invoiceId: clip(r.id, 80), invoiceNo: clip(r.invoiceNo, 40), amount: clip(r.amount, 20), to, toName: clip(r.recipientName, 80),
      m1: msg(r.messages?.[1]), m2: msg(r.messages?.[2]), m3: msg(r.messages?.[3]),
    }),
    updated_at: new Date().toISOString(),
  };
}

async function sync(session, body) {
  const prefsIn = body?.prefs || {};
  const replyTo = EMAIL.test(prefsIn.replyTo || "") ? prefsIn.replyTo.trim() : "";
  const prefs = cleanPrefs(prefsIn);
  if (prefs.enabled && !replyTo) return json({ error: "Add your email address so replies come back to you." }, 400);
  await supa("tracker_prefs?on_conflict=google_sub", {
    method: "POST", prefer: "resolution=merge-duplicates,return=minimal",
    body: { google_sub: session.sub, ...prefs, worker_enc: seal({ replyTo, name: clip(prefsIn.workerName, 80) }), updated_at: new Date().toISOString() },
  });
  const list = (Array.isArray(body?.records) ? body.records : []).slice(0, 500).map((r) => cleanRecord(session.sub, r)).filter(Boolean);
  if (list.length) {
    // last_stage_sent is deliberately not in the body: the server owns it.
    await supa("tracker_records?on_conflict=id", { method: "POST", prefer: "resolution=merge-duplicates,return=minimal", body: list });
  }
  // Anything this device no longer reports as open (paid, deleted, stopped) is closed.
  const keep = list.map((r) => r.id);
  const now = new Date().toISOString();
  await supa(`tracker_records?google_sub=eq.${q(session.sub)}&closed=eq.false${keep.length ? `&id=not.in.(${keep.join(",")})` : ""}`, {
    method: "PATCH", prefer: "return=minimal", body: { closed: true, closed_at: now, updated_at: now },
  });
  const rows = (await supa(`tracker_records?google_sub=eq.${q(session.sub)}&closed=eq.false&select=id,last_stage_sent,last_sent_at,stop_reason`)) || [];
  // Report back by the device's own invoice ids.
  const byId = Object.fromEntries(rows.map((r) => [r.id, r]));
  const status = {};
  for (const r of (body.records || []).slice(0, 500)) { const row = byId[recordId(session.sub, String(r?.id))]; if (row) status[r.id] = { stageSent: row.last_stage_sent, sentAt: row.last_sent_at, stop: row.stop_reason }; }
  return json({ ok: true, autosendServer: autosendEnabled(), status });
}

async function forget(session) {
  await supa(`tracker_records?google_sub=eq.${q(session.sub)}`, { method: "DELETE", prefer: "return=minimal" });
  await supa(`tracker_prefs?google_sub=eq.${q(session.sub)}`, { method: "PATCH", prefer: "return=minimal", body: { enabled: false, updated_at: new Date().toISOString() } });
  return json({ ok: true });
}

export default async (req) => {
  const url = new URL(req.url);
  try {
    if (req.method === "GET") {
      return json({
        offer: trackerOffer(),
        clientId: process.env.GOOGLE_CLIENT_ID || "",
        autosendServer: autosendEnabled(),
        vapidPublicKey: process.env.VAPID_PUBLIC_KEY || "",
        ready: supaConfigured() && !!process.env.LICENCE_SECRET,
      });
    }
    if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);
    if (!sameOrigin(req)) return json({ error: "forbidden" }, 403);
    if (!supaConfigured() || !process.env.LICENCE_SECRET) return json({ error: "Payment tracker isn't set up on this site yet." }, 503);
    let body;
    try { body = await req.json(); } catch { return json({ error: "Malformed request." }, 400); }
    const action = String(body?.action || "");
    const deviceId = isUuid(body?.deviceId) ? String(body.deviceId).toLowerCase() : "";
    if (!deviceId) return json({ error: "Missing device id." }, 400);

    if (action === "signin") {
      const who = await verifyGoogleIdToken(body?.idToken).catch(() => null);
      if (!who) return json({ error: "Google sign-in couldn't be confirmed. Try again." }, 401);
      return json({ session: signSession(who) });
    }
    const session = verifySession(body?.session);
    if (!session) return json({ error: "Sign in with Google first.", signedOut: true }, 401);

    if (action === "checkout") return await checkout(session, deviceId, body);

    const paid = await trackerUnlock(session.sub);
    const seat = paid ? await trackerDeviceOk(session.sub, deviceId, paid.devices) : false;
    const unlock = paid && seat ? paid : null;
    if (action === "status") {
      const p = (await supa(`tracker_prefs?google_sub=eq.${q(session.sub)}&select=enabled,state,notify_push,notify_email`))?.[0] || null;
      return json({ unlocked: !!unlock, paid: !!paid, devices: paid?.devices || 0, deviceLimit: !!paid && !seat, product: paid?.product || null, prefs: p, autosendServer: autosendEnabled() });
    }
    if (!unlock) return json({ error: paid ? "Your Payment tracker is in use on another device. Add a second device for A$29." : "Payment tracker isn't unlocked on this Google account.", locked: true, deviceLimit: !!paid }, 402);

    if (action === "sync") return await sync(session, body);
    if (action === "forget") return await forget(session);
    if (action === "log") {
      const rows = await supa(`tracker_send_log?google_sub=eq.${q(session.sub)}&select=created_at,stage,channel,recipient_masked,invoice_no,subject,status,detail&order=created_at.desc&limit=200`);
      return json({ log: rows || [] });
    }
    if (action === "push") {
      const sub = body?.subscription;
      if (sub === null) {
        await supa(`tracker_push_subs?google_sub=eq.${q(session.sub)}&device_id=eq.${q(deviceId)}`, { method: "DELETE", prefer: "return=minimal" });
        return json({ ok: true });
      }
      if (!sub?.endpoint || !/^https:\/\//.test(sub.endpoint) || !sub?.keys?.p256dh || !sub?.keys?.auth) return json({ error: "Bad subscription." }, 400);
      await supa("tracker_push_subs?on_conflict=google_sub,device_id", {
        method: "POST", prefer: "resolution=merge-duplicates,return=minimal",
        body: { google_sub: session.sub, device_id: deviceId, sub_enc: seal({ endpoint: sub.endpoint, keys: { p256dh: sub.keys.p256dh, auth: sub.keys.auth } }), updated_at: new Date().toISOString() },
      });
      return json({ ok: true });
    }
    return json({ error: "Unknown action." }, 400);
  } catch (e) {
    console.error("tracker:", e.message);
    return json({ error: "Something went wrong. Try again." }, 500);
  }
};
