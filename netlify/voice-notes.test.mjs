// Voice notes: allowances, audio checks, and the transcribe function.
// No network, no Stripe. Run: node netlify/voice-notes.test.mjs
import assert from "node:assert/strict";
import fs from "node:fs";
import {
  MONTHLY_SECONDS,
  TOPUP_SECONDS,
  audioKind,
  billableSeconds,
  canStartClip,
  cleanTranscript,
  consumeSeconds,
  containerDurationSeconds,
  freshUsage,
  grantTopup,
  refundSeconds,
  localDateFor,
  normalizeUsage,
  paymentGrantsVoice,
  publicUsage,
  remainingSeconds,
  voicePreviewOpen,
} from "./lib/voice-notes.mjs";
import { memoryUsageStore } from "./lib/voice-store.mjs";
import { handleTranscribe, paymentGrantsVoice as granted } from "./functions/transcribe.mjs";

assert.equal(paymentGrantsVoice, granted);
assert.equal(paymentGrantsVoice([{ product: "tracker" }]), false);
assert.equal(paymentGrantsVoice([{ product: "tracker_full" }]), true);
assert.equal(paymentGrantsVoice([{ product: "voice_notes" }]), true);
assert.equal(paymentGrantsVoice([]), false);

const sydney = localDateFor(new Date("2026-11-20T14:00:00Z"), -660);
assert.equal(sydney, "2026-11-21");
const rolled = normalizeUsage({
  v: 1,
  periodStart: "2026-10-01",
  periodEnd: "2026-11-01",
  allowanceSecondsUsed: 5000,
  topupSecondsRemaining: 4000,
  notesDay: "2026-10-31",
  notesToday: 9,
}, "2026-11-21");
assert.equal(rolled.allowanceSecondsUsed, 0);
assert.equal(rolled.topupSecondsRemaining, 0);
assert.equal(rolled.periodEnd, "2026-12-01");
assert.equal(rolled.notesToday, 0);

const kept = normalizeUsage({
  v: 1,
  periodStart: "2026-11-01",
  periodEnd: "2026-12-01",
  allowanceSecondsUsed: 100,
  topupSecondsRemaining: 50,
  notesDay: "2026-11-21",
  notesToday: 4,
}, "2026-11-21");
assert.equal(kept.notesToday, 4);
assert.equal(kept.topupSecondsRemaining, 50);

const noRewind = normalizeUsage({
  ...kept,
  notesDay: "2026-11-22",
  notesToday: 7,
}, "2026-11-21");
assert.equal(noRewind.notesToday, 7);
assert.equal(noRewind.notesDay, "2026-11-22");

let usage = freshUsage("2026-11-21");
usage.allowanceSecondsUsed = MONTHLY_SECONDS - 5;
usage.topupSecondsRemaining = 100;
usage = consumeSeconds(usage, 10);
assert.equal(usage.allowanceSecondsUsed, MONTHLY_SECONDS);
assert.equal(usage.topupSecondsRemaining, 95);
assert.equal(remainingSeconds(usage), 95);
usage = consumeSeconds(usage, 200);
assert.equal(usage.topupSecondsRemaining, 0);
assert.ok(usage.allowanceSecondsUsed > MONTHLY_SECONDS);
assert.equal(remainingSeconds(usage), 0);

const beforeCharge = { ...freshUsage("2026-11-21"), allowanceSecondsUsed: MONTHLY_SECONDS - 5, topupSecondsRemaining: 100, notesToday: 4 };
const afterCharge = { ...consumeSeconds(beforeCharge, 20), notesToday: 5 };
const later = { ...consumeSeconds(afterCharge, 10), notesToday: 6 };
const restored = refundSeconds(later, beforeCharge, afterCharge);
assert.equal(restored.allowanceSecondsUsed, MONTHLY_SECONDS - 5);
assert.equal(restored.topupSecondsRemaining, 90);
assert.equal(restored.notesToday, 5);
const rolledAway = refundSeconds({ ...afterCharge, periodStart: "2026-12-01", periodEnd: "2027-01-01", notesDay: "2026-12-01", notesToday: 0, allowanceSecondsUsed: 0, topupSecondsRemaining: 0 }, beforeCharge, afterCharge);
assert.equal(rolledAway.notesToday, 0);
assert.equal(rolledAway.topupSecondsRemaining, 0);

const topped = grantTopup({ ...freshUsage("2026-11-21"), notesToday: 30 }, "2026-11-21");
assert.equal(topped.topupSecondsRemaining, TOPUP_SECONDS);
assert.equal(topped.notesToday, 30);
assert.equal(canStartClip(topped), "daily");
assert.equal(canStartClip({ ...freshUsage("2026-11-21"), allowanceSecondsUsed: MONTHLY_SECONDS }), "out");
assert.equal(publicUsage(topped).dailyLimited, true);
assert.equal(publicUsage(freshUsage("2026-11-21")).low, false);

