// Voice notes allowances and audio checks. No audio, transcript, or Stripe calls.
//
// Minutes are counted here, then stored by the transcribe function. The monthly
// allowance is used first. A top-up is used only after that, and it expires when
// the period renews. The 30-notes/day cap is separate and is not lifted by a top-up.
//
// Until the A$5 Stripe prices exist, the period is the calendar month in the
// worker's timezone. periodEnd is the renewal date (the first day of the next
// month). A later webhook can set periodEnd from the subscription; this module
// already expires top-up minutes when that date is reached.

export const MONTHLY_SECONDS = 120 * 60;
export const TOPUP_SECONDS = 120 * 60;
export const DAILY_CAP = 30;
export const MAX_CLIP_SECONDS = 120;
export const MAX_AUDIO_BYTES = Math.floor(2.5 * 1024 * 1024);
export const NOTE_SECONDS = 120;
export const LOW_SECONDS = 10 * 60;

// TODO(stripe): these prices are not created. Do not call Stripe from here.
//   STRIPE_PRICE_VOICE_NOTES  A$5 AUD per month, recurring, product id voice_notes
//   STRIPE_PRICE_VOICE_TOPUP  A$5 AUD one-off, product id voice_topup, +120 minutes
//                             until periodEnd. Does not lift the daily cap.
// Premium (tracker_full) includes Voice notes. The A$29 Payment tracker does not.
// voice_notes is the future subscription row; nothing writes it until Stripe exists.
export function paymentGrantsVoice(rows) {
  return Array.isArray(rows) && rows.some((row) => row && (row.product === "voice_notes" || row.product === "tracker_full"));
}

export const VOICE_PRODUCTS = Object.freeze({
  voice_notes: { env: "STRIPE_PRICE_VOICE_NOTES", aud: 5, interval: "month" },
  voice_topup: { env: "STRIPE_PRICE_VOICE_TOPUP", aud: 5, interval: "once", seconds: TOPUP_SECONDS },
});

export function periodFor(localDate) {
  const [y, m] = String(localDate).split("-").map(Number);
  const start = `${y}-${String(m).padStart(2, "0")}-01`;
  const nextMonth = m === 12 ? 1 : m + 1;
  const nextYear = m === 12 ? y + 1 : y;
  return { periodStart: start, periodEnd: `${nextYear}-${String(nextMonth).padStart(2, "0")}-01` };
}

export function freshUsage(localDate) {
  const period = periodFor(localDate);
  return {
    v: 1,
    periodStart: period.periodStart,
    periodEnd: period.periodEnd,
    allowanceSecondsUsed: 0,
    topupSecondsRemaining: 0,
    notesDay: localDate,
    notesToday: 0,
  };
}

// Date.prototype.getTimezoneOffset minutes: positive west of UTC.
// The server computes the local date so a cleared browser cannot pick a new day.
export function localDateFor(now, tzOffsetMinutes) {
  const off = Number(tzOffsetMinutes);
  const clamped = Number.isFinite(off) ? Math.max(-14 * 60, Math.min(14 * 60, off)) : 0;
  return new Date(now.getTime() - clamped * 60000).toISOString().slice(0, 10);
}

export function normalizeUsage(raw, localDate) {
  const base = raw && raw.v === 1 ? { ...raw } : freshUsage(localDate);
  let next = {
    ...freshUsage(localDate),
    ...base,
    allowanceSecondsUsed: Math.max(0, Number(base.allowanceSecondsUsed) || 0),
    topupSecondsRemaining: Math.max(0, Number(base.topupSecondsRemaining) || 0),
    notesToday: Math.max(0, Number(base.notesToday) || 0),
  };
  if (!next.periodStart || !next.periodEnd || localDate >= next.periodEnd || localDate < next.periodStart) {
    const period = periodFor(localDate);
    next = {
      ...next,
      periodStart: period.periodStart,
      periodEnd: period.periodEnd,
      allowanceSecondsUsed: 0,
      topupSecondsRemaining: 0,
    };
  }
  if (!next.notesDay || localDate > next.notesDay) {
    next.notesDay = localDate;
    next.notesToday = 0;
  }
  return next;
}

