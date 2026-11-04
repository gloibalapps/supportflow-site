// SMS add-on tests with a MOCK provider and mocked Supabase/Stripe. No real SMS,
// no network. Run from the repo root: node netlify/tracker-sms.test.mjs
import crypto from "node:crypto";
import assert from "node:assert";
Object.assign(process.env, {
  TRACKER_DATA_KEY: crypto.randomBytes(32).toString("base64"), LICENCE_SECRET: "s".repeat(40),
  SUPABASE_URL: "https://supa.test", SUPABASE_SERVICE_KEY: "k", STRIPE_SECRET_KEY: "sk_test_x", SITE_URL: "https://sf.test",
  STRIPE_WEBHOOK_SECRET: "whsec_test", STRIPE_PRICE_TRACKER_SMS: "price_sms", TWILIO_AUTH_TOKEN: "twtok",
});
const T = await import("./lib/tracker.mjs");
const S = await import("./lib/sms.mjs");
const L = await import("./lib/licence.mjs");
let pass = 0; const t = (name, fn) => fn().then(() => { pass++; console.log("ok -", name); });

// ---- mock world ----
let state, calls;
const reset = () => { state = { balance: 50, unlocked: true, smsSubs: [{ stripe_subscription_id: "sub_1", status: "active" }], profile: null, consumeReturn: null }; calls = []; };
const sent = [];
S.__setTestProvider({ name: "mock", from: "+61400000000", async send(m) { if (state.providerFail) throw new Error("boom"); sent.push(m); return { id: "SM" + sent.length }; } });
globalThis.fetch = async (url, opt = {}) => {
  url = String(url); const body = opt.body && opt.headers?.["Content-Type"] === "application/json" ? JSON.parse(opt.body) : opt.body;
  calls.push({ method: opt.method || "GET", url, body });
  const ok = (b) => new Response(JSON.stringify(b), { status: 200 });
  const path = url.replace("https://supa.test/rest/v1/", "");
  if (path.startsWith("licence_payments")) return ok(state.unlocked ? [{ product: "tracker_base" }] : []);
  if (path.startsWith("tracker_devices")) return opt.method === "POST" ? new Response(null, { status: 201 }) : ok([{ device_id: "11111111-1111-4111-8111-111111111111" }]);
  if (path.startsWith("tracker_sms_profiles")) return opt.method && opt.method !== "GET" ? new Response(null, { status: 204 }) : ok(state.profile ? [state.profile] : []);
  if (path.startsWith("tracker_sms_subscriptions")) return opt.method && opt.method !== "GET" ? new Response(null, { status: 204 }) : ok(state.smsSubs);
  if (path.startsWith("tracker_sms_balances")) return ok([{ balance: state.balance }]);
  if (path.startsWith("tracker_sms_ledger")) return ok([{ google_sub: "u1", stripe_invoice_id: "in_1" }]);
  if (path === "rpc/tracker_sms_consume") { const n = state.balance >= body.p_segments ? (state.balance -= body.p_segments) : -1; return ok(n); }
  if (path.startsWith("rpc/")) return ok(0);
  if (url.includes("api.stripe.com/v1/checkout/sessions")) return ok({ url: "https://checkout.stripe.test/x" });
  if (url.includes("api.stripe.com/v1/subscriptions/")) return ok({ id: "sub_1", status: "active", customer: "cus_1", metadata: { product: "tracker_sms", google_sub: "u1" }, items: { data: [{ current_period_end: 1790000000 }] } });
  return new Response(null, { status: 204 });
};
const verified = () => ({ phone_enc: T.seal({ phone: "+61412345678" }), verified_at: "2026-11-01T00:00:00Z", opted_in: true, stopped_at: null });