assert.equal(voicePreviewOpen({ CONTEXT: "production", URL: "https://supportflow.work" }), false);
assert.equal(voicePreviewOpen({ CONTEXT: "production", URL: "https://supportflows.netlify.app" }), true);
assert.equal(voicePreviewOpen({ CONTEXT: "deploy-preview", URL: "https://supportflow.work" }), true);
assert.equal(voicePreviewOpen({ CONTEXT: "branch-deploy", BRANCH: "main", URL: "https://supportflow.work" }), false);
assert.equal(voicePreviewOpen({ CONTEXT: "branch-deploy", BRANCH: "test-mode-open-gates", URL: "https://supportflow.work" }), true);
assert.equal(voicePreviewOpen({ CONTEXT: "dev", URL: "https://supportflow.work" }), true);
assert.equal(voicePreviewOpen({}), false);

function webm(ms) {
  const header = Buffer.from([0x1a, 0x45, 0xdf, 0xa3, 0, 0, 0, 0]);
  const data = Buffer.alloc(8);
  data.writeDoubleBE(ms, 0);
  return Buffer.concat([header, Buffer.from([0x44, 0x89, 0x88]), data]);
}
function mp4(seconds) {
  const body = Buffer.alloc(24);
  body.write("mvhd", 0);
  body.writeUInt32BE(1000, 16);
  body.writeUInt32BE(Math.round(seconds * 1000), 20);
  return Buffer.concat([Buffer.alloc(4), Buffer.from("ftyp"), body]);
}

assert.equal(audioKind(webm(1500), "audio/webm;codecs=opus")?.ext, "webm");
assert.equal(audioKind(mp4(2), "audio/mp4")?.ext, "mp4");
assert.equal(audioKind(mp4(2), "video/mp4")?.type, "audio/mp4");
assert.equal(audioKind(Buffer.from("RIFFxxxxWAVE"), "audio/wav"), null);
assert.equal(audioKind(webm(1500), "audio/mpeg"), null);
assert.ok(Math.abs(containerDurationSeconds(webm(1500)) - 1.5) < 0.01);
assert.ok(Math.abs(containerDurationSeconds(mp4(2)) - 2) < 0.01);
assert.equal(billableSeconds({ bytes: 8000, clientSeconds: 2, parsedSeconds: 1.5 }), 2);
assert.equal(billableSeconds({ bytes: 2_000_000, clientSeconds: 1, parsedSeconds: null }), 120);
assert.equal(cleanTranscript("  hello   there "), "hello there");
assert.equal(cleanTranscript(" ... "), "");

const DEVICE = "11111111-1111-4111-8111-111111111111";
const PROD = { CONTEXT: "production", URL: "https://supportflow.work", TRANSCRIBE_API_KEY: "test-key" };
const PREVIEW = { CONTEXT: "deploy-preview", URL: "https://supportflow.work", TRANSCRIBE_API_KEY: "test-key" };

function audioRequest(bytes, { type = "audio/webm", durationMs = 2000, host = "supportflow.work", offset = -660 } = {}) {
  const form = new FormData();
  form.append("audio", new Blob([bytes], { type }), type.includes("mp4") ? "note.mp4" : "note.webm");
  form.append("durationMs", String(durationMs));
  form.append("tzOffsetMinutes", String(offset));
  return new Request(`https://${host}/.netlify/functions/transcribe`, {
    method: "POST",
    headers: { origin: `https://${host}`, "x-sf-device": DEVICE },
    body: form,
  });
}
function jsonRequest(body, host = "supportflow.work") {
  return new Request(`https://${host}/.netlify/functions/transcribe`, {
    method: "POST",
    headers: { origin: `https://${host}`, "content-type": "application/json", "x-sf-device": DEVICE },
    body: JSON.stringify(body),
  });
}

const store = memoryUsageStore();
let transcribed = 0;
const say = async () => { transcribed += 1; return "Went to the shops and had a quiet afternoon."; };
const base = {
  store,
  env: PREVIEW,
  checkLicence: async () => ({ enforced: false, ok: false }),
  transcribeAudio: say,
};

{
  const res = await handleTranscribe(audioRequest(webm(2000)), base);
  const data = await res.json();
  assert.equal(res.status, 200);
  assert.equal(data.text, "Went to the shops and had a quiet afternoon.");
  assert.equal(data.audio, undefined);
  assert.equal(data.usage.notesToday, 1);
  assert.equal(data.usage.allowanceSecondsUsed, 2);
  const saved = await store.get(`dev:${DEVICE}`);
  assert.equal(JSON.stringify(saved.value).includes("shops"), false);
  assert.equal(transcribed, 1);
}

