// Run: node --test tests/
import test from "node:test";
import assert from "node:assert/strict";
import { offerState, hashIp, FREE_OFFER } from "../netlify/lib/free-offer.mjs";
const now = Date.parse("2026-11-05T00:00:00Z");
const inDays = (d) => new Date(now + d * 86400000).toISOString();
test("fresh account shows 5 invoices / 30 days", () => {
  assert.deepEqual(offerState({ free_credits_remaining: 5, credit_balance: 0, credits_expire_at: inDays(30) }, now), { remaining: 5, daysLeft: 30, expiresAt: inDays(30) });
});
test("used up -> paywall", () => assert.equal(offerState({ free_credits_remaining: 0, credits_expire_at: inDays(10) }, now), null));
test("expired -> paywall", () => assert.equal(offerState({ free_credits_remaining: 3, credits_expire_at: inDays(-1) }, now), null));
test("lifetime -> no banner", () => assert.equal(offerState({ free_credits_remaining: 5, credit_balance: 99999, credits_expire_at: inDays(30) }, now), null));
test("ip hash is salted and stable", () => {
  assert.equal(hashIp("1.2.3.4", "s"), hashIp("1.2.3.4", "s"));
  assert.notEqual(hashIp("1.2.3.4", "s"), hashIp("1.2.3.4", "t"));
  assert.equal(hashIp("", "s"), null);
});
test("offer constants", () => assert.equal(FREE_OFFER.invoices, 5));
