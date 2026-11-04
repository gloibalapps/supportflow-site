// Aggregate stats for the public homepage counter and the private owner
// dashboard. Server-only. Reads Supabase with the service key (never returned).
//
// Data sources (all real):
//   licences            -> licences sold / active / per plan
//   licence_payments    -> sales count, revenue (A$), daily trend, recent activity
//   signup_attribution  -> app first-opens ("installs") and sign-ups by source
//
// Local development: set STATS_FIXTURE=/path/to/backup.json (same shape as
// backup-licences-*.json) to read a snapshot instead of Supabase.
import fs from "node:fs";

const DAY = 86400000;

export function statsConfigured() {
  return !!(process.env.STATS_FIXTURE || (process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_KEY));
}

async function rows(table, select) {
  if (process.env.STATS_FIXTURE) {
    const snap = JSON.parse(fs.readFileSync(process.env.STATS_FIXTURE, "utf8"));
    return Array.isArray(snap[table]) ? snap[table] : null; // null = table not in snapshot
  }
  const k = process.env.SUPABASE_SERVICE_KEY;
  const r = await fetch(`${process.env.SUPABASE_URL}/rest/v1/${table}?select=${select}&limit=10000`, {
    headers: { apikey: k, Authorization: `Bearer ${k}` },
  });
  if (!r.ok) return null; // missing table / no access -> panel shows "unavailable"
  return r.json();
}

export function maskEmail(e) {
  if (!e || !String(e).includes("@")) return null;
  const [u, d] = String(e).split("@");
  const dn = d.split(".");
  return `${u[0]}${"*".repeat(Math.max(2, Math.min(u.length - 1, 6)))}@${dn[0][0]}***.${dn.slice(1).join(".")}`;
}

/** Public, aggregate-only numbers. No personal data. */
export async function publicStats() {
  // Licences sold = paid, non-refunded Stripe licence charges since
  // STRIPE_STATS_SINCE; falls back to active Supabase licences.
  let stripeSold = null;
  if (stripeConfigured()) {
    try { stripeSold = (await stripeStats({ days: 7 })).licenceSales.count; } catch { stripeSold = null; }
  }
  const lic = statsConfigured() ? await rows("licences", "status").catch(() => null) : null;
  const sig = statsConfigured() ? await rows("signup_attribution", "device_ref").catch(() => null) : null;
  const min = Number(process.env.PUBLIC_STATS_MIN || 0);
  const show = (n) => (Number.isFinite(n) && n >= min ? n : null);
  return {
    licencesSold: stripeSold !== null ? show(stripeSold) : lic ? show(lic.filter((l) => l.status === "active").length) : null,
    licencesSoldSource: stripeSold !== null ? "stripe" : lic ? "supabase" : null,
    appOpens: sig ? show(sig.length) : null,
    // Config-driven: set LAUNCH_DATE (ISO, e.g. 2026-10-11) to show the live timer.
    launchDate: process.env.LAUNCH_DATE || null,
    generatedAt: new Date().toISOString(),
  };
}

/** Private owner dashboard data. Emails are masked before leaving the server. */
export async function dashboardStats({ days = 30 } = {}) {
  const [lic, pay, sig] = await Promise.all([
    rows("licences", "google_sub,email,plan,status,purchased_at,created_at"),
    rows("licence_payments", "google_sub,product,amount_aud,status,created_at"),
    rows("signup_attribution", "utm_source,ref_code,referrer_host,created_at"),
  ]);
  const out = { generatedAt: new Date().toISOString(), source: process.env.STATS_FIXTURE ? "fixture" : "supabase" };

  if (lic) {
    const active = lic.filter((l) => l.status === "active");
    out.licences = {
      total: lic.length, active: active.length, revoked: lic.length - active.length,
      plan1: active.filter((l) => +l.plan === 1).length, plan2: active.filter((l) => +l.plan === 2).length,
    };
  }
  if (pay) {
    const paid = pay.filter((p) => p.status === "paid");
    out.sales = {
      count: paid.length,
      revenueAud: +paid.reduce((s, p) => s + Number(p.amount_aud || 0), 0).toFixed(2),
      refunded: pay.filter((p) => p.status === "refunded").length,
      disputed: pay.filter((p) => p.status === "disputed").length,
      byProduct: paid.reduce((m, p) => ((m[p.product] = (m[p.product] || 0) + 1), m), {}),
    };
  }
  // Daily trend: paid payments if any, else licence purchase dates.
  const today = new Date(new Date().toISOString().slice(0, 10)).getTime();
  const trend = [];
  for (let i = days - 1; i >= 0; i--) trend.push({ day: new Date(today - i * DAY).toISOString().slice(0, 10), sales: 0, revenue: 0, opens: 0 });
  const idx = Object.fromEntries(trend.map((t, i) => [t.day, i]));
  for (const p of (pay || []).filter((p) => p.status === "paid")) {
    const i = idx[String(p.created_at).slice(0, 10)];
    if (i !== undefined) { trend[i].sales++; trend[i].revenue += Number(p.amount_aud || 0); }
  }
  if (!(pay && pay.length) && lic) {
    out.trendBasis = "licence purchased_at (no licence_payments rows)";
    for (const l of lic.filter((l) => l.status === "active")) {
      const i = idx[String(l.purchased_at || l.created_at).slice(0, 10)];
      if (i !== undefined) trend[i].sales++;
    }
  } else out.trendBasis = "licence_payments (paid)";
  for (const s of sig || []) { const i = idx[String(s.created_at).slice(0, 10)]; if (i !== undefined) trend[i].opens++; }
  out.trend = trend;

  const emailBySub = Object.fromEntries((lic || []).map((l) => [l.google_sub, l.email]));
  const act = [
    ...(pay || []).map((p) => ({ at: p.created_at, kind: `payment ${p.status}`, detail: `${p.product} A$${Number(p.amount_aud).toFixed(0)}`, who: maskEmail(emailBySub[p.google_sub]) })),
    ...(lic || []).map((l) => ({ at: l.purchased_at || l.created_at, kind: `licence ${l.status}`, detail: `plan ${l.plan}`, who: maskEmail(l.email) })),
  ].filter((a) => a.at).sort((a, b) => String(b.at).localeCompare(String(a.at))).slice(0, 15);
  out.activity = act;

  if (sig) {
    const by = {};
    for (const s of sig) { const k = s.utm_source || s.ref_code || s.referrer_host || "direct"; by[k] = (by[k] || 0) + 1; }
    out.signups = { total: sig.length, bySource: Object.entries(by).sort((a, b) => b[1] - a[1]).slice(0, 10) };
  }
  return out;
}

