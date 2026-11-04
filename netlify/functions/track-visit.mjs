// Privacy-safe page-visit counter. Stores no IP, no user agent, no cookies.
// visitor_hash = SHA-256(VISIT_SALT + UTC date + IP + UA): unique per day only,
// unlinkable across days. Country/region come from Netlify geo (context.geo).
import crypto from "node:crypto";

const BOT = /bot|crawl|spider|slurp|preview|facebookexternalhit|headless|lighthouse|pingdom|uptime|curl|wget|python|axios|node-fetch|go-http/i;
const clean = (v, n) => (v == null ? null : String(v).toLowerCase().replace(/[^a-z0-9_./-]/g, "").slice(0, n) || null);
const ok = () => new Response(null, { status: 204, headers: { "Cache-Control": "no-store" } });

export default async (req, context) => {
  if (req.method !== "POST") return new Response(null, { status: 405 });
  const ua = req.headers.get("user-agent") || "";
  if (!ua || BOT.test(ua)) return ok();
  const salt = process.env.VISIT_SALT, u = process.env.SUPABASE_URL, k = process.env.SUPABASE_SERVICE_KEY;
  if (!salt || !u || !k) return ok(); // silently off until configured
  let b; try { b = JSON.parse(await req.text()); } catch { return ok(); }
  const path = String(b.p || "/").replace(/[^A-Za-z0-9_./-]/g, "").slice(0, 120) || "/";
  if (/^\/(admin|signups|market|\.netlify)/.test(path)) return ok();
  const ip = context?.ip || req.headers.get("x-nf-client-connection-ip") || "";
  const day = new Date().toISOString().slice(0, 10);
  const row = {
    day, path,
    visitor_hash: crypto.createHash("sha256").update(`${salt}|${day}|${ip}|${ua}`).digest("hex"),
    referrer_host: clean(b.r, 120), utm_source: clean(b.s, 60), utm_medium: clean(b.m, 60), utm_campaign: clean(b.c, 60),
    country: clean(context?.geo?.country?.code, 2)?.toUpperCase() || null,
    region: context?.geo?.subdivision?.code ? String(context.geo.subdivision.code).slice(0, 10) : null,
  };
  try {
    await fetch(`${u}/rest/v1/site_visits`, {
      method: "POST", headers: { apikey: k, Authorization: `Bearer ${k}`, "Content-Type": "application/json", Prefer: "return=minimal" },
      body: JSON.stringify(row),
    });
  } catch {}
  return ok();
};
