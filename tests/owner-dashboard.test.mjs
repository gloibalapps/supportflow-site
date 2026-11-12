// Run: node --test tests/owner-dashboard.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { buildOwner, composeOwner, creditPlan, primaryPlan } from "../netlify/lib/owner-stats.mjs";
import { dashboardStats } from "../netlify/lib/stats.mjs";

const now = Date.parse("2026-11-06T12:00:00Z");
const day = 86400000;
const iso = (delta) => new Date(now + delta * day).toISOString();

test("primary plan prefers Premium over an earlier Basic payment", () => {
  assert.equal(primaryPlan(new Set(["one", "tracker_full"]), null).id, "premium");
  assert.equal(primaryPlan(new Set(["one", "upgrade"]), null).id, "basic_second");
  assert.equal(primaryPlan(new Set(["tracker_base", "tracker_addon"]), null).id, "tracker_two");
  assert.equal(primaryPlan(new Set(), { status: "active", plan: 1 }).id, "basic");
  assert.equal(primaryPlan(new Set(), { status: "revoked", plan: 1 }), null);
});

test("lifetime device checkout is Basic, a 50c test pack is not", () => {
  assert.equal(creditPlan({ pack: "value", credits: 99999 }).id, "basic_device");
  assert.equal(creditPlan({ pack: "casual", credits: 1, amount_aud: 0.5 }).id, "test");
  assert.equal(creditPlan({ pack: "value", credits: 100 }).id, "pack_value");
  assert.equal(creditPlan({ pack: "value" }).id, "pack_unknown");
});