await t("normalises AU mobiles only", async () => {
  assert.equal(S.normaliseAuMobile("0412 345 678"), "+61412345678");
  assert.equal(S.normaliseAuMobile("+61 412-345-678"), "+61412345678");
  assert.equal(S.normaliseAuMobile("08 8123 4567"), null);
  assert.equal(S.normaliseAuMobile("+1 415 555 0100"), null);
});
await t("segments: GSM-7 160/153, unicode 70/67", async () => {
  assert.equal(S.smsSegments("a".repeat(160)), 1); assert.equal(S.smsSegments("a".repeat(161)), 2);
  assert.equal(S.smsSegments("é".repeat(160)), 1); assert.equal(S.smsSegments("✓" + "a".repeat(70)), 2);
});
const { smsText } = await import("./functions/tracker-sender.mjs");
await t("every alert text is 1 segment incl. STOP footer, no names", async () => {
  for (const p of ["plan", "self", "agency"]) for (const st of [1, 2, 3]) for (const status of ["sent", "dry_run"]) {
    const txt = smsText(p, st, "INV-000123456", p === "agency" || st === 3, status) + " Reply STOP to opt out.";
    assert.equal(S.smsSegments(txt), 1, txt);
  }
});
await t("off by default: no send, no credit use", async () => {
  reset(); state.profile = verified(); delete process.env.TRACKER_SMS_ENABLED;
  assert.equal((await S.sendWorkerSms("u1", "x")).status, "off");
  assert.equal(calls.length, 0); assert.equal(sent.length, 0);
});
process.env.TRACKER_SMS_ENABLED = "true";
await t("dry run (default): checks balance, spends nothing, sends nothing", async () => {
  reset(); state.profile = verified(); delete process.env.TRACKER_SMS_DRY_RUN;
  const r = await S.sendWorkerSms("u1", "SupportFlow: test.");
  assert.equal(r.status, "dry_run"); assert.equal(state.balance, 50); assert.equal(sent.length, 0);
  assert(!calls.some((c) => c.url.includes("tracker_sms_consume")));
});
process.env.TRACKER_SMS_DRY_RUN = "false";
await t("live (mock provider): goes to the worker's verified number, decrements per segment, STOP footer", async () => {
  reset(); state.profile = verified();
  const r = await S.sendWorkerSms("u1", "SupportFlow: Invoice 12 is 7 business days unpaid.");
  assert.equal(r.status, "sent"); assert.equal(r.segments, 1); assert.equal(state.balance, 49);
  assert.equal(sent.at(-1).to, "+61412345678"); assert.match(sent.at(-1).body, /Reply STOP to opt out\.$/);
});
await t("unverified / not opted in / STOPped / no active pack -> not_set_up", async () => {
  for (const prof of [null, { ...verified(), verified_at: null }, { ...verified(), opted_in: false }, { ...verified(), stopped_at: "2026-11-02T00:00:00Z" }]) {
    reset(); state.profile = prof; assert.equal((await S.sendWorkerSms("u1", "x")).status, "not_set_up");
  }
  reset(); state.profile = verified(); state.smsSubs = []; assert.equal((await S.sendWorkerSms("u1", "x")).status, "not_set_up");
});
await t("out of credits -> no_credits, nothing sent", async () => {
  reset(); state.profile = verified(); state.balance = 0; const n = sent.length;
  assert.equal((await S.sendWorkerSms("u1", "x")).status, "no_credits"); assert.equal(sent.length, n);
});
await t("provider failure refunds the segments", async () => {
  reset(); state.profile = verified(); state.providerFail = true;
  const r = await S.sendWorkerSms("u1", "x"); assert.equal(r.status, "failed");
  assert(calls.some((c) => c.url.endsWith("rpc/tracker_sms_refund_usage")));
});

// ---- checkout eligibility ----
const tracker = (await import("./functions/tracker.mjs")).default;
const session = L.signSession({ sub: "u1", email: "w@x.test", name: "W", ev: true });
const post = (b) => tracker(new Request("https://sf.test/.netlify/functions/tracker", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ deviceId: "11111111-1111-4111-8111-111111111111", session, ...b }) }));
await t("SMS pack refused without the tracker", async () => {
  reset(); state.unlocked = false;
  const r = await post({ action: "checkout", product: "tracker_sms" }); assert.equal(r.status, 409);
  assert(!calls.some((c) => c.url.includes("checkout/sessions")));
});
await t("tracker owners get a subscription-mode checkout with metadata on the subscription", async () => {
  reset(); state.smsSubs = [];
  const r = await post({ action: "checkout", product: "tracker_sms" }); assert.equal(r.status, 200);
  const c = calls.find((x) => x.url.includes("checkout/sessions")); const p = new URLSearchParams(c.body);
  assert.equal(p.get("mode"), "subscription"); assert.equal(p.get("line_items[0][price]"), "price_sms");
  assert.equal(p.get("subscription_data[metadata][product]"), "tracker_sms"); assert.equal(p.get("subscription_data[metadata][google_sub]"), "u1");
  assert.equal(p.get("customer_creation"), null);
});
await t("a second active SMS pack is refused", async () => {
  reset(); const r = await post({ action: "checkout", product: "tracker_sms" }); assert.equal(r.status, 409);
});
await t("sms-start rejects non-mobiles and missing opt-in; never sends a code in dry run", async () => {
  reset(); process.env.TRACKER_SMS_DRY_RUN = "true"; const n = sent.length;
  assert.equal((await post({ action: "sms-start", phone: "08 8123 4567", optIn: true })).status, 400);
  assert.equal((await post({ action: "sms-start", phone: "0412345678", optIn: false })).status, 400);
  const r = await post({ action: "sms-start", phone: "0412345678", optIn: true }); const d = await r.json();
  assert.equal(r.status, 200); assert.equal(d.sent, false); assert.equal(sent.length, n);
  process.env.TRACKER_SMS_DRY_RUN = "false";
});

