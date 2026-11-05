// Payment tracker add-on API. See PAYMENT-TRACKER.md.
//
//   GET  ?action=config                       -> { offer, clientId, autosendServer, vapidPublicKey }
//   POST { action: "signin",   idToken, deviceId }            Google sign-in (works with licensing off)
//   POST { action: "status",   session, deviceId }            -> { unlocked, product, prefs }
//   POST { action: "checkout", session, deviceId, product }   -> { url }  (tracker_base | tracker_two | tracker_addon | tracker_full | tracker_sms)
//   POST { action: "sync",     session, deviceId, prefs, records[] }   needs unlock
//   POST { action: "forget",   session, deviceId }            turn auto-send off and delete synced records
//   POST { action: "log",      session, deviceId }            -> { log: [...] } this worker's send log
//   POST { action: "push",     session, deviceId, subscription | null }
//   POST { action: "sms-start",  session, deviceId, phone, optIn: true }  send a 6-digit code to the worker's own mobile
//   POST { action: "sms-verify", session, deviceId, code }
//   POST { action: "sms-optout", session, deviceId }                     same effect as replying STOP
//   POST { action: "sms-manage", session, deviceId }   -> { url } Stripe customer portal (cancel the SMS pack)
//
// Nothing here sends email. The scheduled tracker-sender.mjs does, and only
// when TRACKER_AUTOSEND_ENABLED=true.
import crypto from "node:crypto";
import { json, supa, supaConfigured, signSession, verifySession, verifyGoogleIdToken, isUuid } from "../lib/licence.mjs";
import { TRACKER_PRODUCTS, isTrackerProduct, trackerOffer, trackerUnlock, trackerDeviceOk, autosendEnabled, seal, emailHash } from "../lib/tracker.mjs";
import { TRACKER_STATES } from "../../payment-tracker-rules.js";
import { normaliseAuMobile, maskPhone, rawSend, smsEnabled, smsDryRun } from "../lib/sms.mjs";
import { open as openSealed } from "../lib/tracker.mjs";

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
  const isSub = product === "tracker_sms";
  // A$29 upgrade: ONLY for existing A$49 (tracker_base) holders on one computer.
  if (product === "tracker_addon" && (!have || have.product !== "tracker_base" || have.addon)) {
    return json({ error: !have ? "The A$29 upgrade is for A$49 Payment tracker owners. Buy the tracker first." : "This account already covers two computers." }, 409);
  }
  if (!isSub && product !== "tracker_addon" && have?.full) return json({ error: "This account already has the complete package." }, 409);
  if ((product === "tracker_base" || product === "tracker_two") && have) {
    if (have.devices >= 2) return json({ error: "This account already covers two computers." }, 409);
    return json({ error: "Payment tracker is already unlocked. Add a second computer with the A$29 upgrade instead.", addon: true }, 409);
  }
  const meta = { kind: "tracker", product, google_sub: session.sub, device_id: deviceId };
  if (isSub) {
    // Optional SMS pack: tracker owners (base or full) only, one active pack per account.
    if (!have) return json({ error: "SMS alerts are an option for Payment tracker owners. Unlock the tracker first." }, 409);
    const cur = await supa(`tracker_sms_subscriptions?google_sub=eq.${q(session.sub)}&status=in.(active,trialing,past_due)&select=stripe_subscription_id`);
    if (cur?.length) return json({ error: "SMS alerts are already active on this account." }, 409);
  }
  const params = {
    mode: isSub ? "subscription" : "payment",
    "line_items[0][price]": price,
    "line_items[0][quantity]": 1,
    client_reference_id: session.sub,
    success_url: `${site}/app?tracker=success`,
    cancel_url: `${site}/app?tracker=cancelled`,
  };
  if (!isSub) params.customer_creation = "always"; // subscription mode always creates a customer
  if (session.email) params.customer_email = session.email;
  const metaKey = isSub ? "subscription_data[metadata]" : "payment_intent_data[metadata]";
  for (const [k, v] of Object.entries(meta)) { params[`metadata[${k}]`] = v; params[`${metaKey}[${k}]`] = v; }
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

