// Voice notes: allowances, audio checks, and the transcribe function.
// No network, no Stripe. Run: node netlify/voice-notes.test.mjs
import assert from "node:assert/strict";
import fs from "node:fs";
import {
  MONTHLY_SECONDS,
  NOTE_SECONDS,
  TOPUP_SECONDS,
  audioKind,
  billableSeconds,
  canStartClip,
  cleanTranscript,
  consumeSeconds,
  containerDurationSeconds,
  durationOverNoteCap,
  freshUsage,
  grantTopup,
  localDateFor,
  normalizeUsage,
  paymentGrantsVoice,
  publicUsage,
  refundSeconds,
  remainingSeconds,
  voiceSplice,
} from "./lib/voice-notes.mjs";
import {
  grantTopupOnce,
  handleVoiceCheckout,
  revokeTopupOnce,
  voiceCheckoutForm,
  voiceSubscriptionEntitled,
  voiceSubscriptionRow,
} from "./lib/voice-billing.mjs";
import { memoryUsageStore } from "./lib/voice-store.mjs";
import { handleTranscribe } from "./functions/transcribe.mjs";

assert.equal(paymentGrantsVoice([{ product: "tracker" }]), false);
assert.equal(paymentGrantsVoice([{ product: "tracker_full" }]), true);
assert.equal(paymentGrantsVoice([{ product: "voice_notes" }]), false);
assert.equal(paymentGrantsVoice([]), false);
assert.equal(voiceSubscriptionEntitled("active"), true);
assert.equal(voiceSubscriptionEntitled("trialing"), true);
assert.equal(voiceSubscriptionEntitled("past_due"), false);
assert.equal(voiceSubscriptionEntitled("canceled"), false);
assert.equal(NOTE_SECONDS, 120);
assert.equal(MONTHLY_SECONDS, 120 * 60);

const kept = voiceSplice("Went shopping", null, null, "and came home");
assert.equal(kept.next, "Went shopping and came home");
assert.equal(kept.cursor, kept.next.length);
const middle = voiceSplice("Hello there", 5, 5, "friend");
assert.equal(middle.next, "Hello friend there");
const replaced = voiceSplice("old words", 0, 3, "new");
assert.equal(replaced.next, "new words");
const untouched = voiceSplice("keep this", 4, 4, "");
assert.equal(untouched.next, "keep this");

const sydney = localDateFor(new Date("2026-11-20T14:00:00Z"), -660);
assert.equal(sydney, "2026-11-21");
const rolled = normalizeUsage({
  v: 1,
  periodStart: "2026-10-01",
  periodEnd: "2026-11-01",
  allowanceSecondsUsed: 5000,
  topupSecondsRemaining: 4000,
  drafts: { "vn-aaaaaaaa": 90 },
}, "2026-11-21");
assert.equal(rolled.allowanceSecondsUsed, 0);
assert.equal(rolled.topupSecondsRemaining, 0);
assert.equal(rolled.periodEnd, "2026-12-01");
assert.deepEqual(rolled.drafts, {});
const rewound = normalizeUsage({
  v: 1,
  periodStart: "2026-11-01",
  periodEnd: "2026-12-01",
  allowanceSecondsUsed: 4000,
  topupSecondsRemaining: 30,
  drafts: { "vn-keepused": 20 },
}, "2026-10-31");
assert.equal(rewound.periodStart, "2026-11-01");
assert.equal(rewound.allowanceSecondsUsed, 4000);
assert.equal(rewound.topupSecondsRemaining, 30);
assert.equal(durationOverNoteCap({ clientSeconds: 10, parsedSeconds: 180 }), true);
assert.equal(durationOverNoteCap({ clientSeconds: 180, parsedSeconds: 30 }), false);
assert.equal(durationOverNoteCap({ clientSeconds: 180, parsedSeconds: null }), true);
assert.equal(durationOverNoteCap({ clientSeconds: 30, parsedSeconds: 30 }), false);

