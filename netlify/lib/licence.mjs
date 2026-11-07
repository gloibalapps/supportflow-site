// Shared server-side licensing logic. Imported by netlify/functions/licence.mjs,
// stripe-webhook.mjs, charge-invoice.mjs and the AI functions. Never shipped to
// the browser.
//
// Model (see LICENSING.md):
//   * The licence belongs to a Google account (ID-token `sub`), never a key.
//   * plan 1 = Basic, one device (A$79). plan 2 = two devices (A$29 add-on, or Premium).
//   * A device is an active signed-in install: { deviceId, label, firstSeen,
//     lastSeen }. It stops counting after 21 days without a check-in.
//   * Paid status is written only by the Stripe webhook.
//   * The browser receives a signed 7-day offline lease (ECDSA P-256) that it
//     can verify offline with the public key. The private key is derived from
//     LICENCE_SECRET and never leaves the server.
//
// Env (Netlify -> Site configuration -> Environment variables):
//   LICENCE_SECRET          long random string; signs sessions + leases (required)
//   GOOGLE_CLIENT_ID        already set for Google Drive backup; also the ID-token audience
//   SUPABASE_URL / SUPABASE_SERVICE_KEY   already set
//   LICENSING_ENABLED       optional hard override: "true" / "false". When unset,
//                           the app_config row 'licensing_enabled' decides.
//   LICENSING_TEST_EMAILS   optional, comma-separated Google emails that are
//                           enforced even while the switch is off (owner testing)
//   RESEND_API_KEY, LICENCE_EMAIL_FROM   for the "licence moved" email

import crypto from "node:crypto";

export const STALE_DAYS = 21;
export const LEASE_DAYS = 7;
export const SESSION_DAYS = 90;
export const PLAN_NAMES = Object.freeze({ 1: "One device", 2: "Phone and computer" });
export const PRODUCTS = Object.freeze({
  // First set env var wins. STRIPE_PRICE_79 (was _49) / _69 / _UPGRADE are the names
  // configured in Netlify; the older names are kept as fallbacks.
  one: { plan: 1, amount: 79, env: ["STRIPE_PRICE_79", "STRIPE_PRICE_49", "STRIPE_PRICE_LICENCE_ONE", "STRIPE_PRICE_LIFETIME"] },
  two: { plan: 2, amount: 69, env: ["STRIPE_PRICE_69", "STRIPE_PRICE_LICENCE_TWO"] },
  upgrade: { plan: 2, amount: 29, env: ["STRIPE_PRICE_UPGRADE", "STRIPE_PRICE_LICENCE_UPGRADE"] },
});

const DAY = 86400000;
const enc = (buf) => Buffer.from(buf).toString("base64url");
const dec = (s) => Buffer.from(String(s), "base64url");

export const json = (obj, status = 200, headers = {}) =>
  new Response(JSON.stringify(obj), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store", ...headers },
  });

