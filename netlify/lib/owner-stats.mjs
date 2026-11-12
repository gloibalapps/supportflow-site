// Owner-dashboard aggregates. Pure: callers pass rows already loaded from
// Supabase, Stripe, or a fixture. Output never includes raw emails, IP hashes,
// phone numbers, Stripe secrets, or NDIS participant records.
//
// "Members" are SupportFlow customers (a purchase or an active licence).
// The free offer is 5 invoice credits for 30 days from first open
// (accounts.free_credits_remaining). It is not an AI token balance.

const DAY = 86400000;

function maskEmail(e) {
  if (!e || !String(e).includes("@")) return null;
  const [u, d] = String(e).split("@");
  const dn = d.split(".");
  return `${u[0]}${"*".repeat(Math.max(2, Math.min(u.length - 1, 6)))}@${dn[0][0]}***.${dn.slice(1).join(".")}`;
}

const money = (n) => +Number(n || 0).toFixed(2);
const inLast = (iso, days, now) => {
  const t = Date.parse(iso || "");
  return Number.isFinite(t) && t >= now - days * DAY && t <= now + 60000;
};
const shortId = (id, prefix) => {
  const s = String(id || "");
  return s.length >= 12 ? `${prefix} ${s.slice(0, 8)}` : prefix;
};

export function isLifetimeBalance(balance, expiresAt) {
  const b = Number(balance) || 0;
  if (b >= 99999) return true;
  const exp = expiresAt ? new Date(expiresAt) : null;
  return b >= 90000 && !!exp && !Number.isNaN(exp.getTime()) && exp.getUTCFullYear() >= 2090;
}

export function isTestPurchase(row) {
  return Number(row?.credits) === 1 && Number(row?.amount_aud) < 2;
}

const PAYMENT_PLANS = {
  one: ["basic", "Basic"],
  two: ["two_device", "Two-device licence"],
  upgrade: ["second_device", "Second device"],
  tracker_full: ["premium", "Premium"],
  tracker_base: ["tracker", "Payment tracker"],
  tracker_two: ["tracker_two", "Payment tracker, two computers"],
  tracker_addon: ["tracker_second", "Second computer"],
  tracker_sms: ["sms", "SMS alerts"],
};

export function paymentPlan(product) {
  const hit = PAYMENT_PLANS[product];
  if (hit) return { id: hit[0], label: hit[1] };
  return { id: "other", label: product ? `Other (${product})` : "Other" };
}

export function creditPlan(row) {
  if (row?.credits == null || row?.credits === "") return { id: "pack_unknown", label: "Credit pack (credits column missing)" };
  const credits = Number(row.credits);
  if (credits >= 90000) return { id: "basic_device", label: "Basic (device checkout)" };
  if (isTestPurchase(row)) return { id: "test", label: "Test checkout" };
  if (row?.pack === "casual") return { id: "pack_casual", label: "Credit pack (10)" };
  if (row?.pack === "popular") return { id: "pack_popular", label: "Credit pack (30)" };
  if (row?.pack === "value") return { id: "pack_value", label: "Credit pack (100)" };
  if (!Number.isFinite(credits)) return { id: "pack_unknown", label: "Credit pack (credits column missing)" };
  return { id: "pack_other", label: "Credit pack" };
}

// One current plan per Google account. Purchase rows stay in the product totals.
export function primaryPlan(products, licence) {
  const has = (p) => products.has(p);
  if (has("tracker_full")) return { id: "premium", label: "Premium" };
  if (has("tracker_two") || (has("tracker_base") && has("tracker_addon"))) return { id: "tracker_two", label: "Payment tracker, two computers" };
  if (has("tracker_base")) return { id: "tracker", label: "Payment tracker" };
  if (has("two")) return { id: "two_device", label: "Two-device licence" };
  if (has("one") && has("upgrade")) return { id: "basic_second", label: "Basic + second device" };
  if (has("one")) return { id: "basic", label: "Basic" };
  if (has("upgrade") || has("tracker_addon")) return { id: "second_only", label: "Second device only" };
  if (licence?.status === "active" && +licence.plan === 2) return { id: "two_device", label: "Two-device licence" };
  if (licence?.status === "active" && +licence.plan === 1) return { id: "basic", label: "Basic" };
  return null;
}