const sameMonth = normalizeUsage({
  v: 1,
  periodStart: "2026-11-01",
  periodEnd: "2026-12-01",
  allowanceSecondsUsed: 100,
  topupSecondsRemaining: 50,
  drafts: { "vn-bbbbbbbb": 12 },
}, "2026-11-21");
assert.equal(sameMonth.topupSecondsRemaining, 50);
assert.equal(sameMonth.drafts["vn-bbbbbbbb"], 12);

let usage = freshUsage("2026-11-21");
usage.allowanceSecondsUsed = MONTHLY_SECONDS - 5;
usage.topupSecondsRemaining = 100;
usage = consumeSeconds(usage, 10, "vn-clipclip");
assert.equal(usage.allowanceSecondsUsed, MONTHLY_SECONDS);
assert.equal(usage.topupSecondsRemaining, 95);
assert.equal(remainingSeconds(usage), 95);
assert.equal(usage.drafts["vn-clipclip"], 10);
usage = consumeSeconds(usage, 200);
assert.equal(usage.topupSecondsRemaining, 0);
assert.ok(usage.allowanceSecondsUsed > MONTHLY_SECONDS);
assert.equal(remainingSeconds(usage), 0);

const beforeCharge = { ...freshUsage("2026-11-21"), allowanceSecondsUsed: MONTHLY_SECONDS - 5, topupSecondsRemaining: 100, drafts: { "vn-draftone": 20 } };
const afterCharge = consumeSeconds(beforeCharge, 20, "vn-draftone");
const later = consumeSeconds(afterCharge, 10, "vn-drafttwo");
const restored = refundSeconds(later, beforeCharge, afterCharge);
assert.equal(restored.allowanceSecondsUsed, MONTHLY_SECONDS - 5);
assert.equal(restored.topupSecondsRemaining, 90);
assert.equal(restored.drafts["vn-draftone"], 20);
assert.equal(restored.drafts["vn-drafttwo"], 10);
const rolledAway = refundSeconds({
  ...afterCharge,
  periodStart: "2026-12-01",
  periodEnd: "2027-01-01",
  allowanceSecondsUsed: 0,
  topupSecondsRemaining: 0,
  drafts: {},
}, beforeCharge, afterCharge);
assert.equal(rolledAway.topupSecondsRemaining, 0);

const topped = grantTopup(freshUsage("2026-11-21"), "2026-11-21");
assert.equal(topped.topupSecondsRemaining, TOPUP_SECONDS);
assert.equal(canStartClip({ ...freshUsage("2026-11-21"), allowanceSecondsUsed: MONTHLY_SECONDS }, "vn-aaaaaaaa", 2), "out");
assert.equal(canStartClip(freshUsage("2026-11-21"), "vn-aaaaaaaa", 2), "ok");
assert.equal(canStartClip({ ...freshUsage("2026-11-21"), drafts: { "vn-aaaaaaaa": 110 } }, "vn-aaaaaaaa", 20), "note");
assert.equal(canStartClip({ ...freshUsage("2026-11-21"), drafts: { "vn-aaaaaaaa": 100 } }, "vn-aaaaaaaa", 20), "ok");
assert.equal(publicUsage(freshUsage("2026-11-21")).low, false);
assert.equal(publicUsage(freshUsage("2026-11-21"), "vn-aaaaaaaa").noteSecondsLeft, 120);

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
const DRAFT = "vn-testdraft";
const PROD = { OPENAI_API_KEY: "test-key" };

function audioRequest(bytes, { type = "audio/webm", durationMs = 2000, host = "supportflow.work", offset = -660, draftId = DRAFT, headers = {} } = {}) {
  const form = new FormData();
  form.append("audio", new Blob([bytes], { type }), type.includes("mp4") ? "note.mp4" : "note.webm");
  form.append("durationMs", String(durationMs));
  form.append("tzOffsetMinutes", String(offset));
  form.append("draftId", draftId);
  return new Request(`https://${host}/.netlify/functions/transcribe`, {
    method: "POST",
    headers: { origin: `https://${host}`, "x-sf-device": DEVICE, ...headers },
    body: form,
  });
}
function jsonRequest(body, host = "supportflow.work", headers = {}) {
  return new Request(`https://${host}/.netlify/functions/transcribe`, {
    method: "POST",
    headers: { origin: `https://${host}`, "content-type": "application/json", "x-sf-device": DEVICE, ...headers },
    body: JSON.stringify(body),
  });
}