{
  const res = await handleTranscribe(audioRequest(mp4(2), { type: "audio/mp4", durationMs: 2000 }), base);
  const data = await res.json();
  assert.equal(res.status, 200);
  assert.equal(data.usage.allowanceSecondsUsed, 4);
}

{
  const before = await store.get(`dev:${DEVICE}`);
  const res = await handleTranscribe(audioRequest(webm(2000)), { ...base, transcribeAudio: async () => "   " });
  const data = await res.json();
  assert.equal(data.error, "empty");
  assert.equal(data.text, "");
  const after = await store.get(`dev:${DEVICE}`);
  assert.equal(after.value.allowanceSecondsUsed, before.value.allowanceSecondsUsed);
  assert.equal(after.value.notesToday, before.value.notesToday);
}

{
  const before = await store.get(`dev:${DEVICE}`);
  const res = await handleTranscribe(audioRequest(webm(2000)), {
    ...base,
    transcribeAudio: async () => { const err = new Error("upstream"); err.code = "upstream"; throw err; },
  });
  assert.equal(res.status, 502);
  const after = await store.get(`dev:${DEVICE}`);
  assert.equal(after.value.notesToday, before.value.notesToday);
}

{
  const res = await handleTranscribe(audioRequest(Buffer.from("RIFFxxxxWAVE"), { type: "audio/wav" }), base);
  assert.equal(res.status, 400);
  assert.equal((await res.json()).error, "bad-audio");
}

{
  const huge = Buffer.concat([webm(2000), Buffer.alloc(Math.floor(2.5 * 1024 * 1024))]);
  const res = await handleTranscribe(audioRequest(huge), base);
  assert.equal(res.status, 413);
}

{
  const today = localDateFor(new Date(), -660);
  const period = today.slice(0, 8) + "01";
  const [y, m] = today.split("-").map(Number);
  const endMonth = m === 12 ? 1 : m + 1;
  const endYear = m === 12 ? y + 1 : y;
  const periodEnd = `${endYear}-${String(endMonth).padStart(2, "0")}-01`;
  await store.set(`dev:${DEVICE}`, {
    v: 1, periodStart: period, periodEnd, allowanceSecondsUsed: MONTHLY_SECONDS,
    topupSecondsRemaining: 0, notesDay: today, notesToday: 2,
  }, (await store.get(`dev:${DEVICE}`)).etag);
  const calls = transcribed;
  const res = await handleTranscribe(audioRequest(webm(2000)), base);
  const data = await res.json();
  assert.equal(res.status, 402);
  assert.equal(data.error, "out-of-minutes");
  assert.equal(transcribed, calls);
}

{
  const today = localDateFor(new Date(), -660);
  const cur = await store.get(`dev:${DEVICE}`);
  await store.set(`dev:${DEVICE}`, { ...cur.value, allowanceSecondsUsed: 0, topupSecondsRemaining: TOPUP_SECONDS, notesToday: 30, notesDay: "2099-01-01" }, cur.etag);
  const res = await handleTranscribe(audioRequest(webm(2000)), base);
  const data = await res.json();
  assert.equal(data.error, "daily-cap");
  assert.equal(data.usage.topupSecondsRemaining, TOPUP_SECONDS);
  assert.ok(today < "2099-01-01");
}

