// Records a first app open (a "signup") with where it came from. Stores no IP
// or user agent. Idempotent per device_ref; later calls only bump last_seen_at.
const J = (o, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { "Content-Type": "application/json" } });
const t = (v, n) => (v == null ? null : String(v).slice(0, n) || null);

export default async (req) => {
  if (req.method !== "POST") return J({ error: "method" }, 405);
  const u = process.env.SUPABASE_URL, k = process.env.SUPABASE_SERVICE_KEY;
  if (!u || !k) return J({ ok: false }, 503);
  let b; try { b = await req.json(); } catch { return J({ error: "bad" }, 400); }
  const dev = t(b.deviceRef, 100);
  if (!dev || dev.length < 8) return J({ error: "bad" }, 400);
  const row = {
    device_ref: dev, ref_code: t(b.ref, 60), utm_source: t(b.src, 60), utm_medium: t(b.med, 60),
    utm_campaign: t(b.cam, 60), referrer_host: t(b.host, 120), landing_path: t(b.path, 120),
  };
  const h = { apikey: k, Authorization: `Bearer ${k}`, "Content-Type": "application/json" };
  try {
    const r = await fetch(`${u}/rest/v1/signup_attribution?on_conflict=device_ref`, {
      method: "POST", headers: { ...h, Prefer: "resolution=ignore-duplicates,return=minimal" }, body: JSON.stringify(row),
    });
    if (!r.ok) return J({ ok: false }, 500);
    await fetch(`${u}/rest/v1/signup_attribution?device_ref=eq.${encodeURIComponent(dev)}`, {
      method: "PATCH", headers: { ...h, Prefer: "return=minimal" }, body: JSON.stringify({ last_seen_at: new Date().toISOString() }),
    });
    return J({ ok: true });
  } catch { return J({ ok: false }, 500); }
};
