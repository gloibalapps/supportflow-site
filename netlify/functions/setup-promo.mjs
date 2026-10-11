// ONE-TIME bootstrap: creates the "freecredit" Stripe promotion code (100% off, 2 uses).
// Call once with: POST /.netlify/functions/setup-promo  { "secret": "sfsetup2024" }
// Remove this file after running.
export default async (req) => {
  const json = (o, s=200) => new Response(JSON.stringify(o), {status:s, headers:{"Content-Type":"application/json"}});
  if (req.method !== "POST") return new Response("Method not allowed", {status:405});
  let body;
  try { body = await req.json(); } catch { return json({error:"bad json"},400); }
  if (body?.secret !== "sfsetup2024") return json({error:"forbidden"},403);

  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) return json({error:"no stripe key"},500);

  const api = "https://api.stripe.com/v1";
  const auth = { Authorization: `Bearer ${key}`, "Content-Type": "application/x-www-form-urlencoded" };
  const form = (o) => Object.entries(o).map(([k,v])=>`${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join("&");

  // 1. Create coupon: 100% off, no expiry on the coupon itself
  const cr = await fetch(`${api}/coupons`, { method:"POST", headers:auth,
    body: form({ percent_off:100, duration:"once", name:"freecredit – 100% off" }) });
  const coupon = await cr.json();
  if (!cr.ok) return json({error:"coupon failed", detail:coupon},502);

  // 2. Create promo code "FREECREDIT" capped at 2 redemptions
  const pr = await fetch(`${api}/promotion_codes`, { method:"POST", headers:auth,
    body: form({ coupon:coupon.id, code:"FREECREDIT", max_redemptions:2 }) });
  const promo = await pr.json();
  if (!pr.ok) return json({error:"promo failed", detail:promo},502);

  return json({ ok:true, coupon_id:coupon.id, promo_id:promo.id, code:promo.code, max_redemptions:promo.max_redemptions });
};
