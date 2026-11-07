// Tracker pricing: A$29 tracker, separate second-device add-on, Premium A$129, SMS.
// Retired SKUs are refused. Mocked Supabase/Stripe, no network.
// Run from the repo root: node netlify/tracker-checkout.test.mjs
import assert from "node:assert";
Object.assign(process.env, {
  LICENCE_SECRET: "s".repeat(40), SUPABASE_URL: "https://supa.test", SUPABASE_SERVICE_KEY: "k",
  STRIPE_SECRET_KEY: "sk_test_x", SITE_URL: "https://sf.test",
  STRIPE_PRICE_TRACKER: "p_tracker",
  STRIPE_PRICE_TRACKER_FULL: "p_full",
  STRIPE_PRICE_TRACKER_SMS: "p_sms",
});
let rows = [], calls = [];
globalThis.fetch = async (url, opt = {}) => {
  url = String(url); calls.push({ url, body: opt.body });
  const ok = (b) => new Response(JSON.stringify(b), { status: 200 });
  if (url.includes("licence_payments")) return ok(rows);
  if (url.includes("checkout/sessions")) return ok({ url: "https://checkout.test/s" });
  return ok([]);
};
const T = await import("./lib/tracker.mjs");
const L = await import("./lib/licence.mjs");
const tracker = (await import("./functions/tracker.mjs")).default;
const session = L.signSession({ sub: "u1", email: "w@x.test", name: "W", ev: true });
const buy = async (product) => {
  calls = [];
  const r = await tracker(new Request("https://sf.test/.netlify/functions/tracker", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "checkout", deviceId: "11111111-1111-4111-8111-111111111111", session, product }) }));
  const c = calls.find((x) => x.url.includes("checkout/sessions"));
  const params = c ? new URLSearchParams(c.body) : null;
  return {
    status: r.status,
    price: params ? params.get("line_items[0][price]") : null,
    discounts: params ? [...params.keys()].some((k) => k.startsWith("discounts")) : null,
    mode: params ? params.get("mode") : null,
  };
};
const prices = Object.fromEntries(T.trackerOffer().map((o) => [o.id, o.priceAud]));
assert.deepEqual(prices, { tracker: 29, tracker_full: 129, tracker_sms: 4.99 });
const full = T.trackerOffer().find((o) => o.id === "tracker_full");
assert.equal(full.priceAud, 129);
assert.deepEqual(Object.keys(full).filter((k) => /list|saving|window|coupon|timezone/i.test(k)), []);
assert.deepEqual(full.items, [
  "Everything in Basic (invoices, shifts, notes, kilometres, expenses and tax)",
  "Two-device license",
  "Payment tracker",
  "SMS notification \u2014 optional (A$4.99 a month for 50 texts, not included in any package, including Premium)",
]);
assert.doesNotMatch(JSON.stringify(T.trackerOffer()), /Founding|first 200|sale|registration|coupon|discount/i);
const as = (...p) => { rows = p.map((product) => ({ product, created_at: "2026-11-05T00:00:00Z" })); };
as(); assert.equal(await T.trackerUnlock("u1"), null);
as("tracker"); assert.equal((await T.trackerUnlock("u1")).devices, 1);
as("tracker_two"); assert.equal((await T.trackerUnlock("u1")).devices, 2);
as("tracker_base"); assert.equal((await T.trackerUnlock("u1")).devices, 1);
as("tracker_base", "tracker_addon"); assert.equal((await T.trackerUnlock("u1")).devices, 2);
as("tracker_addon"); assert.equal(await T.trackerUnlock("u1"), null);
as("tracker_full"); const f = await T.trackerUnlock("u1"); assert.equal(f.devices, 2); assert.equal(f.full, true);
// checkout: client cannot pick the amount
as(); assert.deepEqual(await buy("tracker"), { status: 200, price: "p_tracker", discounts: false, mode: "payment" });
as(); assert.deepEqual(await buy("tracker_full"), { status: 200, price: "p_full", discounts: false, mode: "payment" });
as(); assert.equal((await buy("tracker_base")).status, 410);
as(); assert.equal((await buy("tracker_two")).status, 410);
as(); assert.equal((await buy("tracker_addon")).status, 410);
as("tracker"); assert.equal((await buy("tracker")).status, 409);
as("tracker"); assert.equal((await buy("tracker_full")).status, 409);
as("tracker_base"); assert.equal((await buy("tracker_addon")).status, 410);
as("tracker"); assert.deepEqual(await buy("tracker_sms"), { status: 200, price: "p_sms", discounts: false, mode: "subscription" });
as(); assert.equal((await buy("tracker_sms")).status, 409);
// no price configured: Premium is not sold
delete process.env.STRIPE_PRICE_TRACKER_FULL;
as(); assert.equal((await buy("tracker_full")).status, 503);
console.log("tracker checkout/entitlement tests pass (A$29 tracker, Premium A$129, SMS A$4.99)");