// ---- Stripe webhook ----
const webhook = (await import("./functions/stripe-webhook.mjs")).default;
const fire = (type, object) => {
  const payload = JSON.stringify({ id: "evt_" + type, type, data: { object } }); const ts = Math.floor(Date.now() / 1000);
  const sig = crypto.createHmac("sha256", "whsec_test").update(`${ts}.${payload}`).digest("hex");
  return webhook(new Request("https://sf.test/.netlify/functions/stripe-webhook", { method: "POST", headers: { "stripe-signature": `t=${ts},v1=${sig}` }, body: payload }));
};
await t("invoice.paid resets credits to 50 for that invoice", async () => {
  reset(); const r = await fire("invoice.paid", { id: "in_9", subscription: "sub_1", payment_intent: "pi_9", lines: { data: [{ period: { end: 1790000000 } }] } });
  assert.equal(r.status, 200); const c = calls.find((x) => x.url.endsWith("rpc/tracker_sms_reset"));
  assert.equal(c.body.p_credits, 50); assert.equal(c.body.p_invoice, "in_9"); assert.equal(c.body.p_sub, "u1");
});
await t("customer.subscription.deleted zeroes credits", async () => {
  reset(); await fire("customer.subscription.deleted", { id: "sub_1", status: "canceled", customer: "cus_1", metadata: { product: "tracker_sms", google_sub: "u1" } });
  assert.equal(calls.find((x) => x.url.endsWith("rpc/tracker_sms_zero")).body.p_reason, "cancelled");
});
await t("customer.subscription.updated mirrors status (past_due keeps credits)", async () => {
  reset(); await fire("customer.subscription.updated", { id: "sub_1", status: "past_due", customer: "cus_1", metadata: { product: "tracker_sms", google_sub: "u1" } });
  assert(calls.some((x) => x.url.includes("tracker_sms_subscriptions") && x.method === "POST" && x.body.status === "past_due"));
  assert(!calls.some((x) => x.url.endsWith("rpc/tracker_sms_zero")));
});
await t("charge.refunded / dispute on an SMS charge zeroes that period", async () => {
  reset(); await fire("charge.refunded", { id: "ch_9", payment_intent: "pi_9", refunded: true, amount: 499, amount_refunded: 499 });
  assert.equal(calls.find((x) => x.url.endsWith("rpc/tracker_sms_zero")).body.p_reason, "refunded");
  reset(); await fire("charge.dispute.created", { payment_intent: "pi_9", charge: "ch_9" });
  assert.equal(calls.find((x) => x.url.endsWith("rpc/tracker_sms_zero")).body.p_reason, "disputed");
});
await t("subscription events for other products are ignored", async () => {
  reset(); await fire("customer.subscription.deleted", { id: "sub_x", status: "canceled", metadata: {} });
  assert(!calls.some((x) => x.url.includes("tracker_sms")));
});

// ---- inbound STOP ----
const inbound = (await import("./functions/tracker-sms-inbound.mjs")).default;
const twilioPost = (params, good = true) => {
  const url = "https://sf.test/.netlify/functions/tracker-sms-inbound";
  const sig = crypto.createHmac("sha1", "twtok").update(url + Object.keys(params).sort().map((k) => k + params[k]).join("")).digest("base64");
  return inbound(new Request(url, { method: "POST", headers: { "x-twilio-signature": good ? sig : "bad" }, body: new URLSearchParams(params).toString() }));
};
await t("STOP reply opts the worker out; bad signature rejected", async () => {
  reset(); assert.equal((await twilioPost({ From: "+61412345678", Body: "STOP" }, false)).status, 403);
  const r = await twilioPost({ From: "+61412345678", Body: "stop" }); assert.match(await r.text(), /stopped/);
  const c = calls.find((x) => x.url.includes("tracker_sms_profiles?phone_hash=") && x.method === "PATCH");
  assert.equal(c.body.opted_in, false); assert(c.body.stopped_at);
});
console.log(`\n${pass} SMS tests passed (mock provider, no network, no real SMS)`);
