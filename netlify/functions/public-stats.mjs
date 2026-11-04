// GET /.netlify/functions/public-stats -> aggregate-only public numbers for the
// homepage counter. No personal data. Fields are null when unavailable or below
// PUBLIC_STATS_MIN, and the homepage hides them.
import { publicStats, statsConfigured } from "../lib/stats.mjs";

export default async () => {
  const headers = { "Content-Type": "application/json", "Cache-Control": "public, max-age=300" };
  if (!statsConfigured()) return new Response(JSON.stringify({ ok: false }), { status: 503, headers });
  try {
    return new Response(JSON.stringify({ ok: true, ...(await publicStats()) }), { headers });
  } catch {
    return new Response(JSON.stringify({ ok: false }), { status: 500, headers });
  }
};