test("owner summary counts the free offer, plans, earnings and hides private fields", () => {
  const owner = buildOwner({
    now,
    accounts: [
      { id: "a1", free_credits_remaining: 5, credit_balance: 0, credits_expire_at: iso(20), created_at: iso(-1), created_ip_hash: "iphash-should-not-leak" },
      { id: "a2", free_credits_remaining: 2, credit_balance: 0, credits_expire_at: iso(10), created_at: iso(-2) },
      { id: "a3", free_credits_remaining: 0, credit_balance: 0, credits_expire_at: iso(5), created_at: iso(-3) },
      { id: "a4", free_credits_remaining: 0, credit_balance: 0, credits_expire_at: iso(-2), created_at: iso(-40) },
      { id: "a5", free_credits_remaining: 3, credit_balance: 0, credits_expire_at: iso(-1) },
      { id: "a6", free_credits_remaining: 0, credit_balance: 99999, credits_expire_at: "2099-01-01T00:00:00.000Z" },
      { id: "a7", free_credits_remaining: 5, credit_balance: 30, credits_expire_at: iso(10) },
      { id: "a8", free_credits_remaining: 5, credit_balance: 0, credits_expire_at: null },
    ],
    licences: [
      { google_sub: "BASICSUB-SECRET-111", email: "owner@example.com", plan: 1, status: "active" },
      { google_sub: "PREMIUMSUB-SECRET-222", email: "premium@example.com", plan: 2, status: "active" },
      { google_sub: "LEGACYSUB-SECRET-444", email: "legacy@example.com", plan: 1, status: "active" },
    ],
    payments: [
      { google_sub: "BASICSUB-SECRET-111", product: "one", amount_aud: 79, status: "paid", created_at: iso(-1) },
      { google_sub: "BASICSUB-SECRET-111", product: "upgrade", amount_aud: 29, status: "paid", created_at: iso(-2) },
      { google_sub: "PREMIUMSUB-SECRET-222", product: "tracker_full", amount_aud: 149, status: "paid", created_at: iso(-36) },
      { google_sub: "PREMIUMSUB-SECRET-222", product: "one", amount_aud: 79, status: "paid", created_at: iso(-60) },
      { google_sub: "REFUNDSUB-SECRET-333", product: "one", amount_aud: 79, status: "refunded", created_at: iso(-5) },
    ],
    purchases: [
      { account_id: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee", pack: "value", credits: 99999, amount_aud: 79, purchased_at: iso(0) },
      { account_id: "bbbbbbbb-bbbb-cccc-dddd-eeeeeeeeeeee", pack: "casual", credits: 1, amount_aud: 0.5, purchased_at: iso(0) },
      { account_id: "cccccccc-bbbb-cccc-dddd-eeeeeeeeeeee", pack: "casual", credits: 10, amount_aud: 7.99, purchased_at: iso(-17) },
    ],
    sms: [
      { google_sub: "PREMIUMSUB-SECRET-222", status: "active", cancel_at_period_end: true },
      { google_sub: "OTHERSUB-SECRET-555", status: "canceled" },
    ],
    signups: [
      { utm_source: "reel", created_at: iso(-1) },
      { referrer_host: "direct.example", created_at: iso(-40) },
    ],
  });

  assert.equal(owner.freeOffer.onOfferNow, 2);
  assert.equal(owner.freeOffer.allFiveLeft, 1);
  assert.equal(owner.freeOffer.someUsed, 1);
  assert.equal(owner.freeOffer.windowOpenNoneLeft, 1);
  assert.equal(owner.freeOffer.expiredUnpaid, 1);
  assert.equal(owner.freeOffer.expiredCreditsLeft, 1);
  assert.equal(owner.freeOffer.lifetime, 1);
  assert.equal(owner.freeOffer.paidCredits, 1);
  assert.equal(owner.freeOffer.noWindow, 1);
  assert.equal(owner.freeOffer.newAccounts7, 3);
  assert.equal(owner.freeOffer.newAccounts30, 3);

  const holders = Object.fromEntries(owner.members.holders.map((h) => [h.id, h.count]));
  assert.deepEqual(holders, { premium: 1, basic_second: 1, basic: 1, basic_device: 1, credit_pack: 1 });
  assert.equal(owner.members.paid, 5);
  assert.equal(owner.members.attach.basicGoogle, 1);
  assert.equal(owner.members.attach.basicWithSecondDevice, 1);
  assert.equal(owner.members.attach.trackerHolders, 1);
  assert.equal(owner.members.attach.trackerWithSms, 1);
  assert.equal(owner.members.sms.active, 1);
  assert.equal(owner.members.sms.canceling, 1);
  assert.equal(owner.members.sms.ended, 1);

  assert.equal(owner.earnings.recordedAud, 422.99);
  assert.equal(owner.earnings.d7Aud, 187);
  assert.equal(owner.earnings.d30Aud, 194.99);
  assert.equal(owner.earnings.refundedCount, 1);
  assert.equal(owner.earnings.testExcluded, 1);
  assert.equal(owner.signups.total, 2);
  assert.equal(owner.signups.d7, 1);
  assert.equal(owner.funnel.paid, 5);
  assert.equal(owner.funnel.onFreeOffer, 2);

  const dumped = JSON.stringify(owner);
  for (const secret of ["owner@example.com", "premium@example.com", "legacy@example.com", "BASICSUB-SECRET-111", "PREMIUMSUB-SECRET-222", "iphash-should-not-leak", "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee"]) {
    assert.equal(dumped.includes(secret), false, secret);
  }
  assert.match(dumped, /o\*\*\*\*@e\*\*\*\.com/);
  assert.match(dumped, /device aaaaaaaa/);
});

test("missing tables stay null instead of looking like zero", () => {
  const owner = buildOwner({ now, accounts: null, payments: null, purchases: null, signups: null, sms: null });
  assert.equal(owner.freeOffer.unavailable, true);
  assert.equal(owner.freeOffer.onOfferNow, null);
  assert.equal(owner.earnings.recordedAud, null);
  assert.equal(owner.members.sms.unavailable, true);
  assert.equal(owner.signups.unavailable, true);
});

test("composeOwner adds visitor-days and Stripe without inventing abandoned checkouts", () => {
  const base = buildOwner({ now, accounts: [], payments: [], purchases: [], signups: [], sms: [] });
  const owner = composeOwner(base, {
    visits: {
      today: { visits: 4, unique: 3 },
      d7: { visits: 10, unique: 8 },
      d30: { visits: 20, unique: 15 },
      newReturning: { today: { new: 2, returning: 1 }, d7: { new: 5, returning: 3 } },
    },
    stripe: { since: "2026-10-01T00:00:00.000Z", grossAud: 149, netAud: 140, feesAud: 9, failedPayments: 2, trend: [{ revenue: 10 }, { revenue: 5 }] },
  });
  assert.equal(owner.visitors.todayUnique, 3);
  assert.equal(owner.visitors.d30UniqueVisitorDays, 15);
  assert.match(owner.visitors.definition, /not stored/);
  assert.equal(owner.funnel.visitors30, 15);
  assert.equal(owner.earnings.stripe.grossAud, 149);
  assert.equal(owner.earnings.stripe.d7Aud, 15);
  assert.equal(owner.checkouts.failedCharges, 2);
  assert.equal(owner.checkouts.abandonedSessions, null);
  const missing = composeOwner(base, {});
  assert.equal(missing.visitors, null);
  assert.match(missing.notes.join(" "), /VISIT_SALT/);
  assert.match(missing.notes.join(" "), /STRIPE_SECRET_KEY/);
});

test("dashboardStats fixture does not return raw emails or the ip hash", async () => {
  const file = path.join(os.tmpdir(), `sf-owner-${process.pid}.json`);
  fs.writeFileSync(file, JSON.stringify({
    licences: [{ google_sub: "BASICSUB-SECRET-111", email: "owner@example.com", plan: 1, status: "active", purchased_at: iso(-1) }],
    licence_payments: [{ google_sub: "BASICSUB-SECRET-111", product: "one", amount_aud: 79, status: "paid", created_at: iso(-1) }],
    signup_attribution: [{ utm_source: "reel", created_at: iso(-1) }],
    accounts: [{ id: "a1", free_credits_remaining: 5, credit_balance: 0, credits_expire_at: iso(10), created_at: iso(-1), created_ip_hash: "iphash-should-not-leak" }],
    credit_purchases: [],
    tracker_sms_subscriptions: [],
  }));
  const prev = process.env.STATS_FIXTURE;
  process.env.STATS_FIXTURE = file;
  try {
    const stats = await dashboardStats({ days: 30 });
    const dumped = JSON.stringify(stats);
    assert.equal(dumped.includes("owner@example.com"), false);
    assert.equal(dumped.includes("iphash-should-not-leak"), false);
    assert.equal(dumped.includes("BASICSUB-SECRET-111"), false);
    assert.equal(stats.owner.freeOffer.onOfferNow, 1);
    assert.equal(stats.owner.members.holders.find((h) => h.id === "basic").count, 1);
    assert.equal(stats.sales.revenueAud, 79);
  } finally {
    if (prev == null) delete process.env.STATS_FIXTURE; else process.env.STATS_FIXTURE = prev;
    fs.unlinkSync(file);
  }
});
