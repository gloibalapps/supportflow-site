// Voice notes: accept one short recording, return text, keep only a usage counter.
// Audio and the transcript are not stored and are not written to the logs.
//
// TODO(stripe): checkout below is a placeholder. The A$5/month price
// (STRIPE_PRICE_VOICE_NOTES) and the A$5 top-up price (STRIPE_PRICE_VOICE_TOPUP)
// do not exist yet. This file must not call Stripe.

import { checkRequestLicence, isUuid, supa, verifySession } from "../lib/licence.mjs";
import {
  MAX_AUDIO_BYTES,
  audioKind,
  billableSeconds,
  canStartClip,
  cleanTranscript,
  containerDurationSeconds,
  localDateFor,
  normalizeUsage,
  publicUsage,
  usageKey,
  voicePreviewOpen,
  consumeSeconds,
  paymentGrantsVoice,
  refundSeconds,
} from "../lib/voice-notes.mjs";
export { paymentGrantsVoice };
import { openUsageStore, updateUsage } from "../lib/voice-store.mjs";

export const config = { timeout: 26 };

const WINDOW_MS = 60 * 60 * 1000;
const PER_IP_PER_HOUR = 30;
const hits = new Map();

function overLimit(ip) {
  if (!ip) return false;
  const now = Date.now();
  const list = (hits.get(ip) || []).filter((t) => now - t < WINDOW_MS);
  if (list.length >= PER_IP_PER_HOUR) { hits.set(ip, list); return true; }
  list.push(now);
  hits.set(ip, list);
  if (hits.size > 5000) hits.clear();
  return false;
}

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });
}

function originAllowed(req) {
  const origin = req.headers.get("origin");
  const host = req.headers.get("host") || "";
  if (origin && host && !origin.includes(host)) return false;
  return true;
}

async function hasVoiceEntitlement(sub) {
  const rows = await supa(
    `licence_payments?google_sub=eq.${encodeURIComponent(sub)}&product=in.(voice_notes,tracker_full)&status=eq.paid&select=product&limit=1`,
  );
  return paymentGrantsVoice(rows);
}

function sessionSub(req) {
  try {
    const token = req.headers.get("x-sf-licence") || "";
    const session = token ? verifySession(token) : null;
    return session?.sub || "";
  } catch {
    return "";
  }
}

