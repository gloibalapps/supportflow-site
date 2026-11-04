// Payment tracker SMS alerts: provider adapter + credits. See PAYMENT-TRACKER.md "SMS add-on".
//
// SMS only ever go to the WORKER's own mobile, after opt-in and a code check.
// Never to the NDIA, a plan manager or any payer: sendWorkerSms() takes no
// recipient argument, it reads the worker's verified number itself.
//
//   TRACKER_SMS_ENABLED=true     needed for any real send (default off)
//   TRACKER_SMS_DRY_RUN          default "true": log, decrement nothing real, send nothing
//   TRACKER_SMS_PROVIDER         "twilio" (default) | "telnyx" | "mock" (tests)
//   TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_FROM (registered sender ID or number)
//   TELNYX_API_KEY, TELNYX_FROM
//   TRACKER_SMS_CREDITS          credits per billing period (default 50)
//   TRACKER_SMS_ONE_WAY=true     sender is an alphanumeric ID (no replies): footer points to in-app opt-out
import crypto from "node:crypto";
import { supa } from "./licence.mjs";
import { open } from "./tracker.mjs";

export const smsEnabled = () => String(process.env.TRACKER_SMS_ENABLED || "").toLowerCase() === "true";
export const smsDryRun = () => String(process.env.TRACKER_SMS_DRY_RUN ?? "true").toLowerCase() !== "false";
export const SMS_CREDITS_PER_PERIOD = () => Number(process.env.TRACKER_SMS_CREDITS) || 50;
const q = encodeURIComponent;

// Australian mobiles only: 04xx xxx xxx / +614xx xxx xxx -> E.164.
export function normaliseAuMobile(s) {
  const d = String(s || "").replace(/[\s()-]/g, "");
  const m = d.match(/^(?:\+?61|0)(4\d{8})$/);
  return m ? `+61${m[1]}` : null;
}
export const maskPhone = (p) => String(p || "").replace(/^(\+614\d)\d{4}(\d{3})$/, "$1****$2");

