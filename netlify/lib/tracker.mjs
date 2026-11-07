// Payment tracker add-on: server helpers. See PAYMENT-TRACKER.md.
//
// Entitlement: a paid unlock is a row in licence_payments with product
// "tracker_base" (+ optional "tracker_addon"), "tracker_two" or "tracker_full", written ONLY by stripe-webhook.mjs (same rule as
// licences: the browser's ?tracker=success return never unlocks anything).
//
// Prices (homepage structure, November 2026):
//   STRIPE_PRICE_TRACKER         A$29 one-off Payment tracker, on top of Basic.
//                                A second device is NOT part of this price. It is
//                                the separate licence add-on (STRIPE_PRICE_UPGRADE, A$29).
//   STRIPE_PRICE_TRACKER_FULL    A$129 one-off Premium: everything in
//                                Basic, two-device licence, Payment tracker. SMS is not included.
//   STRIPE_PRICE_TRACKER_SMS     A$4.99 / month, 50 texts, only after the tracker is unlocked.
//                                Not included in Basic, the tracker, or Premium.
// Retired, still recognised so older payments keep their unlock, never sold:
//   tracker_base, tracker_two, tracker_addon.
import crypto from "node:crypto";
import { supa } from "./licence.mjs";
import { PREMIUM_AUD, premiumCheckoutSelection, premiumPublic } from "./premium.mjs";

const PREMIUM_ITEMS = [
  "Everything in Basic (invoices, shifts, notes, kilometres, expenses and tax)",
  "Two-device license",
  "Payment tracker",
  "SMS notification \u2014 optional (A$4.99 a month for 50 texts, not included in any package, including Premium)",
];

export const TRACKER_PRODUCTS = Object.freeze({
  // Sold.
  tracker: { env: "STRIPE_PRICE_TRACKER", label: "Payment tracker", aud: 29, devices: 1 },
  tracker_full: { env: "STRIPE_PRICE_TRACKER_FULL", label: "Premium", aud: PREMIUM_AUD, devices: 2, items: PREMIUM_ITEMS },
  tracker_sms: { env: "STRIPE_PRICE_TRACKER_SMS", label: "SMS alerts, 50 texts a month", aud: 4.99, recurring: "month", requires: "tracker" },
  // Retired. Kept so a paid row still unlocks. Checkout refuses them.
  tracker_base: { env: "STRIPE_PRICE_TRACKER_BASE", label: "Payment tracker, one computer", devices: 1, retired: true },
  tracker_two: { env: "STRIPE_PRICE_TRACKER_TWO", label: "Payment tracker, two computers", devices: 2, retired: true },
  tracker_addon: { env: "STRIPE_PRICE_TRACKER_ADDON", label: "Upgrade: add a second computer", devices: 2, requires: "tracker_base", retired: true },
});
export const RETIRED_TRACKER_PRODUCTS = Object.freeze(["tracker_base", "tracker_two", "tracker_addon"]);
export const isTrackerProduct = (p) => Object.prototype.hasOwnProperty.call(TRACKER_PRODUCTS, p);
export const isRetiredTrackerProduct = (p) => RETIRED_TRACKER_PRODUCTS.includes(p);

export function trackerOffer() {
  const premium = premiumPublic();
  const premiumCharge = premiumCheckoutSelection();
  return ["tracker", "tracker_full", "tracker_sms"].map((id) => {
    const p = TRACKER_PRODUCTS[id];
    const row = {
      id,
      label: p.label,
      priceAud: p.aud,
      devices: p.devices || 0,
      recurring: p.recurring || null,
      items: p.items || null,
      available: !!process.env[p.env],
      retired: false,
    };
    if (id === "tracker_full") {
      row.priceAud = premium.priceAud;
      row.available = !premiumCharge.error;
    }
    return row;
  });
}

const q = encodeURIComponent;
// A second device is the separate licence add-on (plan 2), not a tracker SKU.
async function licenceDeviceCap(sub) {
  try {
    const row = (await supa(`licences?google_sub=eq.${q(sub)}&select=plan,status`))?.[0];
    return row?.status === "active" && Number(row.plan) >= 2 ? 2 : 1;
  } catch {
    return 1;
  }
}
// { product, devices: 1|2, addon, full } or null when not unlocked.
// tracker_sms lives in tracker_sms_subscriptions, never here.
export async function trackerUnlock(sub) {
  if (!sub) return null;
  const rows = (await supa(`licence_payments?google_sub=eq.${q(sub)}&product=in.(tracker,tracker_base,tracker_two,tracker_addon,tracker_full)&status=eq.paid&select=product,created_at&order=created_at.asc`)) || [];
  const has = (p) => rows.some((r) => r.product === p);
  if (has("tracker_full")) return { product: "tracker_full", devices: 2, full: true, addon: has("tracker_addon") };
  if (has("tracker_two")) return { product: "tracker_two", devices: 2, full: false, addon: false };
  const cap = async (base) => Math.max(base, await licenceDeviceCap(sub));
  if (has("tracker")) return { product: "tracker", devices: await cap(1), full: false, addon: false };
  if (!has("tracker_base")) return null; // a retired second-computer row alone unlocks nothing
  const addon = has("tracker_addon");
  return { product: "tracker_base", devices: await cap(addon ? 2 : 1), full: false, addon };
}
// Device cap, like the main licence: the first N devices to open the tracker
// hold the seats; a device unseen for 21 days frees its seat.
export async function trackerDeviceOk(sub, deviceId, cap) {
  const now = new Date().toISOString();
  await supa("tracker_devices?on_conflict=google_sub,device_id", { method: "POST", prefer: "resolution=merge-duplicates,return=minimal", body: { google_sub: sub, device_id: deviceId, last_seen: now } });
  const cut = new Date(Date.now() - 21 * 86400000).toISOString();
  const rows = (await supa(`tracker_devices?google_sub=eq.${q(sub)}&last_seen=gte.${q(cut)}&select=device_id,first_seen&order=first_seen.asc`)) || [];
  return rows.slice(0, cap).some((r) => r.device_id === deviceId);
}

