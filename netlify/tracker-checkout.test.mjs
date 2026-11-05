// Final tracker pricing: checkout gating and entitlement mapping. Mocked Supabase/Stripe, no network.
// Run from the repo root: node netlify/tracker-checkout.test.mjs
import assert from "node:assert";
Object.assign(process.env, {
  LICENCE_SECRET: "s".repeat(40), SUPABASE_URL: "https://supa.test", SUPABASE_SERVICE_KEY: "k",
  STRIPE_SECRET_KEY: "sk_test_x", SITE_URL: "https://sf.test",
  STRIPE_PRICE_TRACKER_BASE: "p_base", STRIPE_PRICE_TRACKER_TWO: "p_two", STRIPE_PRICE_TRACKER_ADDON: "p_addon",
  STRIPE_PRICE_TRACKER_FULL: "p_full", STRIPE_PRICE_TRACKER_SMS: "p_sms",
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
  return { status: r.status, price: c ? new URLSearchParams(c.body).get("line_items[0][price]") : null };
};
const prices = Object.fromEntries(T.trackerOffer().map((o) => [o.id, o.priceAud]));
assert.deepEqual(prices, { tracker_base: 49, tracker_two: 69, tracker_addon: 29, tracker_full: 99, tracker_sms: 4.99 });
const as = (...p) => { rows = p.map((product) => ({ product, created_at: "2026-11-05T00:00:00Z" })); };
as(); assert.equal(await T.trackerUnlock("u1"), null);
as("tracker_two"); assert.equal((await T.trackerUnlock("u1")).devices, 2);
as("tracker_base"); assert.equal((await T.trackerUnlock("u1")).devices, 1);
as("tracker_base", "tracker_addon"); assert.equal((await T.trackerUnlock("u1")).devices, 2);
as("tracker_addon"); assert.equal(await T.trackerUnlock("u1"), null);
as("tracker_full"); const f = await T.trackerUnlock("u1"); assert.equal(f.devices, 2); assert.deepEqual(Object.keys(f).sort(), ["addon", "devices", "full", "product"]);
assert.deepEqual(T.trackerOffer().find((o) => o.id === "tracker_full").items, ["Everything in Basic (invoices, shifts, notes, kilometres, expenses and tax)", "Two-device license", "Payment tracker", "SMS notification \u2014 optional (A$4.99 a month for 50 texts, not included in A$99)"]);
assert.doesNotMatch(JSON.stringify(T.trackerOffer()), /upgrades|12 months/i);
// checkout
as(); assert.deepEqual(await buy("tracker_base"), { status: 200, price: "p_base" });
as(); assert.deepEqual(await buy("tracker_two"), { status: 200, price: "p_two" });
as(); assert.deepEqual(await buy("tracker_full"), { status: 200, price: "p_full" });
as(); assert.equal((await buy("tracker_addon")).status, 409);
as("tracker_base"); assert.deepEqual(await buy("tracker_addon"), { status: 200, price: "p_addon" });
as("tracker_base"); assert.equal((await buy("tracker_base")).status, 409);
as("tracker_base"); assert.equal((await buy("tracker_two")).status, 409);
as("tracker_two"); assert.equal((await buy("tracker_addon")).status, 409);
as("tracker_full"); assert.equal((await buy("tracker_addon")).status, 409);
as("tracker_base", "tracker_addon"); assert.equal((await buy("tracker_addon")).status, 409);
console.log("tracker checkout/entitlement tests pass (final pricing A$49/A$69/A$29/A$99 + SMS A$4.99)");
