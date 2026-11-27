// Voice notes allowances and audio checks. No audio, transcript, or Stripe calls.
//
// Caps enforced here, then stored by the transcribe function:
//   * 2 minutes for one unsaved note (a random draft id, not a participant id)
//   * 120 minutes per user per calendar month
//
// The A$5/month add-on and the A$5 top-up from the earlier voice-notes branch
// are not for sale. Checkout does not call Stripe and does not grant minutes.
// paymentGrantsVoice records that earlier rule (Premium / a voice_notes row).
// The live function does not consult it: voice notes use the same licence
// check as the other AI functions, plus these time caps.
//
// TODO(stripe): prices were never created. Do not call Stripe from here.
//   STRIPE_PRICE_VOICE_NOTES  A$5 AUD per month, recurring — conflicts with
//                             current one-off pricing (the only monthly charge
//                             on main is optional SMS at A$4.99).
//   STRIPE_PRICE_VOICE_TOPUP  A$5 AUD one-off, +120 minutes until period end.

export const MONTHLY_SECONDS = 120 * 60;
export const TOPUP_SECONDS = 120 * 60;
export const MAX_CLIP_SECONDS = 120;
export const MAX_AUDIO_BYTES = Math.floor(2.5 * 1024 * 1024);
export const NOTE_SECONDS = 120;
export const LOW_SECONDS = 10 * 60;
export const DRAFT_RE = /^vn-[a-z0-9-]{8,44}$/i;

export const VOICE_PRODUCTS = Object.freeze({
  voice_notes: { env: "STRIPE_PRICE_VOICE_NOTES", aud: 5, interval: "month", enabled: false },
  voice_topup: { env: "STRIPE_PRICE_VOICE_TOPUP", aud: 5, interval: "once", seconds: TOPUP_SECONDS, enabled: false },
});

// Earlier purchase rule. Not used to allow or refuse a transcription.
export function paymentGrantsVoice(rows) {
  return Array.isArray(rows) && rows.some((row) => row && (row.product === "voice_notes" || row.product === "tracker_full"));
}

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
    drafts: {},
  };
}

// Date.prototype.getTimezoneOffset minutes: positive west of UTC.
// The server computes the local date so a cleared browser cannot pick a new month.
export function localDateFor(now, tzOffsetMinutes) {
  const off = Number(tzOffsetMinutes);
  const clamped = Number.isFinite(off) ? Math.max(-14 * 60, Math.min(14 * 60, off)) : 0;
  return new Date(now.getTime() - clamped * 60000).toISOString().slice(0, 10);
}

function cleanDrafts(raw) {
  const drafts = {};
  if (!raw || typeof raw !== "object") return drafts;
  for (const [id, value] of Object.entries(raw)) {
    if (!DRAFT_RE.test(id)) continue;
    const seconds = Math.max(0, Number(value) || 0);
    if (seconds > 0) drafts[id] = Math.round(seconds * 10) / 10;
  }
  const ids = Object.keys(drafts);
  if (ids.length > 400) {
    ids.sort((a, b) => drafts[b] - drafts[a]).slice(400).forEach((id) => { delete drafts[id]; });
  }
  return drafts;
}

export function normalizeUsage(raw, localDate) {
  const base = raw && raw.v === 1 ? { ...raw } : freshUsage(localDate);
  let next = {
    ...freshUsage(localDate),
    ...base,
    allowanceSecondsUsed: Math.max(0, Number(base.allowanceSecondsUsed) || 0),
    topupSecondsRemaining: Math.max(0, Number(base.topupSecondsRemaining) || 0),
    drafts: cleanDrafts(base.drafts),
  };
  if (!next.periodStart || !next.periodEnd || localDate >= next.periodEnd || localDate < next.periodStart) {
    const period = periodFor(localDate);
    next = {
      ...next,
      periodStart: period.periodStart,
      periodEnd: period.periodEnd,
      allowanceSecondsUsed: 0,
      topupSecondsRemaining: 0,
      drafts: {},
    };
  }
  return next;
}

export function remainingSeconds(usage) {
  const allowanceLeft = Math.max(0, MONTHLY_SECONDS - (Number(usage.allowanceSecondsUsed) || 0));
  return allowanceLeft + Math.max(0, Number(usage.topupSecondsRemaining) || 0);
}

export function noteSecondsUsed(usage, draftId) {
  if (!draftId || !usage || !usage.drafts) return 0;
  return Math.max(0, Number(usage.drafts[draftId]) || 0);
}

