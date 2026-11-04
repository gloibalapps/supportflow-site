// GET /.netlify/functions/admin-dashboard  (Authorization: Bearer <ADMIN_DASHBOARD_TOKEN>)
// Owner-only stats. Token checked server-side with a constant-time compare.
import crypto from "node:crypto";
import { dashboardStats, statsConfigured } from "../lib/stats.mjs";

const J = (o, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { "Content-Type": "application/json", "Cache-Control": "no-store", "X-Robots-Tag": "noindex" } });

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
  if (!statsConfigured()) return J({ error: "stats source not configured" }, 503);
  try {
    const days = Math.min(90, Math.max(7, Number(new URL(req.url).searchParams.get("days")) || 30));
    return J(await dashboardStats({ days }));
  } catch (e) {
    return J({ error: "failed" }, 500);
  }
};
