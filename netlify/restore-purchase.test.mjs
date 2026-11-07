// Restore by email now needs a confirmation link. Mocked Stripe/Supabase/Resend, no network.
// Run from the repo root: node netlify/restore-purchase.test.mjs
import assert from "node:assert";
Object.assign(process.env, {
  LICENCE_SECRET: "s".repeat(40), SUPABASE_URL: "https://supa.test", SUPABASE_SERVICE_KEY: "k",
  STRIPE_SECRET_KEY: "sk_test_x", SITE_URL: "https://sf.test", RESEND_API_KEY: "re_x",
});
const ACCT = "11111111-2222-4333-8444-555555555555";
let emails = [];
globalThis.fetch = async (url, opt = {}) => {
  url = String(url);
  const ok = (b) => new Response(JSON.stringify(b), { status: 200 });
  if (url.includes("api.stripe.com/v1/customers")) return ok({ data: url.includes("buyer%40example.com") ? [{ id: "cus_1" }] : [] });
  if (url.includes("/rest/v1/accounts")) return ok([{ id: ACCT, credit_balance: 99999 }]);
  if (url.includes("api.resend.com")) { emails.push(JSON.parse(opt.body)); return ok({ id: "e" }); }
  return ok([]);
};
const restore = (await import("./functions/restore-purchase.mjs")).default;
const L = await import("./lib/licence.mjs");
const post = (body) => restore(new Request("https://sf.test/x", { method: "POST", body: JSON.stringify(body) }));

// Unknown email: same answer, nothing sent.
let r = await post({ email: "nobody@example.com" });
assert.equal(r.status, 200); assert.equal((await r.json()).sent, true); assert.equal(emails.length, 0);

// Known email: link emailed to that address, and the device ref is NOT returned.
r = await post({ email: "buyer@example.com" });
const body = await r.json();
assert.equal(body.sent, true); assert.equal(body.deviceRef, undefined);
assert.equal(emails.length, 1); assert.deepEqual(emails[0].to, ["buyer@example.com"]);
const link = emails[0].text.match(/https:\/\/sf\.test\/app#sf_restore=(\S+)/);
assert.ok(link, "email contains a restore link");

// Second request within a minute: same answer, no second email.
await post({ email: "buyer@example.com" });
assert.equal(emails.length, 1);

// Redeeming the link returns the device ref.
const token = decodeURIComponent(link[1]);
r = await post({ token });
const got = await r.json();
assert.equal(r.status, 200); assert.equal(got.deviceRef, ACCT); assert.equal(got.lifetime, true);

// Tampered and expired tokens are refused.
assert.equal((await post({ token: token.slice(0, -2) + "xx" })).status, 400);
const real = Date.now; Date.now = () => real() + 16 * 60000;
assert.equal((await post({ token })).status, 400);
Date.now = real;
assert.equal(L.verifyRestoreToken("garbage"), null);
console.log("restore-purchase tests pass");