export function remainingSeconds(usage) {
  const allowanceLeft = Math.max(0, MONTHLY_SECONDS - (Number(usage.allowanceSecondsUsed) || 0));
  return allowanceLeft + Math.max(0, Number(usage.topupSecondsRemaining) || 0);
}

// Monthly allowance first, then top-up. Seconds past both are recorded on the
// allowance so one clip that crosses the limit is still counted.
export function consumeSeconds(usage, seconds) {
  const next = { ...usage };
  let left = Math.max(0, Number(seconds) || 0);
  const allowanceLeft = Math.max(0, MONTHLY_SECONDS - next.allowanceSecondsUsed);
  const fromAllowance = Math.min(allowanceLeft, left);
  next.allowanceSecondsUsed += fromAllowance;
  left -= fromAllowance;
  const fromTopup = Math.min(next.topupSecondsRemaining, left);
  next.topupSecondsRemaining -= fromTopup;
  left -= fromTopup;
  if (left > 0) next.allowanceSecondsUsed += left;
  return next;
}

// Ready for the webhook once the A$5 top-up price exists. Not called by checkout.
export function grantTopup(usage, localDate) {
  const next = normalizeUsage(usage, localDate);
  next.topupSecondsRemaining += TOPUP_SECONDS;
  return next;
}

export function canStartClip(usage) {
  if ((Number(usage.notesToday) || 0) >= DAILY_CAP) return "daily";
  if (remainingSeconds(usage) <= 0) return "out";
  return "ok";
}

export function publicUsage(usage) {
  const remaining = remainingSeconds(usage);
  const used = Number(usage.allowanceSecondsUsed) || 0;
  return {
    remainingSeconds: remaining,
    allowanceSeconds: MONTHLY_SECONDS,
    allowanceSecondsUsed: Math.min(used, MONTHLY_SECONDS),
    overshootSeconds: Math.max(0, used - MONTHLY_SECONDS),
    topupSecondsRemaining: Math.max(0, Number(usage.topupSecondsRemaining) || 0),
    renewalDate: usage.periodEnd,
    notesToday: Number(usage.notesToday) || 0,
    notesDailyCap: DAILY_CAP,
    dailyRemaining: Math.max(0, DAILY_CAP - (Number(usage.notesToday) || 0)),
    low: remaining > 0 && remaining <= LOW_SECONDS,
    out: remaining <= 0,
    dailyLimited: (Number(usage.notesToday) || 0) >= DAILY_CAP,
  };
}

// Open the purchase gate on private previews and local dev. Never on the
// production context of the live site. The request Host is not consulted:
// a caller can set that header, and CONTEXT / URL cannot.
export function voicePreviewOpen(env = process.env) {
  const ctx = String(env.CONTEXT || "").trim().toLowerCase();
  const url = `${env.URL || ""} ${env.DEPLOY_PRIME_URL || ""}`.toLowerCase();
  const testSite = /supportflows\.netlify\.app/.test(url) || /test-mode-open-gates/.test(url);
  if (ctx === "production") return testSite;
  if (ctx === "deploy-preview" || ctx === "dev") return true;
  if (ctx === "branch-deploy") {
    const branch = String(env.BRANCH || "");
    if (branch === "test-mode-open-gates" || branch.startsWith("cursor/voice-notes")) return true;
    return testSite;
  }
  return testSite;
}

export function usageKey({ sub, deviceId, preview }) {
  if (sub) return `lic:${sub}`;
  if (preview && typeof deviceId === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(deviceId)) {
    return `dev:${deviceId}`;
  }
  return null;
}

function readVint(buf, offset) {
  if (offset >= buf.length) return null;
  const first = buf[offset];
  let mask = 0x80;
  let length = 1;
  while (length <= 8 && (first & mask) === 0) { mask >>= 1; length += 1; }
  if (length > 8 || offset + length > buf.length) return null;
  let value = first & (mask - 1);
  for (let i = 1; i < length; i += 1) value = value * 256 + buf[offset + i];
  return { value, length };
}