/* ---------------- SMS add-on: opt-in + number verification ---------------- */
async function smsStatus(sub) {
  const [prof, subn, bal] = await Promise.all([
    supa(`tracker_sms_profiles?google_sub=eq.${q(sub)}&select=phone_enc,verified_at,opted_in,stopped_at`).then((r) => r?.[0]),
    supa(`tracker_sms_subscriptions?google_sub=eq.${q(sub)}&select=status,current_period_end&order=updated_at.desc&limit=1`).then((r) => r?.[0]),
    supa(`tracker_sms_balances?google_sub=eq.${q(sub)}&select=balance,period_end`).then((r) => r?.[0]),
  ]);
  let phone = null;
  try { phone = prof?.phone_enc ? maskPhone(openSealed(prof.phone_enc).phone) : null; } catch { phone = null; }
  return {
    subscription: subn?.status || null, renews: subn?.current_period_end || null,
    balance: Number(bal?.balance || 0), phone, verified: !!prof?.verified_at, optedIn: !!prof?.opted_in && !prof?.stopped_at,
    serverEnabled: smsEnabled(), dryRun: smsDryRun(),
  };
}
const codeHash = (sub, code) => crypto.createHmac("sha256", process.env.LICENCE_SECRET || "").update(`smscode|${sub}|${code}`).digest("hex");
async function smsStart(session, body) {
  const phone = normaliseAuMobile(body?.phone);
  if (!phone) return json({ error: "Enter an Australian mobile number, like 0412 345 678." }, 400);
  if (body?.optIn !== true) return json({ error: "Tick the box to agree to SMS alerts." }, 400);
  const prev = (await supa(`tracker_sms_profiles?google_sub=eq.${q(session.sub)}&select=code_sent_at,codes_today`))?.[0];
  const sameDay = prev?.code_sent_at && prev.code_sent_at.slice(0, 10) === new Date().toISOString().slice(0, 10);
  if (prev?.code_sent_at && Date.now() - Date.parse(prev.code_sent_at) < 60000) return json({ error: "Wait a minute before asking for another code." }, 429);
  if (sameDay && (prev.codes_today || 0) >= 5) return json({ error: "Too many codes today. Try again tomorrow." }, 429);
  const code = String(crypto.randomInt(0, 1000000)).padStart(6, "0");
  const now = new Date().toISOString();
  await supa("tracker_sms_profiles?on_conflict=google_sub", {
    method: "POST", prefer: "resolution=merge-duplicates,return=minimal",
    body: { google_sub: session.sub, phone_enc: seal({ phone }), phone_hash: emailHash(phone), verified_at: null, opted_in: false, opt_in_at: now, stopped_at: null,
      code_hash: codeHash(session.sub, code), code_expires: new Date(Date.now() + 10 * 60000).toISOString(), code_attempts: 0,
      code_sent_at: now, codes_today: sameDay ? (prev.codes_today || 0) + 1 : 1, updated_at: now },
  });
  // Verification codes don't use credits. Not sent at all while SMS is off or in dry run.
  const r = await rawSend(phone, `SupportFlow code: ${code}. It expires in 10 minutes.`);
  if (r.dry) console.log(`tracker sms-start: dry run, code not sent to ${maskPhone(phone)}`);
  return json({ ok: true, sent: !r.dry, phone: maskPhone(phone) });
}
async function smsVerify(session, body) {
  const prof = (await supa(`tracker_sms_profiles?google_sub=eq.${q(session.sub)}&select=code_hash,code_expires,code_attempts`))?.[0];
  if (!prof?.code_hash || Date.parse(prof.code_expires) < Date.now()) return json({ error: "That code has expired. Ask for a new one." }, 400);
  if ((prof.code_attempts || 0) >= 5) return json({ error: "Too many tries. Ask for a new code." }, 429);
  const ok = crypto.timingSafeEqual(Buffer.from(codeHash(session.sub, String(body?.code || "").trim())), Buffer.from(prof.code_hash));
  const now = new Date().toISOString();
  await supa(`tracker_sms_profiles?google_sub=eq.${q(session.sub)}`, {
    method: "PATCH", prefer: "return=minimal",
    body: ok ? { verified_at: now, opted_in: true, code_hash: null, code_attempts: 0, updated_at: now } : { code_attempts: (prof.code_attempts || 0) + 1, updated_at: now },
  });
  if (!ok) return json({ error: "That code isn't right." }, 400);
  return json({ ok: true, sms: await smsStatus(session.sub) });
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
      return json({ sms: await smsStatus(session.sub), unlocked: !!unlock, paid: !!paid, devices: paid?.devices || 0, deviceLimit: !!paid && !seat, product: paid?.product || null, prefs: p, autosendServer: autosendEnabled() });
    }
    if (!unlock) return json({ error: paid ? "Your Payment tracker is in use on another device. Add a second computer with the A$29 upgrade." : "Payment tracker isn't unlocked on this Google account.", locked: true, deviceLimit: !!paid }, 402);

    if (action === "sync") return await sync(session, body);
    if (action === "sms-start") return await smsStart(session, body);
    if (action === "sms-verify") return await smsVerify(session, body);
    if (action === "sms-manage") {
      const row = (await supa(`tracker_sms_subscriptions?google_sub=eq.${q(session.sub)}&select=stripe_customer_id&order=updated_at.desc&limit=1`))?.[0];
      if (!row?.stripe_customer_id || !process.env.STRIPE_SECRET_KEY) return json({ error: "No SMS pack found on this account." }, 404);
      const r = await fetch(`${STRIPE_API}/billing_portal/sessions`, {
        method: "POST", headers: { Authorization: `Bearer ${process.env.STRIPE_SECRET_KEY}`, "Content-Type": "application/x-www-form-urlencoded" },
        body: formBody({ customer: row.stripe_customer_id, return_url: `${process.env.SITE_URL}/app?open=tracker` }),
      });
      const d = await r.json();
      return r.ok ? json({ url: d.url }) : json({ error: d?.error?.message || "Couldn't open billing." }, 502);
    }
    if (action === "sms-optout") {
      await supa(`tracker_sms_profiles?google_sub=eq.${q(session.sub)}`, { method: "PATCH", prefer: "return=minimal", body: { opted_in: false, stopped_at: new Date().toISOString(), updated_at: new Date().toISOString() } });
      return json({ ok: true, sms: await smsStatus(session.sub) });
    }
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
