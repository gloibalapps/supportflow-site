// Owner-only. Same password as the marketing diary (MARKET_PASSWORD).
// GET  -> signup_report() summary.  POST {code,name,email?,notes?} -> add a referrer.
const J = (o, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });
export default async (req) => {
  const p = process.env.MARKET_PASSWORD || "";
  if (!p || req.headers.get("authorization") !== `Bearer ${p}`) return J({ error: "unauthorised" }, 401);
  const u = process.env.SUPABASE_URL, k = process.env.SUPABASE_SERVICE_KEY;
  if (!u || !k) return J({ error: "unconfigured" }, 503);
  const h = { apikey: k, Authorization: `Bearer ${k}`, "Content-Type": "application/json" };
  if (req.method === "POST") {
    let b; try { b = await req.json(); } catch { return J({ error: "bad" }, 400); }
    const code = String(b.code || "").toLowerCase().replace(/[^a-z0-9_-]/g, "").slice(0, 32);
    const name = String(b.name || "").trim().slice(0, 120);
    if (code.length < 3 || !name) return J({ error: "Code (3+ letters/numbers) and name are required." }, 400);
    const r = await fetch(`${u}/rest/v1/referrers`, { method: "POST", headers: { ...h, Prefer: "return=minimal" },
      body: JSON.stringify({ code, name, email: String(b.email || "").slice(0, 200) || null, notes: String(b.notes || "").slice(0, 1000) || null }) });
    if (!r.ok) return J({ error: r.status === 409 ? "That code already exists." : "Couldn't save." }, r.status === 409 ? 409 : 500);
  } else if (req.method !== "GET") return J({ error: "method" }, 405);
  const r = await fetch(`${u}/rest/v1/rpc/signup_report`, { method: "POST", headers: h, body: "{}" });
  if (!r.ok) return J({ error: "report_failed" }, 500);
  return J(await r.json());
};
