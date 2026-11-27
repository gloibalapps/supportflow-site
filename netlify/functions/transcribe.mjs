// Voice notes: accept one short recording, return text, keep only a usage counter.
// Audio and the transcript are not stored and are not written to the logs.
// The browser sends the audio clip, a duration, a timezone offset, and a
// random draft id. It does not send a name, an identifier, or the note text.
//
// Auth matches netlify/functions/assist.mjs: same-origin, then
// checkRequestLicence. When the licence switch is on, a call without an
// active licensed device is 402. When the switch is off, the call continues
// after the origin check, and usage is still capped per signed-in account
// or, failing that, per device id.
//
// The key is process.env.OPENAI_API_KEY. If it is missing, this returns
// "voice notes not configured" and does not throw.
//
// Checkout is a disabled placeholder. It does not call Stripe and it does
// not grant minutes. The A$5 prices from the earlier branch are not created.

import { checkRequestLicence, isUuid, verifySession } from "../lib/licence.mjs";
import {
  MAX_AUDIO_BYTES,
  NOTE_SECONDS,
  audioKind,
  billableSeconds,
  canStartClip,
  cleanTranscript,
  containerDurationSeconds,
  durationOverNoteCap,
  localDateFor,
  normalizeUsage,
  publicUsage,
  usageKey,
  consumeSeconds,
  refundSeconds,
  DRAFT_RE,
} from "../lib/voice-notes.mjs";
import { defaultVoiceEntitlement, handleVoiceCheckout, voiceCheckoutFlags } from "../lib/voice-billing.mjs";
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

function sessionSub(req) {
  try {
    const token = req.headers.get("x-sf-licence") || "";
    const session = token ? verifySession(token) : null;
    return session?.sub || "";
  } catch {
    return "";
  }
}

function openAiKey(env) {
  // The live function reads process.env.OPENAI_API_KEY. Tests pass env instead.
  if (env && env !== process.env) return env.OPENAI_API_KEY || "";
  return process.env.OPENAI_API_KEY || "";
}

