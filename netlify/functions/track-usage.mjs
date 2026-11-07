// Anonymous feature-use counter. Stores only (Adelaide day, feature, count). No IP, no user agent, no IDs, no content.
const FEATURES = new Set(["shifts", "invoices", "notes", "expenses", "trips", "incidents", "backups", "tax_views"]);
const ok = () => new Response(null, { status: 204, headers: { "Cache-Control": "no-store" } });

export default async (req) => {
  if (req.method !== "POST") return new Response(null, { status: 405 });
  const u = process.env.SUPABASE_URL, k = process.env.SUPABASE_SERVICE_KEY;
  if (!u || !k) return ok();
  let b; try { b = JSON.parse(await req.text()); } catch { return ok(); }
  const day = new Intl.DateTimeFormat("en-CA", { timeZone: "Australia/Adelaide" }).format(new Date());
  const rows = Object.entries(b && typeof b === "object" ? b : {})
    .filter(([f, n]) => FEATURES.has(f) && Number.isInteger(n) && n > 0 && n <= 50);
  await Promise.all(rows.map(([feature, n]) =>
    fetch(`${u}/rest/v1/rpc/bump_usage`, {
      method: "POST", headers: { apikey: k, Authorization: `Bearer ${k}`, "Content-Type": "application/json" },
      body: JSON.stringify({ p_day: day, p_feature: feature, p_n: n }),
    }).catch(() => {})));
  return ok();
};