/* ---------------- flags ---------------- */
// Server-side auto-send is OFF unless the owner sets TRACKER_AUTOSEND_ENABLED=true.
export const autosendEnabled = () => String(process.env.TRACKER_AUTOSEND_ENABLED || "").toLowerCase() === "true";
// Dry run: the scheduler works everything out and logs it, but sends nothing.
export const autosendDryRun = () => String(process.env.TRACKER_AUTOSEND_DRY_RUN ?? "true").toLowerCase() !== "false";

/* ---------------- encryption at rest ----------------
   Everything that identifies a person (recipient email and name, the
   rendered message text, invoice number) is sealed with AES-256-GCM under
   TRACKER_DATA_KEY (32 random bytes, base64) before it reaches Supabase.
   Only scheduling fields (dates, payer type, stage, paused flags) are in the
   clear. A database leak alone does not expose invoice or participant data. */
function dataKey() {
  const k = Buffer.from(process.env.TRACKER_DATA_KEY || "", "base64");
  if (k.length !== 32) throw new Error("TRACKER_DATA_KEY must be 32 bytes, base64");
  return k;
}
export function seal(obj) {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv("aes-256-gcm", dataKey(), iv);
  const ct = Buffer.concat([c.update(JSON.stringify(obj), "utf8"), c.final()]);
  return `v1.${iv.toString("base64url")}.${Buffer.concat([ct, c.getAuthTag()]).toString("base64url")}`;
}
export function open(sealed) {
  const [v, ivb, body] = String(sealed || "").split(".");
  if (v !== "v1") throw new Error("bad envelope");
  const buf = Buffer.from(body, "base64url");
  const d = crypto.createDecipheriv("aes-256-gcm", dataKey(), Buffer.from(ivb, "base64url"));
  d.setAuthTag(buf.subarray(buf.length - 16));
  return JSON.parse(Buffer.concat([d.update(buf.subarray(0, buf.length - 16)), d.final()]).toString("utf8"));
}
// Keyed hash of an email so suppressions can be matched without storing it.
export function emailHash(email) {
  return crypto.createHmac("sha256", dataKey()).update(String(email || "").trim().toLowerCase()).digest("hex");
}
export const maskEmail = (e) => String(e || "").replace(/^(.).*?(@.*)$/, "$1***$2");

// Signed, unguessable unsubscribe token: which worker, which recipient hash.
export function unsubToken(sub, rhash) {
  const p = Buffer.from(JSON.stringify({ s: sub, r: rhash })).toString("base64url");
  const sig = crypto.createHmac("sha256", process.env.LICENCE_SECRET || "").update("unsub." + p).digest("base64url").slice(0, 32);
  return `${p}.${sig}`;
}
export function readUnsubToken(tok) {
  const [p, sig] = String(tok || "").split(".");
  if (!p || !sig) return null;
  const want = crypto.createHmac("sha256", process.env.LICENCE_SECRET || "").update("unsub." + p).digest("base64url").slice(0, 32);
  if (want.length !== sig.length || !crypto.timingSafeEqual(Buffer.from(want), Buffer.from(sig))) return null;
  try { return JSON.parse(Buffer.from(p, "base64url").toString("utf8")); } catch { return null; }
}

/* ---------------- Adelaide/worker-local date ---------------- */
const TZ = { SA: "Australia/Adelaide", NSW: "Australia/Sydney", VIC: "Australia/Melbourne", QLD: "Australia/Brisbane", WA: "Australia/Perth", TAS: "Australia/Hobart", ACT: "Australia/Sydney", NT: "Australia/Darwin" };
export function localNow(state = "SA") {
  const f = new Intl.DateTimeFormat("en-CA", { timeZone: TZ[state] || TZ.SA, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", hour12: false });
  const parts = Object.fromEntries(f.formatToParts(new Date()).map((x) => [x.type, x.value]));
  return { date: `${parts.year}-${parts.month}-${parts.day}`, hour: Number(parts.hour) % 24 };
}

/* ---------------- email ---------------- */
// From a SupportFlow sending domain, Reply-To the worker. A worker's own
// Gmail/Outlook address can't be used as From: Resend only sends from
// domains SupportFlow has verified (SPF/DKIM), and spoofing the worker's
// domain would fail DMARC. See PAYMENT-TRACKER.md "Sending identity".
export async function resendSend({ to, subject, text, replyTo, fromName, headers = {}, idempotencyKey }) {
  const key = process.env.RESEND_API_KEY;
  if (!key) throw new Error("RESEND_API_KEY missing");
  const fromAddr = process.env.TRACKER_EMAIL_FROM || "invoices@send.supportflow.work";
  const safeName = String(fromName || "SupportFlow").replace(/["<>\r\n]/g, "").slice(0, 60);
  const r = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json", ...(idempotencyKey ? { "Idempotency-Key": idempotencyKey } : {}) },
    body: JSON.stringify({ from: `${safeName} via SupportFlow <${fromAddr}>`, to: [to], subject, text, ...(replyTo ? { reply_to: replyTo } : {}), headers }),
  });
  const body = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`Resend ${r.status}: ${body?.message || ""}`);
  return body?.id || null;
}