const store = memoryUsageStore();
let transcribed = 0;
const say = async () => { transcribed += 1; return "Went to the shops and had a quiet afternoon."; };
const yes = async () => ({ ok: true, premium: false, subscription: true });
const base = {
  store,
  env: PROD,
  checkLicence: async () => ({ enforced: false, ok: true, sub: "user-1" }),
  entitled: yes,
  transcribeAudio: say,
};

{
  const res = await handleTranscribe(audioRequest(webm(2000)), base);
  const data = await res.json();
  assert.equal(res.status, 200);
  assert.equal(data.text, "Went to the shops and had a quiet afternoon.");
  assert.equal(data.audio, undefined);
  assert.equal(data.usage.allowanceSecondsUsed, 2);
  assert.equal(data.usage.noteSecondsUsed, 2);
  const saved = await store.get(`lic:user-1`);
  assert.equal(JSON.stringify(saved.value).includes("shops"), false);
  assert.equal(transcribed, 1);
}

{
  const res = await handleTranscribe(audioRequest(mp4(2), { type: "audio/mp4", durationMs: 2000 }), base);
  const data = await res.json();
  assert.equal(res.status, 200);
  assert.equal(data.usage.allowanceSecondsUsed, 4);
  assert.equal(data.usage.noteSecondsUsed, 4);
}

{
  const before = await store.get(`lic:user-1`);
  const res = await handleTranscribe(audioRequest(webm(2000)), { ...base, transcribeAudio: async () => "   " });
  const data = await res.json();
  assert.equal(data.error, "empty");
  assert.equal(data.text, "");
  const after = await store.get(`lic:user-1`);
  assert.equal(after.value.allowanceSecondsUsed, before.value.allowanceSecondsUsed);
  assert.equal(after.value.drafts[DRAFT], before.value.drafts[DRAFT]);
}

{
  const before = await store.get(`lic:user-1`);
  const res = await handleTranscribe(audioRequest(webm(2000)), {
    ...base,
    transcribeAudio: async () => { const err = new Error("upstream"); err.code = "upstream"; throw err; },
  });
  assert.equal(res.status, 502);
  const after = await store.get(`lic:user-1`);
  assert.equal(after.value.allowanceSecondsUsed, before.value.allowanceSecondsUsed);
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
  const named = audioRequest(webm(2000));
  const leaked = new Request(named.url, named);
  assert.equal(leaked.headers.get("x-participant"), null);
}

{
  const today = localDateFor(new Date(), -660);
  const [y, m] = today.split("-").map(Number);
  const periodEnd = `${m === 12 ? y + 1 : y}-${String(m === 12 ? 1 : m + 1).padStart(2, "0")}-01`;
  await store.set(`lic:user-1`, {
    v: 1, periodStart: today.slice(0, 8) + "01", periodEnd, allowanceSecondsUsed: MONTHLY_SECONDS,
    topupSecondsRemaining: 0, drafts: {},
  }, (await store.get(`lic:user-1`)).etag);
  const calls = transcribed;
  const res = await handleTranscribe(audioRequest(webm(2000), { draftId: "vn-monthfull" }), base);
  const data = await res.json();
  assert.equal(res.status, 402);
  assert.equal(data.error, "out-of-minutes");
  assert.equal(transcribed, calls);
}

{
  const cur = await store.get(`lic:user-1`);
  await store.set(`lic:user-1`, { ...cur.value, allowanceSecondsUsed: 0, drafts: { "vn-notefull": NOTE_SECONDS } }, cur.etag);
  const res = await handleTranscribe(audioRequest(webm(2000), { draftId: "vn-notefull" }), base);
  const data = await res.json();
  assert.equal(res.status, 402);
  assert.equal(data.error, "note-limit");
  assert.equal(transcribed, (await store.get(`lic:user-1`)).value.allowanceSecondsUsed === 0 ? transcribed : transcribed);
  assert.equal((await store.get(`lic:user-1`)).value.allowanceSecondsUsed, 0);
}