// Monthly allowance first, then any top-up already stored. Nothing in this
// build grants a top-up. Seconds past both are recorded on the allowance so
// one clip that starts with time left is still counted.
export function consumeSeconds(usage, seconds, draftId) {
  const next = { ...usage, drafts: { ...(usage.drafts || {}) } };
  let left = Math.max(0, Number(seconds) || 0);
  const allowanceLeft = Math.max(0, MONTHLY_SECONDS - next.allowanceSecondsUsed);
  const fromAllowance = Math.min(allowanceLeft, left);
  next.allowanceSecondsUsed += fromAllowance;
  left -= fromAllowance;
  const fromTopup = Math.min(next.topupSecondsRemaining, left);
  next.topupSecondsRemaining -= fromTopup;
  left -= fromTopup;
  if (left > 0) next.allowanceSecondsUsed += left;
  if (draftId && DRAFT_RE.test(draftId)) {
    const used = (Number(next.drafts[draftId]) || 0) + (Number(seconds) || 0);
    next.drafts[draftId] = Math.round(used * 10) / 10;
  }
  return next;
}

// Ready for a future webhook. Checkout does not call this.
export function grantTopup(usage, localDate) {
  const next = normalizeUsage(usage, localDate);
  next.topupSecondsRemaining += TOPUP_SECONDS;
  return next;
}

// Put back one reserved clip. If the month has already rolled, the
// reservation expired with it and is not credited into the new month.
export function refundSeconds(usage, before, after) {
  if (!usage || !before || !after) return usage;
  if (usage.periodStart !== before.periodStart || usage.periodEnd !== before.periodEnd) return usage;
  const allowanceDelta = Math.max(0, Number(after.allowanceSecondsUsed) - Number(before.allowanceSecondsUsed));
  const topupDelta = Math.max(0, Number(before.topupSecondsRemaining) - Number(after.topupSecondsRemaining));
  const drafts = { ...(usage.drafts || {}) };
  const beforeDrafts = before.drafts || {};
  const afterDrafts = after.drafts || {};
  for (const id of Object.keys(afterDrafts)) {
    const delta = Math.max(0, Number(afterDrafts[id] || 0) - Number(beforeDrafts[id] || 0));
    if (!delta) continue;
    drafts[id] = Math.max(0, (Number(drafts[id]) || 0) - delta);
    if (drafts[id] <= 0) delete drafts[id];
  }
  return {
    ...usage,
    allowanceSecondsUsed: Math.max(0, Number(usage.allowanceSecondsUsed) - allowanceDelta),
    topupSecondsRemaining: Number(usage.topupSecondsRemaining) + topupDelta,
    drafts,
  };
}

// "out" is the monthly cap. "note" is the 2 minutes for this unsaved note.
// A clip that starts with monthly time left may cross the monthly line.
// A clip that would push one note past 2 minutes is refused.
export function canStartClip(usage, draftId, seconds = 0) {
  if (remainingSeconds(usage) <= 0) return "out";
  const clip = Math.max(0, Number(seconds) || 0);
  if (clip > NOTE_SECONDS + 0.05) return "note";
  if (draftId && noteSecondsUsed(usage, draftId) + clip > NOTE_SECONDS + 0.05) return "note";
  return "ok";
}

export function publicUsage(usage, draftId) {
  const remaining = remainingSeconds(usage);
  const used = Number(usage.allowanceSecondsUsed) || 0;
  const noteUsed = draftId ? noteSecondsUsed(usage, draftId) : 0;
  return {
    remainingSeconds: remaining,
    allowanceSeconds: MONTHLY_SECONDS,
    allowanceSecondsUsed: Math.min(used, MONTHLY_SECONDS),
    overshootSeconds: Math.max(0, used - MONTHLY_SECONDS),
    topupSecondsRemaining: Math.max(0, Number(usage.topupSecondsRemaining) || 0),
    renewalDate: usage.periodEnd,
    noteLimitSeconds: NOTE_SECONDS,
    noteSecondsUsed: noteUsed,
    noteSecondsLeft: Math.max(0, NOTE_SECONDS - noteUsed),
    low: remaining > 0 && remaining <= LOW_SECONDS,
    out: remaining <= 0,
  };
}

export function usageKey({ sub, deviceId }) {
  if (typeof sub === "string" && sub.length > 0 && sub.length < 200 && !/[\s/]/.test(sub)) return `lic:${sub}`;
  if (typeof deviceId === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(deviceId)) {
    return `dev:${deviceId}`;
  }
  return null;
}

// Insert transcribed words at the caret, or at the end when there is no caret.
// A selection is replaced. Existing text outside that selection is kept.
export function voiceSplice(value, start, end, text) {
  const raw = value || "";
  const spoken = String(text || "");
  const a = Math.max(0, Math.min(start == null ? raw.length : start, raw.length));
  if (!spoken) return { next: raw, cursor: a };
  const b = Math.max(a, Math.min(end == null ? a : end, raw.length));
  const before = raw.slice(0, a);
  const after = raw.slice(b);
  const pad = before && !/\s$/.test(before) ? " " : "";
  const padAfter = after && !/^\s/.test(after) && spoken && !/\s$/.test(spoken) ? " " : "";
  const next = before + pad + spoken + padAfter + after;
  return { next, cursor: (before + pad + spoken).length };
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

export function checkoutPlaceholder(product) {
  return {
    error: "not-ready",
    message: "Voice notes checkout isn't switched on yet.",
    product: product === "voice_topup" ? "voice_topup" : "voice_notes",
  };
}