function webmDuration(buf) {
  for (let i = 0; i < buf.length - 10; i += 1) {
    if (buf[i] !== 0x44 || buf[i + 1] !== 0x89) continue;
    const size = readVint(buf, i + 2);
    if (!size || (size.value !== 4 && size.value !== 8)) continue;
    const start = i + 2 + size.length;
    if (start + size.value > buf.length) continue;
    const view = new DataView(buf.buffer, buf.byteOffset + start, size.value);
    const ms = size.value === 8 ? view.getFloat64(0, false) : view.getFloat32(0, false);
    if (!Number.isFinite(ms) || ms <= 0) continue;
    const seconds = ms / 1000;
    if (seconds >= 0.2 && seconds <= 180) return seconds;
  }
  return null;
}

function mp4Duration(buf) {
  const marker = buf.indexOf("mvhd");
  if (marker < 0 || marker + 20 > buf.length) return null;
  const version = buf[marker + 4];
  if (version === 0 && marker + 24 <= buf.length) {
    const timescale = buf.readUInt32BE(marker + 16);
    const duration = buf.readUInt32BE(marker + 20);
    if (!timescale) return null;
    return duration / timescale;
  }
  if (version === 1 && marker + 36 <= buf.length) {
    const timescale = buf.readUInt32BE(marker + 24);
    const duration = Number(buf.readBigUInt64BE(marker + 28));
    if (!timescale) return null;
    return duration / timescale;
  }
  return null;
}

export function containerDurationSeconds(bytes) {
  const buf = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes);
  if (buf.length >= 12 && buf.subarray(4, 8).toString("ascii") === "ftyp") {
    const parsed = mp4Duration(buf);
    if (parsed != null) return parsed;
  }
  if (buf.length >= 4 && buf[0] === 0x1a && buf[1] === 0x45 && buf[2] === 0xdf && buf[3] === 0xa3) {
    return webmDuration(buf);
  }
  return null;
}

export function audioKind(bytes, declaredType) {
  const buf = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes);
  let kind = null;
  if (buf.length >= 4 && buf[0] === 0x1a && buf[1] === 0x45 && buf[2] === 0xdf && buf[3] === 0xa3) kind = "webm";
  else if (buf.length >= 12 && buf.subarray(4, 8).toString("ascii") === "ftyp") kind = "mp4";
  if (!kind) return null;
  const declared = String(declaredType || "").split(";")[0].trim().toLowerCase();
  const allowed = kind === "webm"
    ? ["", "application/octet-stream", "audio/webm", "video/webm"]
    : ["", "application/octet-stream", "audio/mp4", "video/mp4", "audio/m4a", "audio/x-m4a"];
  if (!allowed.includes(declared)) return null;
  return kind === "webm"
    ? { ext: "webm", type: "audio/webm" }
    : { ext: "mp4", type: "audio/mp4" };
}

// Charge the longer of the container duration, the client duration, and a
// bitrate floor, capped at one note. A short honest clip is not rounded up
// to the floor when the client duration is already higher.
export function billableSeconds({ bytes, clientSeconds, parsedSeconds }) {
  const client = Number(clientSeconds);
  const parsed = Number(parsedSeconds);
  const sizeFloor = bytes > 0 ? bytes / 16000 : 0;
  let reported = 0;
  if (Number.isFinite(parsed) && parsed > 0) reported = parsed;
  if (Number.isFinite(client) && client > 0) reported = Math.max(reported, client);
  const lifted = Math.max(reported, sizeFloor);
  if (!(lifted >= 0.4)) return 0;
  return Math.min(MAX_CLIP_SECONDS, Math.round(lifted * 10) / 10);
}

export function cleanTranscript(text) {
  const trimmed = String(text || "").replace(/\s+/g, " ").trim();
  if (!trimmed || /^[.\u2026]+$/.test(trimmed)) return "";
  return trimmed.slice(0, 8000);
}
