// Premium window: Adelaide cutoff, saving calculated from A$149 and A$129,
// and checkout selection that the client cannot override.
import assert from "node:assert";
import vm from "node:vm";
import { readFileSync } from "node:fs";
import {
  PREMIUM_LIST_AUD, PREMIUM_WINDOW_AUD, premiumWindowOpen, premiumSaving, premiumCheckoutSelection, adelaideDate, __setPremiumNow,
} from "./lib/premium-window.mjs";

const at = (iso) => new Date(iso);
assert.equal(adelaideDate(at("2026-11-06T04:00:00Z")), "2026-11-06");
assert.equal(premiumWindowOpen(at("2027-01-31T13:29:00Z")), true); // 23:59 Adelaide
assert.equal(premiumWindowOpen(at("2027-01-31T13:30:00Z")), false); // 00:00 1 Feb Adelaide
assert.equal(premiumWindowOpen(at("2027-02-01T00:00:00+10:30")), false);

const saving = premiumSaving();
assert.equal(saving.amount, PREMIUM_LIST_AUD - PREMIUM_WINDOW_AUD);
assert.equal(saving.amount, 20);
assert.equal(saving.percent, Math.round((20 / 149) * 100));
assert.equal(saving.percent, 13);

const env = {
  STRIPE_PRICE_TRACKER_FULL: "price_149",
  STRIPE_COUPON_PREMIUM_129: "coupon_20",
  STRIPE_PRICE_PREMIUM_129: "price_129",
};
assert.deepEqual(premiumCheckoutSelection(env, at("2026-11-06T00:00:00Z")), {
  price: "price_149", coupon: "coupon_20", chargeAud: 129, windowOpen: true,
});
assert.deepEqual(premiumCheckoutSelection({ STRIPE_PRICE_TRACKER_FULL: "price_149", STRIPE_PRICE_PREMIUM_129: "price_129" }, at("2026-12-01T00:00:00Z")), {
  price: "price_129", coupon: null, chargeAud: 129, windowOpen: true,
});
assert.deepEqual(premiumCheckoutSelection(env, at("2027-02-01T00:00:00+10:30")), {
  price: "price_149", coupon: null, chargeAud: 149, windowOpen: false,
});
assert.ok(premiumCheckoutSelection({ STRIPE_PRICE_TRACKER_FULL: "price_149" }, at("2026-11-06T00:00:00Z")).error);

const ctx = { Intl, Date, Math, globalThis: {} };
vm.runInNewContext(readFileSync(new URL("../premium-price.js", import.meta.url), "utf8"), ctx);
const client = ctx.globalThis.SupportFlowPremium;
assert.equal(client.listAud, PREMIUM_LIST_AUD);
assert.equal(client.windowAud, PREMIUM_WINDOW_AUD);
assert.equal(client.tz, "Australia/Adelaide");
assert.equal(client.windowOpen(at("2027-01-31T13:29:00Z")), true);
assert.equal(client.windowOpen(at("2027-01-31T13:30:00Z")), false);
assert.equal(client.saving().percent, saving.percent);
assert.equal(client.chargeAud(at("2027-02-01T02:00:00Z")), 149);

__setPremiumNow(() => at("2027-03-01T00:00:00Z"));
assert.equal(premiumWindowOpen(), false);
__setPremiumNow(null);

console.log("premium window tests pass");