/* ---------------- Stripe (read-only GETs) ----------------
   Uses STRIPE_SECRET_KEY (same var as create-checkout / webhook). Only GET
   requests are made. The Stripe account predates SupportFlow, so charges are
   limited to those created on/after STRIPE_STATS_SINCE (else LAUNCH_DATE,
   else the last 90 days). Local dev: STRIPE_FIXTURE=/path/to/json. */
export function stripeConfigured() {
  return !!(process.env.STRIPE_FIXTURE || process.env.STRIPE_SECRET_KEY);
}
async function stripeGet(path, params = {}) {
  const qs = new URLSearchParams(params).toString();
  const r = await fetch(`https://api.stripe.com/v1/${path}${qs ? "?" + qs : ""}`, {
    headers: { Authorization: `Bearer ${process.env.STRIPE_SECRET_KEY}` },
  });
  if (!r.ok) throw new Error(`Stripe GET ${path} ${r.status}`);
  return r.json();
}
export async function stripeStats({ days = 30 } = {}) {
  const sinceIso = process.env.STRIPE_STATS_SINCE || process.env.LAUNCH_DATE || new Date(Date.now() - 90 * DAY).toISOString();
  const since = Math.floor(Date.parse(sinceIso) / 1000);
  let charges, payouts, balance, bts;
  if (process.env.STRIPE_FIXTURE) {
    const f = JSON.parse(fs.readFileSync(process.env.STRIPE_FIXTURE, "utf8"));
    charges = f.charges.filter((c) => c.created >= since); payouts = f.payouts; balance = f.balance;
    bts = (f.balance_transactions || []).filter((b) => b.created >= since);
  } else {
    charges = [];
    let after;
    for (let page = 0; page < 20; page++) {
      const p = { limit: 100, "created[gte]": since, "expand[]": "data.balance_transaction" };
      if (after) p.starting_after = after;
      const res = await stripeGet("charges", p);
      charges.push(...res.data);
      if (!res.has_more) break;
      after = res.data.at(-1).id;
    }
    bts = [];
    let bAfter;
    for (let page = 0; page < 20; page++) {
      const p = { limit: 100, "created[gte]": since };
      if (bAfter) p.starting_after = bAfter;
      const res = await stripeGet("balance_transactions", p);
      bts.push(...res.data);
      if (!res.has_more) break;
      bAfter = res.data.at(-1).id;
    }
    [payouts, balance] = await Promise.all([stripeGet("payouts", { limit: 5 }).then((r) => r.data), stripeGet("balance")]);
  }
  const ok = charges.filter((c) => c.status === "succeeded" && c.paid);
  const cents = (n) => +(n / 100).toFixed(2);
  const gross = ok.reduce((s, c) => s + c.amount, 0);
  const refunds = ok.reduce((s, c) => s + (c.amount_refunded || 0), 0);
  // Fees and net come from balance transactions (the ledger Stripe pays out
  // from): charge/refund fees plus standalone "stripe_fee" lines. Payouts and
  // transfers are excluded because they move money, not earn it.
  const ledger = (bts || []).filter((b) => b.currency === "aud" && !["payout", "transfer", "payout_cancel", "payout_failure"].includes(b.type));
  const fees = bts ? ledger.reduce((s, b) => s + (b.type === "stripe_fee" ? -b.net : b.fee), 0) : null;
  const ledgerNet = bts ? ledger.reduce((s, b) => s + b.net, 0) : null;
  const LICENCE_CENTS = [4900, 6900, 2900, 2000]; // $49 one device, $69 two, $29 upgrade (2000 = earlier $20 upgrade sales)
  const lic = ok.filter((c) => LICENCE_CENTS.includes(c.amount) && !c.amount_refunded);
  const today = new Date(new Date().toISOString().slice(0, 10)).getTime();
  const trend = [];
  for (let i = days - 1; i >= 0; i--) trend.push({ day: new Date(today - i * DAY).toISOString().slice(0, 10), revenue: 0, count: 0 });
  const idx = Object.fromEntries(trend.map((t, i) => [t.day, i]));
  for (const c of ok) {
    const i = idx[new Date(c.created * 1000).toISOString().slice(0, 10)];
    if (i !== undefined) { trend[i].revenue = cents(trend[i].revenue * 100 + c.amount - (c.amount_refunded || 0)); trend[i].count++; }
  }
  const sum = (arr) => cents((arr || []).filter((b) => b.currency === "aud").reduce((s, b) => s + b.amount, 0));
  return {
    since: new Date(since * 1000).toISOString(),
    currency: "aud",
    successfulPayments: ok.length,
    failedPayments: charges.filter((c) => c.status === "failed").length,
    grossAud: cents(gross),
    refundsAud: cents(refunds),
    refundedCount: ok.filter((c) => c.amount_refunded > 0).length,
    disputes: ok.filter((c) => c.disputed).length,
    feesAud: fees === null ? null : cents(fees),
    netAud: ledgerNet === null ? cents(gross - refunds) : cents(ledgerNet),
    netBasis: ledgerNet === null ? "gross − refunds (fees not loaded)" : "balance transactions: gross − refunds − all Stripe fees",
    licenceSales: { count: lic.length, grossAud: cents(lic.reduce((s, c) => s + c.amount, 0)) },
    otherCharges: ok.length - lic.length,
    trend,
    recent: charges.slice(0, 10).map((c) => ({
      at: new Date(c.created * 1000).toISOString(), amountAud: cents(c.amount), status: c.status,
      refundedAud: cents(c.amount_refunded || 0), disputed: !!c.disputed,
      who: maskEmail(c.billing_details?.email || c.receipt_email),
    })),
    payouts: (payouts || []).slice(0, 5).map((p) => ({ amountAud: cents(p.amount), status: p.status, arrival: new Date(p.arrival_date * 1000).toISOString().slice(0, 10) })),
    balance: { availableAud: sum(balance?.available), pendingAud: sum(balance?.pending) },
  };
}

