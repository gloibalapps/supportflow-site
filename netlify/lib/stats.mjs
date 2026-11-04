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
  const lic = await rows("licences", "status");
  const sig = await rows("signup_attribution", "device_ref");
  const min = Number(process.env.PUBLIC_STATS_MIN || 0);
  const show = (n) => (Number.isFinite(n) && n >= min ? n : null);
  return {
    licencesSold: lic ? show(lic.filter((l) => l.status === "active").length) : null,
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
