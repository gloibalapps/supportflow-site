// Premium: one standard one-off price, A$129. No discounts, windows or coupons.
// The browser cannot choose the amount: checkout reads the Stripe Price id from
// STRIPE_PRICE_TRACKER_FULL, which must be the A$129.00 AUD one-off Price.
export const PREMIUM_AUD = 129;

export function premiumPublic() {
  return { priceAud: PREMIUM_AUD, oneOff: true };
}

export function premiumCheckoutSelection(env = process.env) {
  const price = String(env.STRIPE_PRICE_TRACKER_FULL || "").trim();
  if (!price) return { error: "Premium isn't available to buy yet." };
  return { price, chargeAud: PREMIUM_AUD };
}