function classifyAccount(row, now) {
  const balance = Number(row.credit_balance) || 0;
  const free = Number(row.free_credits_remaining) || 0;
  const exp = Date.parse(row.credits_expire_at || "");
  const open = Number.isFinite(exp) && exp > now;
  if (isLifetimeBalance(balance, row.credits_expire_at)) return "lifetime";
  if (balance > 0) return "paid_credits";
  if (!Number.isFinite(exp)) return "no_window";
  if (open && free >= 5) return "free_full";
  if (open && free > 0) return "free_partial";
  if (open) return "free_none_left";
  if (free > 0) return "expired_credits_left";
  return "expired_unpaid";
}

function lineAdd(map, plan, amount, at, now) {
  const cur = map.get(plan.id) || { id: plan.id, label: plan.label, count: 0, revenueAud: 0, d7: 0, d30: 0, revenue7Aud: 0, revenue30Aud: 0 };
  cur.count += 1;
  cur.revenueAud = money(cur.revenueAud + amount);
  if (inLast(at, 7, now)) { cur.d7 += 1; cur.revenue7Aud = money(cur.revenue7Aud + amount); }
  if (inLast(at, 30, now)) { cur.d30 += 1; cur.revenue30Aud = money(cur.revenue30Aud + amount); }
  map.set(plan.id, cur);
}

const HOLDER_ORDER = ["premium", "basic", "basic_second", "basic_device", "tracker", "tracker_two", "two_device", "second_only", "credit_pack", "other"];

function holderRows(counts) {
  const ids = [...new Set([...HOLDER_ORDER, ...Object.keys(counts)])];
  return ids.filter((id) => counts[id]?.count).map((id) => counts[id]);
}

function windowCount(rows, field, days, now) {
  const dated = (rows || []).filter((r) => Number.isFinite(Date.parse(r[field] || "")));
  if (!dated.length) return null;
  return dated.filter((r) => inLast(r[field], days, now)).length;
}

export function visitorHeadline(visits) {
  if (!visits?.today || !visits?.d7 || !visits?.d30) return null;
  return {
    todayUnique: visits.today.unique,
    todayVisits: visits.today.visits,
    d7UniqueVisitorDays: visits.d7.unique,
    d7Visits: visits.d7.visits,
    d30UniqueVisitorDays: visits.d30.unique,
    d30Visits: visits.d30.visits,
    newToday: visits.newReturning?.today?.new ?? null,
    returningToday: visits.newReturning?.today?.returning ?? null,
    new7: visits.newReturning?.d7?.new ?? null,
    returning7: visits.newReturning?.d7?.returning ?? null,
    sinceLaunch: visits.newReturning?.sinceLaunch || null,
    definition: "Unique today is distinct visitors that Adelaide day. The hash is a salted SHA-256 of the salt, the date, the IP and the browser, and it changes every day, so 7- and 30-day figures are visitor-days, not one person across the window. Raw IP addresses are not stored or shown.",
  };
}

export function stripeHeadline(stripe) {
  if (!stripe || stripe.error) return null;
  const trend = Array.isArray(stripe.trend) ? stripe.trend : [];
  const sum = (rows) => money(rows.reduce((s, t) => s + Number(t.revenue || 0), 0));
  return {
    since: stripe.since || null,
    grossAud: stripe.grossAud ?? null,
    netAud: stripe.netAud ?? null,
    feesAud: stripe.feesAud ?? null,
    netBasis: stripe.netBasis || null,
    refundsAud: stripe.refundsAud ?? null,
    disputes: stripe.disputes ?? null,
    failedCharges: stripe.failedPayments ?? null,
    successfulPayments: stripe.successfulPayments ?? null,
    d7Aud: sum(trend.slice(-7)),
    d30Aud: sum(trend),
    windowBasis: "Stripe daily figures are net of refunds.",
    balance: stripe.balance || null,
  };
}