/* ---------------- Supabase (PostgREST) ---------------- */
export function supaConfigured() {
  return !!(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_KEY);
}
function supaHeaders(extra = {}) {
  return {
    apikey: process.env.SUPABASE_SERVICE_KEY,
    Authorization: `Bearer ${process.env.SUPABASE_SERVICE_KEY}`,
    "Content-Type": "application/json",
    ...extra,
  };
}
export async function supa(path, { method = "GET", body, prefer } = {}) {
  const resp = await fetch(`${process.env.SUPABASE_URL}/rest/v1/${path}`, {
    method,
    headers: supaHeaders(prefer ? { Prefer: prefer } : {}),
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!resp.ok) {
    const text = await resp.text().catch(() => "");
    const err = new Error(`Supabase ${method} ${path.split("?")[0]} failed: ${resp.status} ${text}`);
    err.status = resp.status;
    throw err;
  }
  if (resp.status === 204) return null;
  const text = await resp.text();
  return text ? JSON.parse(text) : null;
}
const q = encodeURIComponent;

/* ---------------- owner switch ---------------- */
let switchCache = { at: 0, value: false };
export async function licensingSwitchOn() {
  const env = String(process.env.LICENSING_ENABLED || "").trim().toLowerCase();
  if (env === "true" || env === "1" || env === "on") return true;
  if (env === "false" || env === "0" || env === "off") return false;
  if (!supaConfigured()) return false;
  if (Date.now() - switchCache.at < 30000) return switchCache.value;
  try {
    const rows = await supa(`app_config?key=eq.licensing_enabled&select=value`);
    const v = String(rows?.[0]?.value || "").trim().toLowerCase();
    switchCache = { at: Date.now(), value: v === "true" || v === "1" || v === "on" };
  } catch (e) {
    // Table missing (migration not run yet) or Supabase down: stay off rather
    // than lock anyone out. Cached briefly so a hiccup doesn't flap.
    console.warn("licence: couldn't read app_config, treating licensing as off:", e.message);
    switchCache = { at: Date.now(), value: switchCache.value };
  }
  return switchCache.value;
}
export function isTestEmail(email) {
  const list = String(process.env.LICENSING_TEST_EMAILS || "")
    .split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
  return !!email && list.includes(String(email).toLowerCase());
}
/** Is licensing enforced for this (possibly unknown) account? */
export async function enforcedFor(email) {
  return (await licensingSwitchOn()) || isTestEmail(email);
}

/* ---------------- keys: sessions (HMAC) + leases (ECDSA P-256) ---------------- */
function secret() {
  const s = process.env.LICENCE_SECRET;
  if (!s || s.length < 24) throw new Error("LICENCE_SECRET is missing or shorter than 24 characters");
  return s;
}
const subKey = (label) => crypto.createHmac("sha256", secret()).update(label).digest();

let leaseKeys = null;
const P256_N = BigInt("0xffffffff00000000ffffffffffffffffbce6faada7179e84f3b9cac2fc632551");
export function getLeaseKeys() {
  if (leaseKeys && leaseKeys.secret === process.env.LICENCE_SECRET) return leaseKeys;
  // Deterministic P-256 key from the secret, so the owner manages one value.
  let d = BigInt("0x" + subKey("supportflow-lease-p256-v1").toString("hex"));
  d = (d % (P256_N - 1n)) + 1n;
  const dBuf = Buffer.from(d.toString(16).padStart(64, "0"), "hex");
  const ecdh = crypto.createECDH("prime256v1");
  ecdh.setPrivateKey(dBuf);
  const pub = ecdh.getPublicKey(null, "uncompressed"); // 0x04 || X || Y
  const x = enc(pub.subarray(1, 33)), y = enc(pub.subarray(33, 65));
  const privateKey = crypto.createPrivateKey({ key: { kty: "EC", crv: "P-256", d: enc(dBuf), x, y }, format: "jwk" });
  leaseKeys = { secret: process.env.LICENCE_SECRET, privateKey, publicJwk: { kty: "EC", crv: "P-256", x, y } };
  return leaseKeys;
}

export function signSession({ sub, email, name, ev }) {
  const now = Date.now();
  const payload = enc(JSON.stringify({ v: 1, sub, email: email || "", name: name || "", ev: ev === true, iat: now, exp: now + SESSION_DAYS * DAY }));
  const sig = enc(crypto.createHmac("sha256", subKey("supportflow-session-v1")).update(payload).digest());
  return `${payload}.${sig}`;
}
export const RENEW_GRACE_DAYS = 365;
// One-use-style email links for restoring a purchase onto a new device. The
// token proves the person controls the checkout inbox: it is only ever sent
// to that address. Signed with its own key, valid for 15 minutes.
export const RESTORE_LINK_MINUTES = 15;
export function signRestoreToken({ accountId, email }) {
  const payload = enc(JSON.stringify({ v: 1, a: accountId, e: String(email || "").toLowerCase(), exp: Date.now() + RESTORE_LINK_MINUTES * 60000, n: crypto.randomBytes(8).toString("hex") }));
  const sig = enc(crypto.createHmac("sha256", subKey("supportflow-restore-v1")).update(payload).digest());
  return `${payload}.${sig}`;
}
export function verifyRestoreToken(token) {
  if (typeof token !== "string" || token.length > 2000) return null;
  const [payload, sig] = token.split(".");
  if (!payload || !sig) return null;
  const expected = crypto.createHmac("sha256", subKey("supportflow-restore-v1")).update(payload).digest();
  const got = dec(sig);
  if (got.length !== expected.length || !crypto.timingSafeEqual(got, expected)) return null;
  try {
    const p = JSON.parse(dec(payload).toString("utf8"));
    if (p.v !== 1 || !p.a || !p.exp || p.exp < Date.now() || !isUuid(p.a)) return null;
    return p;
  } catch { return null; }
}
export function verifySession(token, { allowExpiredDays = 0 } = {}) {
  if (typeof token !== "string" || token.length > 4000) return null;
  const [payload, sig] = token.split(".");
  if (!payload || !sig) return null;
  const expected = crypto.createHmac("sha256", subKey("supportflow-session-v1")).update(payload).digest();
  const got = dec(sig);
  if (got.length !== expected.length || !crypto.timingSafeEqual(got, expected)) return null;
  try {
    const p = JSON.parse(dec(payload).toString("utf8"));
    if (!p.sub || !p.exp || p.exp + allowExpiredDays * DAY < Date.now()) return null;
    return p;
  } catch { return null; }
}

export function signLease({ sub, deviceId, plan }) {
  const now = Date.now();
  const payload = enc(JSON.stringify({ v: 1, sub, did: deviceId, plan, iat: now, exp: now + LEASE_DAYS * DAY }));
  const sig = crypto.sign("sha256", Buffer.from(payload), { key: getLeaseKeys().privateKey, dsaEncoding: "ieee-p1363" });
  return `${payload}.${enc(sig)}`;
}
export function verifyLease(lease) {
  const [payload, sig] = String(lease || "").split(".");
  if (!payload || !sig) return null;
  const ok = crypto.verify("sha256", Buffer.from(payload), { key: crypto.createPublicKey({ key: getLeaseKeys().publicJwk, format: "jwk" }), dsaEncoding: "ieee-p1363" }, dec(sig));
  if (!ok) return null;
  const p = JSON.parse(dec(payload).toString("utf8"));
  return p.exp > Date.now() ? p : null;
}

/* ---------------- Google ID token ---------------- */
let jwksCache = { at: 0, keys: [] };
async function googleKeys(force = false) {
  if (!force && Date.now() - jwksCache.at < 3600000 && jwksCache.keys.length) return jwksCache.keys;
  const r = await fetch("https://www.googleapis.com/oauth2/v3/certs");
  if (!r.ok) throw new Error(`Google certs ${r.status}`);
  jwksCache = { at: Date.now(), keys: (await r.json()).keys || [] };
  return jwksCache.keys;
}
export async function verifyGoogleIdToken(idToken) {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  if (!clientId) throw new Error("GOOGLE_CLIENT_ID not set");
  const parts = String(idToken || "").split(".");
  if (parts.length !== 3) return null;
  let header, claims;
  try {
    header = JSON.parse(dec(parts[0]).toString("utf8"));
    claims = JSON.parse(dec(parts[1]).toString("utf8"));
  } catch { return null; }
  if (header.alg !== "RS256" || !header.kid) return null;
  let jwk = (await googleKeys()).find((k) => k.kid === header.kid);
  if (!jwk) jwk = (await googleKeys(true)).find((k) => k.kid === header.kid);
  if (!jwk) return null;
  const key = crypto.createPublicKey({ key: jwk, format: "jwk" });
  const ok = crypto.verify("RSA-SHA256", Buffer.from(`${parts[0]}.${parts[1]}`), key, dec(parts[2]));
  if (!ok) return null;
  const now = Math.floor(Date.now() / 1000);
  if (!["accounts.google.com", "https://accounts.google.com"].includes(claims.iss)) return null;
  if (claims.aud !== clientId) return null;
  if (!claims.exp || claims.exp < now - 60) return null;
  if (!claims.sub) return null;
  if (claims.email && claims.email_verified === false) return null;
  return { sub: String(claims.sub), email: claims.email || "", name: claims.name || "", ev: claims.email_verified === true };
}

/* ---------------- data access ---------------- */
export async function getLicence(sub) {
  const rows = await supa(`licences?google_sub=eq.${q(sub)}&select=*`);
  return rows?.[0] || null;
}
// A licence granted by email before the person first signed in lives under
// google_sub "email:<lowercased address>". On a verified Google sign-in with
// that address, move it (plan, payments, devices) onto the real Google sub and
// delete the placeholder. Idempotent: does nothing once the row is gone.
export const emailSub = (email) => `email:${String(email || "").trim().toLowerCase()}`;
export async function adoptEmailLicence(sub, email) {
  if (!email || String(sub).startsWith("email:")) return null;
  const from = emailSub(email);
  const src = await getLicence(from);
  if (!src) return null;
  const cur = await getLicence(sub);
  const curPlan = cur?.status === "active" ? cur.plan : 0;
  const srcPlan = src.status === "active" ? src.plan : 0;
  const plan = Math.max(curPlan, srcPlan);
  await supa("licences?on_conflict=google_sub", {
    method: "POST",
    body: {
      google_sub: sub, email: String(email).trim().toLowerCase(), plan,
      status: plan >= 1 ? "active" : (cur?.status || src.status),
      purchased_at: cur?.purchased_at || src.purchased_at,
      stripe_payment_intent_id: cur?.stripe_payment_intent_id || src.stripe_payment_intent_id,
      updated_at: new Date().toISOString(),
    },
    prefer: "resolution=merge-duplicates,return=minimal",
  });
  const moved = (await supa(`licence_payments?google_sub=eq.${q(from)}&select=id`)) || [];
  if (moved.length) await supa(`licence_payments?google_sub=eq.${q(from)}`, { method: "PATCH", body: { google_sub: sub }, prefer: "return=minimal" });
  // Placeholder rows normally have no devices; drop any rather than risk a
  // primary-key clash on (google_sub, device_id).
  await supa(`licence_devices?google_sub=eq.${q(from)}`, { method: "DELETE", prefer: "return=minimal" });
  await supa(`licences?google_sub=eq.${q(from)}`, { method: "DELETE", prefer: "return=minimal" });
  // Moved Stripe payments: let recompute derive the plan, but never below what
  // was already granted (manual grants have no payment rows).
  if (moved.length) {
    const re = await recomputeLicence(sub);
    if (re && re.plan < plan) await supa(`licences?google_sub=eq.${q(sub)}`, { method: "PATCH", body: { plan, status: "active" }, prefer: "return=minimal" });
  }
  return getLicence(sub);
}

export async function listDevices(sub) {
  return (await supa(`licence_devices?google_sub=eq.${q(sub)}&select=*&order=last_seen.desc`)) || [];
}
export const staleCutoff = (now = Date.now()) => now - STALE_DAYS * DAY;
export function isActiveDevice(d, now = Date.now()) {
  return !d.revoked_at && new Date(d.last_seen).getTime() >= staleCutoff(now);
}
export function publicDevice(d, currentId) {
  return { id: d.device_id, label: d.label, firstSeen: d.first_seen, lastSeen: d.last_seen, current: d.device_id === currentId };
}
export function isUuid(s) {
  return typeof s === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);
}
export function cleanLabel(s) {
  return String(s || "").replace(/[^\w ()+.,'\-]/g, "").trim().slice(0, 60) || "Unknown device";
}

export async function activateDevice(sub, deviceId, label, replaceId = null) {
  return supa("rpc/licence_activate_device", {
    method: "POST",
    body: { p_sub: sub, p_device: deviceId, p_label: cleanLabel(label), p_replace: replaceId, p_stale_days: STALE_DAYS },
  });
}

// Earlier "Lifetime" buyers were keyed by the browser's ndis:deviceRef
// (accounts row with the 99999 / 2099 marker, see check-status.mjs). The first
// time they sign in with Google on a device carrying that ref, the purchase is
// carried over as a "One device" licence. Each legacy purchase can only be
// claimed by one Google account (licences.legacy_account_id is unique).
export async function claimLegacyLifetime(sub, email, legacyRef) {
  if (!isUuid(legacyRef)) return null;
  const rows = await supa(`accounts?id=eq.${q(legacyRef)}&select=id,credit_balance,credits_expire_at`);
  const a = rows?.[0];
  if (!a) return null;
  const bal = Number(a.credit_balance) || 0;
  const exp = a.credits_expire_at ? new Date(a.credits_expire_at) : null;
  const lifetime = bal >= 99999 || (bal >= 90000 && exp && exp.getUTCFullYear() >= 2090);
  if (!lifetime) return null;
  const taken = await supa(`licences?legacy_account_id=eq.${q(legacyRef)}&select=google_sub`);
  if (taken?.length && taken[0].google_sub !== sub) return null;
  const existing = await getLicence(sub);
  const now = new Date().toISOString();
  const row = {
    google_sub: sub, email, legacy_account_id: legacyRef, updated_at: now,
    plan: Math.max(1, existing?.status === "active" ? existing.plan : 0),
    status: "active",
    purchased_at: existing?.purchased_at || now,
  };
  await supa("licences?on_conflict=google_sub", { method: "POST", body: row, prefer: "resolution=merge-duplicates,return=minimal" });
  return getLicence(sub);
}

/**
 * The heartbeat decision. Returns the payload the app acts on:
 *   active        -> lease issued, app unlocked
 *   unpaid        -> show buy screen (revoked:true if a refund/dispute removed it)
 *   slots_full    -> show "Move the licence here?" / pick a device to replace
 *   device_removed-> this install was moved/removed; offer to use the licence here
 */
export async function evaluate({ sub, email, emailVerified, deviceId, label, legacyRef }) {
  let lic = await getLicence(sub);
  if (emailVerified && email && (!lic || lic.status !== "active" || lic.plan < 2)) {
    lic = (await adoptEmailLicence(sub, email).catch((e) => { console.warn("email licence adopt failed", e.message); return null; })) || lic;
  }
  if ((!lic || lic.status !== "active") && legacyRef) {
    lic = (await claimLegacyLifetime(sub, email, legacyRef).catch((e) => { console.warn("legacy claim failed", e.message); return null; })) || lic;
  }
  if (lic && email && lic.email !== email) {
    supa(`licences?google_sub=eq.${q(sub)}`, { method: "PATCH", body: { email }, prefer: "return=minimal" }).catch(() => {});
  }
  if (!lic || lic.status !== "active" || lic.plan < 1) {
    return { state: "unpaid", revoked: !!lic && lic.status === "revoked" && (!!lic.purchased_at) };
  }
  const plan = lic.plan;
  const now = Date.now();
  const devices = await listDevices(sub);
  const active = devices.filter((d) => isActiveDevice(d, now));
  const me = devices.find((d) => d.device_id === deviceId);
  const base = { plan, planName: PLAN_NAMES[plan], cap: plan };
  const view = (list) => list.map((d) => publicDevice(d, deviceId));

  if (me && isActiveDevice(me, now)) {
    await supa(`licence_devices?google_sub=eq.${q(sub)}&device_id=eq.${q(deviceId)}&revoked_at=is.null`, {
      method: "PATCH", body: { last_seen: new Date(now).toISOString(), label: cleanLabel(label) }, prefer: "return=minimal",
    });
    const fresh = active.map((d) => (d.device_id === deviceId ? { ...d, last_seen: new Date(now).toISOString(), label: cleanLabel(label) } : d));
    return { state: "active", ...base, devices: view(fresh), lease: signLease({ sub, deviceId, plan }) };
  }
  if (me && me.revoked_at) {
    // Moved away or removed: never silently re-take a slot. The person
    // chooses "Use the licence on this device" (activate) instead.
    return { state: "device_removed", reason: me.revoked_reason || "removed", ...base, devices: view(active) };
  }
  if (active.length < plan) {
    const r = await activateDevice(sub, deviceId, label, null);
    if (r?.ok) return evaluate({ sub, email, deviceId, label });
  }
  return { state: "slots_full", ...base, devices: view(active) };
}

/* ---------------- payments -> licence ---------------- */
// Recompute plan/status from whatever is still paid. Refunds/disputes call this.
export async function recomputeLicence(sub) {
  const lic = await getLicence(sub);
  const pays = (await supa(`licence_payments?google_sub=eq.${q(sub)}&select=*&order=created_at.asc`)) || [];
  const paid = pays.filter((p) => p.status === "paid");
  let plan = lic?.legacy_account_id ? 1 : 0;
  if (paid.some((p) => p.product === "one")) plan = Math.max(plan, 1);
  if (paid.some((p) => p.product === "two")) plan = 2;
  if (plan >= 1 && paid.some((p) => p.product === "upgrade")) plan = 2;
  // Premium is the two-device licence plus the Payment tracker, one payment.
  if (paid.some((p) => p.product === "tracker_full")) plan = Math.max(plan, 2);
  const base = paid.find((p) => p.product === "two") || paid.find((p) => p.product === "one");
  const upg = paid.find((p) => p.product === "upgrade");
  const row = {
    google_sub: sub,
    plan,
    status: plan >= 1 ? "active" : "revoked",
    purchased_at: lic?.purchased_at || (base ? base.created_at : null),
    stripe_payment_intent_id: base?.stripe_payment_intent_id || lic?.stripe_payment_intent_id || null,
    upgrade_payment_intent_id: plan === 2 && upg ? upg.stripe_payment_intent_id : null,
    updated_at: new Date().toISOString(),
  };
  await supa("licences?on_conflict=google_sub", { method: "POST", body: row, prefer: "resolution=merge-duplicates,return=minimal" });
  return row;
}

/* ---------------- email ---------------- */
export async function sendEmail(to, subject, text) {
  const key = process.env.RESEND_API_KEY;
  if (!key || !to) { console.warn("licence: email not sent (RESEND_API_KEY or address missing)"); return false; }
  try {
    const r = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from: process.env.LICENCE_EMAIL_FROM || "SupportFlow <no-reply@supportflow.work>", to: [to], subject, text }),
    });
    if (!r.ok) console.warn("licence: Resend", r.status, await r.text().catch(() => ""));
    return r.ok;
  } catch (e) { console.warn("licence: email failed", e.message); return false; }
}

/* ---------------- request helper for other functions ---------------- */
// Used by charge-invoice / AI functions: is this request from a licensed,
// active device? Returns { enforced, ok, sub }.
export async function checkRequestLicence(req, body = null) {
  const token = req.headers.get("x-sf-licence") || body?.licenceSession || "";
  const deviceId = req.headers.get("x-sf-device") || body?.licenceDevice || "";
  let session = null;
  try { session = token ? verifySession(token) : null; } catch { session = null; }
  const enforced = await enforcedFor(session?.email);
  if (!session || !isUuid(deviceId) || !supaConfigured()) return { enforced, ok: false };
  try {
    const lic = await getLicence(session.sub);
    if (!lic || lic.status !== "active" || lic.plan < 1) return { enforced, ok: false, sub: session.sub };
    const rows = await supa(`licence_devices?google_sub=eq.${q(session.sub)}&device_id=eq.${q(deviceId)}&select=*`);
    return { enforced, ok: !!rows?.[0] && isActiveDevice(rows[0]), sub: session.sub };
  } catch (e) {
    console.warn("licence check failed", e.message);
    return { enforced, ok: false, error: true };
  }
}