async function callOpenAI(bytes, kind, env) {
  const key = openAiKey(env);
  if (!key) {
    const err = new Error("voice notes not configured");
    err.code = "not-configured";
    throw err;
  }
  const form = new FormData();
  form.append("file", new Blob([bytes], { type: kind.type }), `note.${kind.ext}`);
  form.append("model", "gpt-transcribe");
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

function callerKey(req, lic) {
  const sub = (lic && lic.sub) || sessionSub(req);
  const deviceHeader = req.headers.get("x-sf-device") || "";
  const deviceId = isUuid(deviceHeader) ? deviceHeader : "";
  return { sub, deviceId, key: usageKey({ sub, deviceId }) };
}

function checkoutSession(req, body, deps) {
  if (deps.session) return deps.session;
  try {
    const token = req.headers.get("x-sf-licence") || (typeof body?.session === "string" ? body.session : "") || "";
    const session = token ? verifySession(token) : null;
    if (!session?.sub) return null;
    const deviceHeader = req.headers.get("x-sf-device") || "";
    return { sub: session.sub, email: session.email || "", deviceId: isUuid(deviceHeader) ? deviceHeader : "" };
  } catch {
    return null;
  }
}

async function entitlementFor(sub, deps) {
  if (!sub) return { ok: false, premium: false, subscription: false };
  if (deps.entitled) return await deps.entitled(sub);
  const { supa } = await import("../lib/licence.mjs");
  return defaultVoiceEntitlement(sub, supa);
}

export async function handleTranscribe(req, deps = {}) {
  try {
    return await handleTranscribeInner(req, deps);
  } catch (e) {
    console.error("transcribe failed");
    return json({ error: "failed" }, 500);
  }
}

async function handleTranscribeInner(req, deps) {
  if (req.method !== "POST") return json({ error: "POST only" }, 405);
  if (!originAllowed(req)) return json({ error: "forbidden" }, 403);

  const env = deps.env || process.env;
  const ip = (req.headers.get("x-nf-client-connection-ip") || req.headers.get("x-forwarded-for") || "").split(",")[0].trim();
  if (overLimit(ip)) return json({ error: "rate-limited" }, 429);

  const checkLicence = deps.checkLicence || checkRequestLicence;
  const lic = await checkLicence(req).catch(() => ({ enforced: false, ok: false, error: true }));
  if (lic && lic.enforced && !lic.ok && !lic.error) return json({ error: "licence-required" }, 402);

  const configured = !!openAiKey(env);
  const who = callerKey(req, lic);
  const key = who.sub ? usageKey({ sub: who.sub }) : who.key;
  const ctype = req.headers.get("content-type") || "";

  if (ctype.includes("application/json")) {
    let body = {};
    try { body = await req.json(); } catch { return json({ error: "bad request" }, 400); }
    if (body.action === "checkout") {
      const result = await handleVoiceCheckout(body, {
        env,
        session: checkoutSession(req, body, deps),
        entitled: (sub) => entitlementFor(sub, deps),
        fetchImpl: deps.fetchImpl,
      });
      return json(result.body, result.status);
    }
    if (body.action === "status") {
      const draftId = DRAFT_RE.test(body.draftId || "") ? body.draftId : "";
      const checkout = voiceCheckoutFlags(env);
      let usage = null;
      let ent = { ok: false, premium: false, subscription: false };
      if (who.sub) {
        try { ent = await entitlementFor(who.sub, deps); }
        catch { ent = { ok: false, premium: false, subscription: false, error: true }; }
      }
      if (key && ent.ok) {
        try {
          const store = deps.store || await openUsageStore();
          const localDate = localDateFor(new Date(), body.tzOffsetMinutes);
          usage = publicUsage(await readUsage(store, key, localDate), draftId);
        } catch (e) {
          console.error("transcribe status");
          if (configured) return json({ error: "usage-unavailable", configured: true, entitled: ent.ok, premium: !!ent.premium, checkout }, 503);
        }
      }
      if (!configured) {
        return json({ error: "voice notes not configured", configured: false, entitled: ent.ok, premium: !!ent.premium, checkout, usage }, 503);
      }
      if (!who.sub) return json({ error: "sign-in-required", configured: true, entitled: false, checkout, usage: null }, 401);
      if (!ent.ok) return json({ configured: true, entitled: false, premium: false, checkout, usage: null });
      if (!usage) return json({ error: "usage-unavailable", configured: true, entitled: true, premium: !!ent.premium, checkout }, 503);
      return json({ configured: true, entitled: true, premium: !!ent.premium, checkout, usage });
    }
    return json({ error: "bad request" }, 400);
  }

  if (!configured && !deps.transcribeAudio) return json({ error: "voice notes not configured" }, 503);
  if (lic && lic.enforced && !who.sub) return json({ error: "licence-required" }, 402);
  if (!who.sub) return json({ error: "voice-notes-required" }, 402);
  let ent;
  try { ent = await entitlementFor(who.sub, deps); }
  catch { return json({ error: "entitlement-unavailable" }, 503); }
  if (!ent.ok) return json({ error: "voice-notes-required" }, 402);

  let form;
  try { form = await req.formData(); } catch { return json({ error: "bad-audio" }, 400); }
  const file = form.get("audio");
  if (!file || typeof file.arrayBuffer !== "function") return json({ error: "bad-audio" }, 400);
  const draftId = String(form.get("draftId") || "");
  if (!DRAFT_RE.test(draftId)) return json({ error: "bad-audio" }, 400);
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
  const clientSeconds = Number(form.get("durationMs")) / 1000;
  if (durationOverNoteCap({ clientSeconds, parsedSeconds: parsed })) {
    return json({ error: "note-limit", usage: publicUsage(usage, draftId) }, 400);
  }
  const seconds = billableSeconds({
    bytes: bytes.length,
    clientSeconds,
    parsedSeconds: parsed,
  });
  if (!(seconds >= 0.4) || seconds > NOTE_SECONDS) {
    return json({ error: "bad-audio", usage: publicUsage(usage, draftId) }, 400);
  }

  // Hold the minutes before the transcription call. A second request for the
  // same user then sees the reservation and is refused.
  let reserved;
  try {
    reserved = await updateUsage(store, key, (raw) => {
      const current = normalizeUsage(raw, localDate);
      const gateNow = canStartClip(current, draftId, seconds);
      if (gateNow !== "ok") return { write: false, reason: gateNow, usage: current };
      const value = consumeSeconds(current, seconds, draftId);
      return { write: true, value, before: current };
    });
  } catch (e) {
    console.error("transcribe usage");
    return json({ error: "usage-unavailable" }, 503);
  }
  if (!reserved.write) {
    const code = reserved.reason === "note" ? "note-limit" : "out-of-minutes";
    return json({ error: code, usage: publicUsage(reserved.usage, draftId) }, 402);
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
    if (e && e.code === "not-configured") {
      return json({ error: "voice notes not configured", usage: publicUsage(restored, draftId) }, 503);
    }
    console.error("transcribe failed");
    return json({ error: "upstream", usage: publicUsage(restored, draftId) }, 502);
  }
  const text = cleanTranscript(rawText);
  if (!text) {
    const restored = await refund();
    return json({ error: "empty", text: "", usage: publicUsage(restored, draftId) });
  }
  return json({ text, usage: publicUsage(reserved.value, draftId) });
}

export default (req) => handleTranscribe(req);