/* ---------------- Website visits (site_visits) ---------------- */
export async function visitorStats({ days = 30 } = {}) {
  const since = new Date(Date.now() - (days - 1) * DAY).toISOString().slice(0, 10);
  let v;
  if (process.env.VISITS_FIXTURE) v = JSON.parse(fs.readFileSync(process.env.VISITS_FIXTURE, "utf8")).filter((r) => r.day >= since);
  else {
    if (!(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_KEY)) return null;
    const k = process.env.SUPABASE_SERVICE_KEY;
    v = [];
    for (let off = 0; off < 200000; off += 1000) {
      const r = await fetch(`${process.env.SUPABASE_URL}/rest/v1/site_visits?select=day,path,visitor_hash,referrer_host,utm_source,utm_campaign,country,region&day=gte.${since}&order=id`, {
        headers: { apikey: k, Authorization: `Bearer ${k}`, Range: `${off}-${off + 999}` },
      });
      if (!r.ok) return null; // table not created yet
      const page = await r.json(); v.push(...page);
      if (page.length < 1000) break;
    }
  }
  const today = new Date().toISOString().slice(0, 10);
  const d7 = new Date(Date.now() - 6 * DAY).toISOString().slice(0, 10);
  // visitor_hash is per-day, so "unique" = sum of daily uniques (visitor-days).
  const uniq = (rows) => new Set(rows.map((r) => r.day + r.visitor_hash)).size;
  const top = (rows, f, n = 8) => Object.entries(rows.reduce((m, r) => { const key = f(r); if (key) m[key] = (m[key] || 0) + 1; return m; }, {})).sort((a, b) => b[1] - a[1]).slice(0, n);
  const t = v.filter((r) => r.day === today), w = v.filter((r) => r.day >= d7);
  const trend = [];
  for (let i = days - 1; i >= 0; i--) { const day = new Date(Date.now() - i * DAY).toISOString().slice(0, 10); const rs = v.filter((r) => r.day === day); trend.push({ day, visits: rs.length, unique: uniq(rs) }); }
  return {
    today: { visits: t.length, unique: uniq(t) }, d7: { visits: w.length, unique: uniq(w) }, d30: { visits: v.length, unique: uniq(v) },
    topPages: top(v, (r) => r.path),
    topReferrers: top(v, (r) => r.referrer_host),
    topUtm: top(v, (r) => r.utm_source && [r.utm_source, r.utm_campaign].filter(Boolean).join(" / ")),
    countries: top(v, (r) => r.country && (r.region ? `${r.country}-${r.region}` : r.country), 10),
    trend,
  };
}