{
  const res = await handleTranscribe(jsonRequest({ action: "checkout", product: "voice_topup" }), {
    ...base,
    env: PROD,
    checkLicence: async () => ({ enforced: true, ok: false }),
  });
  const oldFetch = globalThis.fetch;
  let called = 0;
  globalThis.fetch = () => { called += 1; throw new Error("no network"); };
  const again = await handleTranscribe(jsonRequest({ action: "checkout", product: "voice_notes" }), base);
  globalThis.fetch = oldFetch;
  assert.equal(res.status, 501);
  assert.equal(again.status, 501);
  assert.match((await again.json()).message, /isn't switched on yet/);
  assert.equal(called, 0);
}

{
  const res = await handleTranscribe(audioRequest(webm(2000), { host: "supportflows.netlify.app" }), {
    store: memoryUsageStore(),
    env: PROD,
    checkLicence: async () => ({ enforced: true, ok: true, sub: "user-1" }),
    entitled: async () => false,
    transcribeAudio: say,
  });
  assert.equal(res.status, 402);
  assert.equal((await res.json()).error, "voice-notes-required");
}

{
  const paid = memoryUsageStore();
  const res = await handleTranscribe(audioRequest(webm(3000), { durationMs: 3000 }), {
    store: paid,
    env: PROD,
    checkLicence: async () => ({ enforced: true, ok: true, sub: "prem-1" }),
    entitled: async () => true,
    transcribeAudio: async () => "Noted.",
  });
  const data = await res.json();
  assert.equal(res.status, 200);
  assert.equal(data.text, "Noted.");
  assert.equal((await paid.get("lic:prem-1")).value.allowanceSecondsUsed, 3);
}

{
  const res = await handleTranscribe(audioRequest(webm(2000)), {
    store: memoryUsageStore(),
    env: { CONTEXT: "deploy-preview", URL: "https://supportflow.work" },
    checkLicence: async () => ({ enforced: false, ok: false }),
  });
  assert.equal(res.status, 503);
  assert.equal((await res.json()).error, "not-configured");
}

{
  const evil = new Request("https://supportflow.work/.netlify/functions/transcribe", {
    method: "POST",
    headers: { origin: "https://evil.example", host: "supportflow.work", "content-type": "application/json" },
    body: JSON.stringify({ action: "status" }),
  });
  const res = await handleTranscribe(evil, base);
  assert.equal(res.status, 403);
}

{
  const race = memoryUsageStore();
  const today = localDateFor(new Date(), -660);
  const [y, m] = today.split("-").map(Number);
  const periodEnd = `${m === 12 ? y + 1 : y}-${String(m === 12 ? 1 : m + 1).padStart(2, "0")}-01`;
  await race.set(`dev:${DEVICE}`, {
    v: 1, periodStart: today.slice(0, 8) + "01", periodEnd,
    allowanceSecondsUsed: MONTHLY_SECONDS - 3, topupSecondsRemaining: 0,
    notesDay: today, notesToday: 1,
  }, null);
  let calls = 0;
  const depsFor = (say) => ({
    store: race, env: PREVIEW,
    checkLicence: async () => ({ enforced: false, ok: false }),
    transcribeAudio: say,
  });
  const first = await handleTranscribe(audioRequest(webm(10000), { durationMs: 10000 }), depsFor(async () => {
    calls += 1;
    const second = await handleTranscribe(audioRequest(webm(10000), { durationMs: 10000 }), depsFor(async () => {
      calls += 1;
      return "second";
    }));
    const secondBody = await second.json();
    assert.equal(second.status, 402);
    assert.equal(secondBody.error, "out-of-minutes");
    return "first";
  }));
  const firstBody = await first.json();
  assert.equal(first.status, 200);
  assert.equal(firstBody.text, "first");
  assert.equal(calls, 1);
  const saved = await race.get(`dev:${DEVICE}`);
  assert.equal(saved.value.notesToday, 2);
  assert.ok(saved.value.allowanceSecondsUsed >= MONTHLY_SECONDS);
}

{
  const race = memoryUsageStore();
  const today = localDateFor(new Date(), -660);
  const [y, m] = today.split("-").map(Number);
  const periodEnd = `${m === 12 ? y + 1 : y}-${String(m === 12 ? 1 : m + 1).padStart(2, "0")}-01`;
  await race.set(`dev:${DEVICE}`, {
    v: 1, periodStart: today.slice(0, 8) + "01", periodEnd,
    allowanceSecondsUsed: 0, topupSecondsRemaining: 0,
    notesDay: today, notesToday: 29,
  }, null);
  let calls = 0;
  const depsFor = (say) => ({
    store: race, env: PREVIEW,
    checkLicence: async () => ({ enforced: false, ok: false }),
    transcribeAudio: say,
  });
  const first = await handleTranscribe(audioRequest(webm(2000)), depsFor(async () => {
    calls += 1;
    const second = await handleTranscribe(audioRequest(webm(2000)), depsFor(async () => { calls += 1; return "second"; }));
    assert.equal(second.status, 402);
    assert.equal((await second.json()).error, "daily-cap");
    return "first";
  }));
  assert.equal((await first.json()).text, "first");
  assert.equal(calls, 1);
  assert.equal((await race.get(`dev:${DEVICE}`)).value.notesToday, 30);
}

const src = fs.readFileSync(new URL("./functions/transcribe.mjs", import.meta.url), "utf8");
assert.doesNotMatch(src, /api\.stripe\.com|from ["']stripe|sendEmail|resend\.com/i);
assert.match(src, /gpt-transcribe/);
assert.match(src, /form\.append\("languages\[\]", "en"\)/);
assert.doesNotMatch(src, /form\.append\([^)]*en-AU/);
assert.doesNotMatch(src, /console\.(log|error|warn|info)\([^)]*\b(text|bytes|rawText)\b/);

console.log("voice notes tests pass");