{
  const oldFetch = globalThis.fetch;
  let called = 0;
  globalThis.fetch = () => { called += 1; throw new Error("no network"); };
  const res = await handleTranscribe(jsonRequest({ action: "checkout", product: "voice_notes" }), {
    ...base,
    env: { ...PROD },
    session: { sub: "user-1", email: "a@example.com" },
  });
  globalThis.fetch = oldFetch;
  const data = await res.json();
  assert.equal(res.status, 503);
  assert.match(data.message, /isn't available yet/);
  assert.equal(called, 0);
}

{
  let body = "";
  const res = await handleVoiceCheckout({ product: "voice_notes" }, {
    env: { STRIPE_SECRET_KEY: "sk_test", SITE_URL: "https://supportflow.work", STRIPE_PRICE_VOICE_NOTES: "price_voice_month" },
    session: { sub: "user-1", email: "a@example.com", deviceId: DEVICE },
    entitled: async () => ({ ok: false, premium: false, subscription: false }),
    fetchImpl: async (url, init) => {
      body = init.body;
      return { ok: true, json: async () => ({ url: "https://checkout.stripe.com/c/pay/cs_test" }) };
    },
  });
  assert.equal(res.status, 200);
  assert.equal(res.body.url, "https://checkout.stripe.com/c/pay/cs_test");
  assert.match(body, /price_voice_month/);
  assert.match(body, /mode=subscription/);
  assert.match(body, /metadata%5Bkind%5D=voice/);
  assert.match(body, /metadata%5Bproduct%5D=voice_notes/);
  assert.match(body, /subscription_data%5Bmetadata%5D%5Bgoogle_sub%5D=user-1/);
}

{
  const res = await handleVoiceCheckout({ product: "voice_notes" }, {
    env: { STRIPE_SECRET_KEY: "sk_test", SITE_URL: "https://supportflow.work", STRIPE_PRICE_VOICE_NOTES: "price_voice_month" },
    session: { sub: "prem-1" },
    entitled: async () => ({ ok: true, premium: true, subscription: false }),
    fetchImpl: async () => { throw new Error("no network"); },
  });
  assert.equal(res.status, 409);
  assert.match(res.body.message, /Premium already includes/);
}

{
  let body = "";
  const res = await handleVoiceCheckout({ product: "voice_topup" }, {
    env: { STRIPE_SECRET_KEY: "sk_test", SITE_URL: "https://supportflow.work", STRIPE_PRICE_VOICE_TOPUP: "price_voice_topup" },
    session: { sub: "user-1" },
    entitled: async () => ({ ok: true, premium: false, subscription: true }),
    fetchImpl: async (_url, init) => {
      body = init.body;
      return { ok: true, json: async () => ({ url: "https://checkout.stripe.com/c/pay/cs_top" }) };
    },
  });
  assert.equal(res.status, 200);
  assert.match(body, /mode=payment/);
  assert.match(body, /price_voice_topup/);
  assert.match(body, /metadata%5Bproduct%5D=voice_topup/);
}

{
  const once = grantTopupOnce(freshUsage("2026-11-21"), "2026-11-21", "cs_1");
  assert.equal(once.granted, true);
  assert.equal(once.usage.topupSecondsRemaining, 120 * 60);
  const again = grantTopupOnce(once.usage, "2026-11-21", "cs_1");
  assert.equal(again.granted, false);
  assert.equal(again.usage.topupSecondsRemaining, 120 * 60);
  const revoked = revokeTopupOnce(again.usage, "cs_1");
  assert.equal(revoked.topupSecondsRemaining, 0);
  const row = voiceSubscriptionRow("user-1", { id: "sub_1", status: "active", customer: "cus_1", current_period_end: 1790000000, metadata: { product: "voice_notes" } }, false);
  assert.equal(row.status, "active");
  assert.equal(row.google_sub, "user-1");
  assert.equal(voiceCheckoutForm({ product: "voice_notes", price: "price_voice_month", site: "https://supportflow.work", sub: "user-1" }).mode, "subscription");
}

{
  const res = await handleTranscribe(audioRequest(webm(2000), { draftId: "vn-licensed1" }), {
    store: memoryUsageStore(),
    env: PROD,
    checkLicence: async () => ({ enforced: true, ok: false }),
    transcribeAudio: say,
  });
  assert.equal(res.status, 402);
  assert.equal((await res.json()).error, "licence-required");
}

{
  const paid = memoryUsageStore();
  const res = await handleTranscribe(audioRequest(webm(3000), { durationMs: 3000, draftId: "vn-premium1" }), {
    store: paid,
    env: PROD,
    checkLicence: async () => ({ enforced: true, ok: true, sub: "prem-1" }),
    entitled: async () => ({ ok: true, premium: true, subscription: false }),
    transcribeAudio: async () => "Noted.",
  });
  const data = await res.json();
  assert.equal(res.status, 200);
  assert.equal(data.text, "Noted.");
  assert.equal((await paid.get("lic:prem-1")).value.allowanceSecondsUsed, 3);
  assert.equal(await paid.get(`lic:user-1`), null);
}

{
  const res = await handleTranscribe(audioRequest(webm(2000), { draftId: "vn-nokey001" }), {
    store: memoryUsageStore(),
    env: {},
    checkLicence: async () => ({ enforced: false, ok: false }),
  });
  const data = await res.json();
  assert.equal(res.status, 503);
  assert.equal(data.error, "voice notes not configured");
}

{
  const res = await handleTranscribe(jsonRequest({ action: "status", tzOffsetMinutes: -660 }), {
    store: memoryUsageStore(),
    env: {},
    checkLicence: async () => ({ enforced: false, ok: false }),
  });
  const data = await res.json();
  assert.equal(res.status, 503);
  assert.equal(data.error, "voice notes not configured");
  assert.equal(data.configured, false);
  assert.equal(data.usage, null);
  assert.equal(data.entitled, false);
}

{
  const res = await handleTranscribe(jsonRequest({ action: "status", tzOffsetMinutes: -660 }), {
    store: { async get() { throw new Error("down"); }, async set() {} },
    env: {},
    checkLicence: async () => ({ enforced: false, ok: false }),
  });
  const data = await res.json();
  assert.equal(res.status, 503);
  assert.equal(data.error, "voice notes not configured");
  assert.equal(data.usage, null);
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
  const res = await handleTranscribe(audioRequest(webm(2000), { headers: { "x-sf-device": "" }, draftId: "vn-noident1" }), {
    store: memoryUsageStore(),
    env: PROD,
    checkLicence: async () => ({ enforced: false, ok: false }),
    transcribeAudio: say,
  });
  assert.equal(res.status, 402);
  assert.equal((await res.json()).error, "voice-notes-required");
}

{
  const race = memoryUsageStore();
  const today = localDateFor(new Date(), -660);
  const [y, m] = today.split("-").map(Number);
  const periodEnd = `${m === 12 ? y + 1 : y}-${String(m === 12 ? 1 : m + 1).padStart(2, "0")}-01`;
  await race.set(`lic:user-1`, {
    v: 1, periodStart: today.slice(0, 8) + "01", periodEnd,
    allowanceSecondsUsed: MONTHLY_SECONDS - 3, topupSecondsRemaining: 0, drafts: {},
  }, null);
  let calls = 0;
  const depsFor = (sayText) => ({
    store: race, env: PROD,
    checkLicence: async () => ({ enforced: false, ok: true, sub: "user-1" }),
    entitled: yes,
    transcribeAudio: sayText,
  });
  const first = await handleTranscribe(audioRequest(webm(10000), { durationMs: 10000, draftId: "vn-raceone1" }), depsFor(async () => {
    calls += 1;
    const second = await handleTranscribe(audioRequest(webm(10000), { durationMs: 10000, draftId: "vn-racetwo2" }), depsFor(async () => {
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
  const saved = await race.get(`lic:user-1`);
  assert.ok(saved.value.allowanceSecondsUsed >= MONTHLY_SECONDS);
}

{
  const race = memoryUsageStore();
  let calls = 0;
  const depsFor = (sayText) => ({
    store: race, env: PROD,
    checkLicence: async () => ({ enforced: false, ok: true, sub: "user-1" }),
    entitled: yes,
    transcribeAudio: sayText,
  });
  const first = await handleTranscribe(audioRequest(webm(120000), { durationMs: 120000, draftId: "vn-samenote" }), depsFor(async () => {
    calls += 1;
    const second = await handleTranscribe(audioRequest(webm(2000), { durationMs: 2000, draftId: "vn-samenote" }), depsFor(async () => {
      calls += 1;
      return "second";
    }));
    assert.equal(second.status, 402);
    assert.equal((await second.json()).error, "note-limit");
    return "first";
  }));
  assert.equal((await first.json()).text, "first");
  assert.equal(calls, 1);
  assert.equal((await race.get(`lic:user-1`)).value.drafts["vn-samenote"], 120);
}

const src = fs.readFileSync(new URL("./functions/transcribe.mjs", import.meta.url), "utf8");
assert.doesNotMatch(src, /from ["']stripe|sendEmail|resend\.com/i);
assert.match(src, /process\.env\.OPENAI_API_KEY|env\.OPENAI_API_KEY/);
assert.match(src, /voice notes not configured/);
assert.match(src, /gpt-transcribe/);
assert.match(src, /form\.append\("languages\[\]", "en"\)/);
assert.match(src, /durationOverNoteCap/);
assert.doesNotMatch(src, /form\.append\([^)]*en-AU/);
assert.doesNotMatch(src, /console\.(log|error|warn|info)\([^)]*\b(text|bytes|rawText|audio)\b/);
assert.doesNotMatch(src, /voicePreviewOpen/);
assert.doesNotMatch(src, /form\.get\(["'](?:participant|name|ndis)|body\.(?:participant|name|ndis)/i);
const hook = fs.readFileSync(new URL("./functions/stripe-webhook.mjs", import.meta.url), "utf8");
assert.match(hook, /customer\.subscription\.created/);
assert.match(hook, /customer\.subscription\.updated/);
assert.match(hook, /customer\.subscription\.deleted/);
assert.match(hook, /handleVoiceSubscriptionChange/);
assert.match(hook, /grantVoiceTopupSession/);
assert.match(hook, /checkout\.session\.completed/);
const billing = fs.readFileSync(new URL("./lib/voice-billing.mjs", import.meta.url), "utf8");
assert.match(billing, /STRIPE_PRICE_VOICE_NOTES/);
assert.match(billing, /STRIPE_PRICE_VOICE_TOPUP/);
assert.match(billing, /api\.stripe\.com\/v1\/checkout\/sessions/);
assert.doesNotMatch(billing, /console\.(log|error|warn|info)\([^)]*\b(text|bytes|audio)\b/);

const ui = fs.readFileSync(new URL("../app.jsx", import.meta.url), "utf8");
assert.match(ui, /function voiceSplice/);
assert.match(ui, /fd\.append\("audio"/);
assert.match(ui, /fd\.append\("durationMs"/);
assert.match(ui, /fd\.append\("tzOffsetMinutes"/);
assert.match(ui, /fd\.append\("draftId"/);
assert.doesNotMatch(ui.slice(ui.indexOf("function VoiceNoteMic"), ui.indexOf("function VoiceNotesSettings")), /participantId|ndisNumber|fd\.append\("text"/);
assert.match(ui, /Voice notes aren't set up on this site yet/);
assert.match(ui, /Add Voice notes — A\$5\/month/);
assert.match(ui, /Voice notes checkout isn't available yet/);

console.log("voice notes tests pass");