async function callOpenAI(bytes, kind, env) {
  const key = env.TRANSCRIBE_API_KEY || env.OPENAI_API_KEY;
  if (!key) {
    const err = new Error("not-configured");
    err.code = "not-configured";
    throw err;
  }
  const model = env.TRANSCRIBE_MODEL || "gpt-transcribe";
  const form = new FormData();
  form.append("file", new Blob([bytes], { type: kind.type }), `note.${kind.ext}`);
  form.append("model", model);
  form.append("response_format", "json");
  // gpt-transcribe takes `languages` (ISO 639-1). en-AU is rejected.
  // The prompt asks for Australian English without sending the note or any name.
  form.append("languages[]", "en");
  form.append("prompt", "Australian English. A support worker describing a shift in their own words.");
  const res = await fetch("https://api.openai.com/v1/audio/transcriptions", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}` },
    body: form,
    signal: AbortSignal.timeout(22000),
  });
  if (!res.ok) {
    console.error("transcribe upstream", res.status);
    const err = new Error("upstream");
    err.code = "upstream";
    throw err;
  }
  const data = await res.json().catch(() => ({}));
  return typeof data?.text === "string" ? data.text : "";
}

async function readUsage(store, key, localDate) {
  const cur = await store.get(key);
  return normalizeUsage(cur ? cur.value : null, localDate);
}

export async function handleTranscribe(req, deps = {}) {
  if (req.method !== "POST") return json({ error: "POST only" }, 405);
  if (!originAllowed(req)) return json({ error: "forbidden" }, 403);

  const env = deps.env || process.env;
  const ip = (req.headers.get("x-nf-client-connection-ip") || req.headers.get("x-forwarded-for") || "").split(",")[0].trim();
  if (overLimit(ip)) return json({ error: "rate-limited" }, 429);

  const preview = voicePreviewOpen(env);
  const checkLicence = deps.checkLicence || checkRequestLicence;
  const lic = await checkLicence(req).catch(() => ({ enforced: false, ok: false, error: true }));
  const sub = (lic && lic.sub) || sessionSub(req);
  const deviceId = isUuid(req.headers.get("x-sf-device") || "") ? req.headers.get("x-sf-device") : "";
  const configured = !!(env.TRANSCRIBE_API_KEY || env.OPENAI_API_KEY);
  const key = usageKey({ sub, deviceId, preview });

  let entitled = false;
  if (preview) entitled = true;
  else if (lic && lic.ok && lic.sub) {
    try {
      const lookup = deps.entitled || hasVoiceEntitlement;
      entitled = await lookup(lic.sub);
    } catch (e) {
      console.error("transcribe entitlement");
      return json({ error: "entitlement-unavailable" }, 503);
    }
  }

  const ctype = req.headers.get("content-type") || "";
  if (ctype.includes("application/json")) {
    let body = {};
    try { body = await req.json(); } catch { return json({ error: "bad request" }, 400); }
    if (body.action === "checkout") {
      // Placeholder only. Creating a Checkout Session would spend against
      // prices that have not been created, so this returns before any network call.
      return json({
        error: "not-ready",
        message: "Voice notes checkout isn't switched on yet.",
        product: body.product === "voice_topup" ? "voice_topup" : "voice_notes",
      }, 501);
    }
    if (body.action === "status") {
      if (!entitled) return json({ configured, entitled: false, preview, usage: null });
      if (!key) return json({ configured, entitled: true, preview, usage: null });
      try {
        const store = deps.store || await openUsageStore();
        const localDate = localDateFor(new Date(), body.tzOffsetMinutes);
        const usage = await readUsage(store, key, localDate);
        return json({ configured, entitled: true, preview, usage: publicUsage(usage) });
      } catch (e) {
        console.error("transcribe status");
        return json({ error: "usage-unavailable", configured, entitled: true, preview }, 503);
      }
    }
    return json({ error: "bad request" }, 400);
  }

  if (!entitled) {
    if (lic && lic.enforced && !lic.ok && !lic.error) return json({ error: "licence-required" }, 402);
    return json({ error: "voice-notes-required" }, 402);
  }
  if (!configured && !deps.transcribeAudio) return json({ error: "not-configured" }, 503);

  if (!key) return json({ error: "licence-required" }, 402);

  let form;
  try { form = await req.formData(); } catch { return json({ error: "bad-audio" }, 400); }
  const file = form.get("audio");
  if (!file || typeof file.arrayBuffer !== "function") return json({ error: "bad-audio" }, 400);
  const bytes = Buffer.from(await file.arrayBuffer());
  if (bytes.length > MAX_AUDIO_BYTES) return json({ error: "too-large" }, 413);
  const kind = audioKind(bytes, file.type || "");
  if (!kind) return json({ error: "bad-audio" }, 400);

  const store = deps.store || await openUsageStore();
  const localDate = localDateFor(new Date(), form.get("tzOffsetMinutes"));
  let usage;
  try { usage = await readUsage(store, key, localDate); }
  catch (e) {
    console.error("transcribe usage");
    return json({ error: "usage-unavailable" }, 503);
  }
  const parsed = containerDurationSeconds(bytes);
  const seconds = billableSeconds({
    bytes: bytes.length,
    clientSeconds: Number(form.get("durationMs")) / 1000,
    parsedSeconds: parsed,
  });
  if (!(seconds >= 0.4) || seconds > 120) return json({ error: "bad-audio", usage: publicUsage(usage) }, 400);

  // Hold the minutes and the daily note before the transcription call. A second
  // request for the same licence then sees the reservation and is refused,
  // instead of both passing the earlier read and both being saved.
  let reserved;
  try {
    reserved = await updateUsage(store, key, (raw) => {
      const current = normalizeUsage(raw, localDate);
      const gateNow = canStartClip(current);
      if (gateNow !== "ok") return { write: false, reason: gateNow, usage: current };
      const value = consumeSeconds(current, seconds);
      value.notesToday += 1;
      value.notesDay = localDate;
      return { write: true, value, before: current };
    });
  } catch (e) {
    console.error("transcribe usage");
    return json({ error: "usage-unavailable" }, 503);
  }
  if (!reserved.write) {
    return json({
      error: reserved.reason === "daily" ? "daily-cap" : "out-of-minutes",
      usage: publicUsage(reserved.usage),
    }, 402);
  }

  const refund = async () => {
    try {
      const undone = await updateUsage(store, key, (raw) => ({
        write: true,
        value: refundSeconds(normalizeUsage(raw, localDate), reserved.before, reserved.value),
      }));
      return undone.value;
    } catch (e) {
      console.error("transcribe refund");
      return reserved.before;
    }
  };

  let rawText = "";
  try {
    const transcribeAudio = deps.transcribeAudio || ((audio, meta) => callOpenAI(audio, meta, env));
    rawText = await transcribeAudio(bytes, kind);
  } catch (e) {
    const restored = await refund();
    if (e && e.code === "not-configured") return json({ error: "not-configured", usage: publicUsage(restored) }, 503);
    console.error("transcribe failed");
    return json({ error: "upstream", usage: publicUsage(restored) }, 502);
  }
  const text = cleanTranscript(rawText);
  if (!text) {
    const restored = await refund();
    return json({ error: "empty", text: "", usage: publicUsage(restored) });
  }
  return json({ text, usage: publicUsage(reserved.value) });
}

export default (req) => handleTranscribe(req);