// Segments: GSM-7 = 160 single / 153 per part; anything else UCS-2 = 70 / 67.
const GSM = /^[@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ !"#¤%&'()*+,\-./0-9:;<=>?¡A-ZÄÖÑÜ§¿a-zäöñüà^{}\\\[~\]|€]*$/;
export function smsSegments(text) {
  const t = String(text || "");
  if (GSM.test(t)) {
    const len = [...t].reduce((n, c) => n + ("^{}\\[~]|€".includes(c) ? 2 : 1), 0);
    return len <= 160 ? 1 : Math.ceil(len / 153);
  }
  const len = [...t].length;
  return len <= 70 ? 1 : Math.ceil(len / 67);
}

/* ---------------- provider adapters ----------------
   interface SmsProvider { name; send({ to, from, body }) -> Promise<{ id }> } */
const providers = {
  twilio: {
    name: "twilio",
    async send({ to, from, body }) {
      const sid = process.env.TWILIO_ACCOUNT_SID, tok = process.env.TWILIO_AUTH_TOKEN;
      if (!sid || !tok) throw new Error("Twilio not configured");
      const r = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
        method: "POST",
        headers: { Authorization: "Basic " + Buffer.from(`${sid}:${tok}`).toString("base64"), "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ To: to, From: from, Body: body }).toString(),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(`Twilio ${r.status}: ${d.message || ""}`);
      return { id: d.sid };
    },
  },
  telnyx: {
    name: "telnyx",
    async send({ to, from, body }) {
      const key = process.env.TELNYX_API_KEY;
      if (!key) throw new Error("Telnyx not configured");
      const r = await fetch("https://api.telnyx.com/v2/messages", {
        method: "POST", headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
        body: JSON.stringify({ to, from, text: body }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(`Telnyx ${r.status}: ${d.errors?.[0]?.detail || ""}`);
      return { id: d.data?.id };
    },
  },
};
let testProvider = null;
export const __setTestProvider = (p) => { testProvider = p; }; // tests only
export function smsProvider() {
  if (testProvider) return testProvider;
  const name = (process.env.TRACKER_SMS_PROVIDER || "twilio").toLowerCase();
  const p = providers[name];
  if (!p) throw new Error(`Unknown SMS provider ${name}`);
  return { ...p, from: name === "telnyx" ? process.env.TELNYX_FROM : process.env.TWILIO_FROM };
}

/* ---------------- low-level send (verification codes + alerts) ---------------- */
export async function rawSend(to, body) {
  if (!smsEnabled() || smsDryRun()) return { id: null, dry: true };
  const p = smsProvider();
  return p.send({ to, from: p.from || "SupportFlw", body });
}

/* ---------------- worker alert ----------------
   Returns { status: "sent"|"dry_run"|"no_credits"|"not_set_up"|"off"|"failed", segments, balance } */
export async function sendWorkerSms(sub, body) {
  if (!smsEnabled()) return { status: "off" };
  const prof = (await supa(`tracker_sms_profiles?google_sub=eq.${q(sub)}&select=*`))?.[0];
  if (!prof || !prof.verified_at || !prof.opted_in || prof.stopped_at) return { status: "not_set_up" };
  const subn = (await supa(`tracker_sms_subscriptions?google_sub=eq.${q(sub)}&status=in.(active,trialing)&select=stripe_subscription_id`))?.[0];
  if (!subn) return { status: "not_set_up" };
  // Replies (STOP) only work from a number sender; an alphanumeric sender ID is one-way.
  const text = `${body} ${process.env.TRACKER_SMS_ONE_WAY === "true" ? "Opt out in SupportFlow settings." : "Reply STOP to opt out."}`;
  const segments = smsSegments(text);
  const ref = crypto.randomUUID();
  if (smsDryRun()) {
    // Dry run spends nothing: just check the balance would cover it.
    const bal = Number((await supa(`tracker_sms_balances?google_sub=eq.${q(sub)}&select=balance`))?.[0]?.balance || 0);
    return bal >= segments ? { status: "dry_run", segments, balance: bal } : { status: "no_credits", segments };
  }
  // Atomic: only decrements if the balance covers every segment.
  const left = await supa("rpc/tracker_sms_consume", { method: "POST", body: { p_sub: sub, p_segments: segments, p_ref: ref } });
  if (left === null || left === undefined || Number(left) < 0) return { status: "no_credits", segments };
  const phone = open(prof.phone_enc).phone;
  try {
    const p = smsProvider();
    const r = await p.send({ to: phone, from: p.from || "SupportFlw", body: text });
    return { status: "sent", segments, balance: Number(left), to: maskPhone(phone), id: r.id };
  } catch (e) {
    // Give the credits back: nothing was delivered.
    await supa("rpc/tracker_sms_refund_usage", { method: "POST", body: { p_sub: sub, p_segments: segments, p_ref: ref } }).catch(() => {});
    return { status: "failed", segments, detail: String(e.message).slice(0, 200) };
  }
}

// Inbound STOP / START keywords (Spam Act functional unsubscribe).
export const STOP_WORDS = /^\s*(stop|stopall|unsubscribe|cancel|end|quit)\b/i;
export const START_WORDS = /^\s*(start|unstop)\b/i;

// Twilio request signature (X-Twilio-Signature): base64 HMAC-SHA1 of URL + sorted params.
export function twilioSignatureOk(url, params, sig) {
  const tok = process.env.TWILIO_AUTH_TOKEN || "";
  if (!tok || !sig) return false;
  const data = url + Object.keys(params).sort().map((k) => k + params[k]).join("");
  const want = crypto.createHmac("sha1", tok).update(data).digest("base64");
  return want.length === sig.length && crypto.timingSafeEqual(Buffer.from(want), Buffer.from(sig));
}