export function buildOwner({
  accounts = null,
  payments = null,
  purchases = null,
  licences = null,
  signups = null,
  sms = null,
  now = Date.now(),
  cap = 10000,
} = {}) {
  const notes = [];
  const capped = (rows) => Array.isArray(rows) && rows.length >= cap;
  if (capped(accounts) || capped(payments) || capped(purchases) || capped(signups)) {
    notes.push("A table hit the 10,000 row read cap, so these totals can be short of the full history.");
  }

  const free = {
    definition: "5 free invoice credits, valid 30 days from first open (accounts.free_credits_remaining). One credit is used the first time a new invoice is previewed. This is not an AI token balance. Paid balances are not counted as being on the offer.",
    unavailable: !Array.isArray(accounts),
    onOfferNow: null,
    allFiveLeft: null,
    someUsed: null,
    windowOpenNoneLeft: null,
    expiredUnpaid: null,
    expiredCreditsLeft: null,
    noWindow: null,
    lifetime: null,
    paidCredits: null,
    newAccounts7: null,
    newAccounts30: null,
  };
  if (Array.isArray(accounts)) {
    const counts = { free_full: 0, free_partial: 0, free_none_left: 0, expired_unpaid: 0, expired_credits_left: 0, no_window: 0, lifetime: 0, paid_credits: 0 };
    for (const row of accounts) counts[classifyAccount(row, now)]++;
    free.onOfferNow = counts.free_full + counts.free_partial;
    free.allFiveLeft = counts.free_full;
    free.someUsed = counts.free_partial;
    free.windowOpenNoneLeft = counts.free_none_left;
    free.expiredUnpaid = counts.expired_unpaid;
    free.expiredCreditsLeft = counts.expired_credits_left;
    free.noWindow = counts.no_window;
    free.lifetime = counts.lifetime;
    free.paidCredits = counts.paid_credits;
    free.newAccounts7 = windowCount(accounts, "created_at", 7, now);
    free.newAccounts30 = windowCount(accounts, "created_at", 30, now);
    if (free.newAccounts7 === null) notes.push("New-account windows need accounts.created_at (FREE-OFFER-MIGRATION.sql). Who is on the 5 free invoices is still counted.");
    if (free.windowOpenNoneLeft) notes.push("Accounts with an open 30-day window and no starter credits left include people who used all 5 and devices that were not granted the 5 (the per-IP cap). Those two cannot be told apart.");
  } else {
    notes.push("Free-offer counts need the accounts table (SUPABASE_URL, SUPABASE_SERVICE_KEY, and CREDIT-PACKS-MIGRATION.sql).");
  }

  const emailBySub = new Map((licences || []).filter((l) => l.google_sub).map((l) => [l.google_sub, l.email]));
  const paidBySub = new Map();
  const lines = new Map();
  const recent = [];
  let recordedAud = 0, d7Aud = 0, d30Aud = 0, refundedCount = 0, refundedAud = 0, disputedCount = 0, testExcluded = 0;
  let missingCredits = 0;

  for (const p of payments || []) {
    const status = String(p.status || "").toLowerCase();
    const amount = money(p.amount_aud);
    const plan = paymentPlan(p.product);
    const at = p.created_at || null;
    if (status === "paid") {
      if (p.google_sub) {
        if (!paidBySub.has(p.google_sub)) paidBySub.set(p.google_sub, new Set());
        paidBySub.get(p.google_sub).add(p.product);
      }
      recordedAud = money(recordedAud + amount);
      if (inLast(at, 7, now)) d7Aud = money(d7Aud + amount);
      if (inLast(at, 30, now)) d30Aud = money(d30Aud + amount);
      lineAdd(lines, plan, amount, at, now);
    } else if (status === "refunded") {
      refundedCount += 1;
      refundedAud = money(refundedAud + amount);
    } else if (status === "disputed") disputedCount += 1;
    if (at) recent.push({ at, plan: plan.label, amountAud: amount, status: status || "paid", who: maskEmail(emailBySub.get(p.google_sub)) || shortId(p.google_sub, "member") });
  }

  const devicePlans = new Map();
  for (const p of purchases || []) {
    if (p.credits == null || p.credits === "") missingCredits += 1;
    const plan = creditPlan(p);
    const amount = money(p.amount_aud);
    const at = p.purchased_at || p.created_at || null;
    if (plan.id === "test") {
      testExcluded += 1;
      if (at) recent.push({ at, plan: plan.label, amountAud: amount, status: "test", who: shortId(p.account_id, "device") });
      continue;
    }
    recordedAud = money(recordedAud + amount);
    if (inLast(at, 7, now)) d7Aud = money(d7Aud + amount);
    if (inLast(at, 30, now)) d30Aud = money(d30Aud + amount);
    lineAdd(lines, plan, amount, at, now);
    if (p.account_id) {
      const cur = devicePlans.get(p.account_id) || new Set();
      cur.add(plan.id);
      devicePlans.set(p.account_id, cur);
    }
    if (at) recent.push({ at, plan: plan.label, amountAud: amount, status: "paid", who: shortId(p.account_id, "device") });
  }
  if (missingCredits) notes.push("Some credit_purchases rows have no credits value, so a Basic lifetime (99999 credits, stored as pack value) cannot be separated from a 100-credit pack. CREDIT-PACKS-MIGRATION.sql adds that column.");
  if (!Array.isArray(payments)) notes.push("Licence and tracker purchases need licence_payments (SUPABASE_URL and SUPABASE_SERVICE_KEY).");
  if (!Array.isArray(purchases)) notes.push("Device checkouts need credit_purchases (SUPABASE_URL and SUPABASE_SERVICE_KEY).");
  const purchasesKnown = Array.isArray(payments) || Array.isArray(purchases);

  const holderCounts = {};
  const bump = (plan) => {
    const cur = holderCounts[plan.id] || { id: plan.id, label: plan.label, count: 0 };
    cur.count += 1;
    holderCounts[plan.id] = cur;
  };
  const licBySub = new Map((licences || []).filter((l) => l.google_sub).map((l) => [l.google_sub, l]));
  const subs = new Set([...paidBySub.keys(), ...licBySub.keys()]);
  let basicGoogle = 0, basicWithSecond = 0, trackerHolders = 0;
  for (const sub of subs) {
    const products = paidBySub.get(sub) || new Set();
    const plan = primaryPlan(products, licBySub.get(sub));
    if (plan) bump(plan);
    if (products.has("one") && !products.has("tracker_full")) {
      basicGoogle += 1;
      if (products.has("upgrade")) basicWithSecond += 1;
    }
    if (["tracker_base", "tracker_two", "tracker_full", "tracker_addon"].some((p) => products.has(p))) trackerHolders += 1;
  }
  let deviceBasic = 0, devicePacks = 0;
  for (const ids of devicePlans.values()) {
    if (ids.has("basic_device")) deviceBasic += 1;
    else devicePacks += 1;
  }
  if (deviceBasic) bump({ id: "basic_device", label: "Basic (device checkout)" });
  if (devicePacks) bump({ id: "credit_pack", label: "Credit pack only" });

  const smsSummary = {
    unavailable: !Array.isArray(sms),
    active: null,
    pastDue: null,
    canceling: null,
    ended: null,
    other: null,
    note: "SMS is the A$4.99 monthly pack (tracker_sms_subscriptions). The table stores status, not the dollars charged. Active means Stripe status active or trialing.",
  };
  const smsActiveSubs = new Set();
  if (Array.isArray(sms)) {
    smsSummary.active = 0; smsSummary.pastDue = 0; smsSummary.canceling = 0; smsSummary.ended = 0; smsSummary.other = 0;
    for (const row of sms) {
      const status = String(row.status || "").toLowerCase();
      if (status === "active" || status === "trialing") {
        smsSummary.active += 1;
        if (row.cancel_at_period_end) smsSummary.canceling += 1;
        if (row.google_sub) smsActiveSubs.add(row.google_sub);
      } else if (status === "past_due") smsSummary.pastDue += 1;
      else if (["canceled", "cancelled", "unpaid", "incomplete_expired", "incomplete"].includes(status)) smsSummary.ended += 1;
      else smsSummary.other += 1;
    }
  } else {
    notes.push("SMS counts need tracker_sms_subscriptions (TRACKER-MIGRATION.sql).");
  }
  let trackerWithSms = 0;
  for (const sub of smsActiveSubs) {
    const products = paidBySub.get(sub);
    if (products && ["tracker_base", "tracker_two", "tracker_full", "tracker_addon"].some((p) => products.has(p))) trackerWithSms += 1;
  }

  const signupRows = Array.isArray(signups) ? signups : null;
  const bySource = {};
  for (const s of signupRows || []) {
    const key = s.utm_source || s.ref_code || s.referrer_host || "direct";
    bySource[key] = (bySource[key] || 0) + 1;
  }
  const signupSummary = {
    unavailable: !signupRows,
    total: signupRows ? signupRows.length : null,
    d7: signupRows ? windowCount(signupRows, "created_at", 7, now) : null,
    d30: signupRows ? windowCount(signupRows, "created_at", 30, now) : null,
    bySource: Object.entries(bySource).sort((a, b) => b[1] - a[1]).slice(0, 8),
  };
  if (!signupRows) notes.push("App first-opens need signup_attribution (SUPABASE_URL and SUPABASE_SERVICE_KEY).");

  const paid = Object.values(holderCounts).reduce((s, h) => s + h.count, 0);
  recent.sort((a, b) => String(b.at).localeCompare(String(a.at)));

  return {
    windowNote: "Purchase, signup and new-account windows are rolling 7 and 30 days from now (UTC). Website visitors use Australia/Adelaide days.",
    notes,
    freeOffer: free,
    members: {
      paid,
      overlapNote: "A Google-account licence and a device checkout are different ids, so one person who bought both ways is counted twice. Basic on a device checkout is a lifetime credit balance (99999), stored as credit pack value.",
      holders: holderRows(holderCounts),
      purchases: [...lines.values()].sort((a, b) => b.revenueAud - a.revenueAud || b.count - a.count),
      sms: smsSummary,
      attach: {
        basicGoogle,
        basicWithSecondDevice: basicWithSecond,
        secondDeviceRate: basicGoogle ? basicWithSecond / basicGoogle : null,
        trackerHolders,
        trackerWithSms,
        smsRate: trackerHolders ? trackerWithSms / trackerHolders : null,
        note: "Second-device rate is Google-account Basic purchases (product one, excluding Premium) that also have the upgrade product. SMS rate is active SMS subscriptions among Payment tracker or Premium holders.",
      },
    },
    earnings: {
      recordedAud: purchasesKnown ? recordedAud : null,
      d7Aud: purchasesKnown ? d7Aud : null,
      d30Aud: purchasesKnown ? d30Aud : null,
      refundedCount,
      refundedAud,
      disputedCount,
      testExcluded,
      byProduct: [...lines.values()].sort((a, b) => b.revenueAud - a.revenueAud || b.count - a.count),
      smsOmitted: "SMS subscription dollars are not stored. They are inside the Stripe gross total when STRIPE_SECRET_KEY is set, and absent from the recorded one-off total.",
      stripe: null,
    },
    signups: signupSummary,
    funnel: {
      note: "These are separate counts. A website visitor is not linked to an app account or a purchase, so this is not a conversion of the same person.",
      visitors30: null,
      firstOpens: signupSummary.total,
      firstOpens7: signupSummary.d7,
      firstOpens30: signupSummary.d30,
      onFreeOffer: free.onOfferNow,
      paid,
    },
    recent: recent.slice(0, 20),
    checkouts: {
      failedCharges: null,
      failedSince: null,
      abandonedSessions: null,
      note: "Abandoned Checkout sessions are not stored. Failed card charges are counted from Stripe when STRIPE_SECRET_KEY is set.",
    },
    caps: {
      accounts: capped(accounts),
      payments: capped(payments),
      purchases: capped(purchases),
      signups: capped(signups),
    },
  };
}

export function composeOwner(owner, { visits = null, stripe = null, stripeError = null } = {}) {
  if (!owner) return null;
  const notes = [...(owner.notes || [])];
  const visitors = visitorHeadline(visits);
  const stripeSum = stripeHeadline(stripe);
  if (!visitors) notes.push("Unique visitors need VISIT_SALT, SUPABASE_URL, SUPABASE_SERVICE_KEY, and the site_visits table (SITE-VISITS-MIGRATION.sql). The counter stores no raw IP.");
  if (!stripeSum) notes.push(stripeError ? `Stripe totals are unavailable (${stripeError}). Recorded one-off amounts are still shown.` : "Stripe totals need STRIPE_SECRET_KEY. Recorded one-off amounts are still shown.");
  return {
    ...owner,
    notes,
    visitors,
    earnings: { ...owner.earnings, stripe: stripeSum },
    funnel: { ...owner.funnel, visitors30: visitors ? visitors.d30UniqueVisitorDays : null },
    checkouts: {
      ...owner.checkouts,
      failedCharges: stripeSum ? stripeSum.failedCharges : null,
      failedSince: stripeSum?.since || null,
    },
  };
}
