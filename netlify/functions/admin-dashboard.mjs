// GET /.netlify/functions/admin-dashboard  (Authorization: Bearer <ADMIN_DASHBOARD_TOKEN>)
// Owner-only stats. Token checked server-side with a constant-time compare.
import crypto from "node:crypto";
import { dashboardStats, statsConfigured, stripeStats, stripeConfigured, visitorStats } from "../lib/stats.mjs";
import { composeOwner } from "../lib/owner-stats.mjs";

const J = (o, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { "Content-Type": "application/json", "Cache-Control": "no-store", "X-Robots-Tag": "noindex" } });

function safeErr(s) {
  return String(s || "").replace(/\b[sr]k_(?:live|test)_[A-Za-z0-9]+\b/g, "[redacted]").slice(0, 120);
}

function authorised(req) {
  const want = process.env.ADMIN_DASHBOARD_TOKEN || "";
  if (want.length < 16) return false; // refuse weak/unset tokens
  const got = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
  const a = crypto.createHash("sha256").update(got).digest(), b = crypto.createHash("sha256").update(want).digest();
  return crypto.timingSafeEqual(a, b);
}

export default async (req) => {
  if (req.method !== "GET") return J({ error: "method" }, 405);
  if (!authorised(req)) return J({ error: "unauthorised" }, 401);
  if (!statsConfigured() && !stripeConfigured()) return J({ error: "no stats source configured" }, 503);
  try {
    const days = Math.min(90, Math.max(7, Number(new URL(req.url).searchParams.get("days")) || 30));
    // Supabase and Stripe load independently; either failing leaves the other.
    const [base, stripe] = await Promise.all([
      statsConfigured() ? dashboardStats({ days }).catch(() => ({})) : {},
      stripeConfigured() ? stripeStats({ days }).catch((e) => ({ error: String(e.message || e).slice(0, 80) })) : null,
    ]);
    const visits = await visitorStats({ days }).catch(() => null);
    const stripeError = stripe?.error ? safeErr(stripe.error) : (stripe ? null : "STRIPE_SECRET_KEY not set");
    const stripeOk = stripe && !stripe.error ? stripe : null;
    const owner = composeOwner(base.owner, { visits, stripe: stripeOk, stripeError });
    return J({ generatedAt: new Date().toISOString(), ...base, visits, stripe: stripeOk, stripeError, owner });
  } catch (e) {
    return J({ error: "failed" }, 500);
  }
};
