// Premium one-off price window.
//
// The real Premium price is A$149. Until the end of 31 January 2027 the
// amount charged is A$129. From 1 February 2027 00:00 the charge is A$149
// again, with no deploy. The cutoff is the Australia/Adelaide civil date:
// SupportFlow is built in South Australia (terms are governed there) and the
// rest of the server already buckets dates in Australia/Adelaide.
// Adelaide is ACDT (UTC+10:30) on 31 January, so the window closes at
// 2027-01-31 13:30:00 UTC.
//
// The browser cannot choose the amount. Checkout reads this module and
// attaches either a server-side coupon on the A$149 Price or, if that coupon
// is not configured, a separate A$129 Price. After the window both are ignored.

export const PREMIUM_TZ = "Australia/Adelaide";
export const PREMIUM_LIST_AUD = 149;
export const PREMIUM_WINDOW_AUD = 129;
// Inclusive last civil day the window price is charged.
export const PREMIUM_WINDOW_UNTIL = "2027-01-31";
export const PREMIUM_WINDOW_LABEL = "31 January 2027";

let nowFn = () => new Date();
// Tests only. Production checkout always uses the real clock.
export function __setPremiumNow(fn) {
  nowFn = typeof fn === "function" ? fn : () => new Date();
}
export function premiumNow() {
  return nowFn();
}

export function adelaideDate(now = premiumNow()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: PREMIUM_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const get = (type) => parts.find((p) => p.type === type)?.value || "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

export function premiumWindowOpen(now = premiumNow()) {
  return adelaideDate(now) <= PREMIUM_WINDOW_UNTIL;
}

// Whole percent under the list price.  (149 - 129) / 149 = 13.42… → 13.
export function premiumSaving(list = PREMIUM_LIST_AUD, window = PREMIUM_WINDOW_AUD) {
  const amount = Math.round((list - window) * 100) / 100;
  const percent = Math.round((amount / list) * 100);
  return { amount, percent };
}

export function premiumPublic(now = premiumNow()) {
  const open = premiumWindowOpen(now);
  const saving = premiumSaving();
  return {
    listAud: PREMIUM_LIST_AUD,
    chargeAud: open ? PREMIUM_WINDOW_AUD : PREMIUM_LIST_AUD,
    windowOpen: open,
    windowUntil: PREMIUM_WINDOW_LABEL,
    windowUntilIso: PREMIUM_WINDOW_UNTIL,
    timezone: PREMIUM_TZ,
    savingAud: saving.amount,
    savingPercent: saving.percent,
    oneOff: true,
  };
}

// Which Stripe object to put on the Checkout Session.
// Prefer a coupon on the A$149 Price so Stripe still shows A$149 as the price.
// STRIPE_PRICE_PREMIUM_129 is the fallback one-off Price, used only in the window
// and only when the coupon is unset. After the window, only STRIPE_PRICE_TRACKER_FULL
// (the A$149 Price) is used, even if the coupon or A$129 Price is still set.
export function premiumCheckoutSelection(env = process.env, now = premiumNow()) {
  const listPrice = String(env.STRIPE_PRICE_TRACKER_FULL || "").trim();
  const open = premiumWindowOpen(now);
  if (!open) {
    if (!listPrice) return { error: "Premium isn't available to buy yet." };
    return { price: listPrice, coupon: null, chargeAud: PREMIUM_LIST_AUD, windowOpen: false };
  }
  const coupon = String(env.STRIPE_COUPON_PREMIUM_129 || "").trim();
  const windowPrice = String(env.STRIPE_PRICE_PREMIUM_129 || "").trim();
  if (listPrice && coupon) {
    return { price: listPrice, coupon, chargeAud: PREMIUM_WINDOW_AUD, windowOpen: true };
  }
  if (windowPrice) {
    return { price: windowPrice, coupon: null, chargeAud: PREMIUM_WINDOW_AUD, windowOpen: true };
  }
  return { error: "Premium's A$129 price isn't configured yet." };
}
