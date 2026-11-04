// Inbound SMS webhook for the Payment tracker SMS add-on (Twilio Messaging
// "A message comes in" -> POST https://supportflow.work/.netlify/functions/tracker-sms-inbound).
// Handles STOP / START keywords from the worker's own phone (Spam Act 2003
// functional unsubscribe). Requests must carry a valid X-Twilio-Signature.
// Telnyx: not wired yet (needs Ed25519 signature check); see PAYMENT-TRACKER.md.
import { supa } from "../lib/licence.mjs";
import { emailHash } from "../lib/tracker.mjs";
import { normaliseAuMobile, twilioSignatureOk, STOP_WORDS, START_WORDS } from "../lib/sms.mjs";

const twiml = (msg) => new Response(`<?xml version="1.0" encoding="UTF-8"?><Response>${msg ? `<Message>${msg}</Message>` : ""}</Response>`, { headers: { "Content-Type": "text/xml" } });

export default async (req) => {
  if (req.method !== "POST") return new Response("Method not allowed", { status: 405 });
  const form = Object.fromEntries(new URLSearchParams(await req.text()));
  const url = `${process.env.SITE_URL || new URL(req.url).origin}/.netlify/functions/tracker-sms-inbound`;
  if (!twilioSignatureOk(url, form, req.headers.get("x-twilio-signature"))) return new Response("forbidden", { status: 403 });
  const phone = normaliseAuMobile(form.From);
  if (!phone) return twiml("");
  const body = String(form.Body || "");
  const now = new Date().toISOString();
  const filt = `tracker_sms_profiles?phone_hash=eq.${encodeURIComponent(emailHash(phone))}`;
  if (STOP_WORDS.test(body)) {
    await supa(filt, { method: "PATCH", prefer: "return=minimal", body: { opted_in: false, stopped_at: now, updated_at: now } });
    return twiml("SupportFlow: SMS alerts stopped. You'll get app notifications instead. Reply START to turn texts back on.");
  }
  if (START_WORDS.test(body)) {
    await supa(`${filt}&verified_at=not.is.null`, { method: "PATCH", prefer: "return=minimal", body: { opted_in: true, stopped_at: null, updated_at: now } });
    return twiml("SupportFlow: SMS alerts are back on. Reply STOP to opt out.");
  }
  return twiml("SupportFlow alerts can't read replies. Open the app, or reply STOP to opt out.");
};
