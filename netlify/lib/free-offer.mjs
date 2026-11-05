// Pure helpers for the new-user offer: 5 free invoices for 30 days from first open.
import { createHash } from "node:crypto";
export const FREE_OFFER = Object.freeze({ invoices: 5, days: 30, maxGrantsPerIpPer30Days: 3 });

// Salted so raw IPs are never stored. Salt: FREE_OFFER_IP_SALT env var.
export function hashIp(ip, salt = "") {
  if (!ip) return null;
  return createHash("sha256").update(`${salt}|${String(ip).trim()}`).digest("hex").slice(0, 32);
}

export function clientIp(req) {
  const h = (n) => req.headers.get(n) || "";
  return h("x-nf-client-connection-ip") || h("x-forwarded-for").split(",")[0].trim() || null;
}

// Banner state from an account row. Returns null when the offer isn't active.
export function offerState(acc, now = Date.now()) {
  if (!acc) return null;
  const free = Number(acc.free_credits_remaining) || 0;
  const exp = acc.credits_expire_at ? new Date(acc.credits_expire_at).getTime() : NaN;
  if (free <= 0 || !Number.isFinite(exp) || exp <= now) return null;
  if ((Number(acc.credit_balance) || 0) >= 90000) return null; // lifetime/licensed
  return { remaining: Math.min(free, FREE_OFFER.invoices), daysLeft: Math.max(1, Math.ceil((exp - now) / 86400000)), expiresAt: new Date(exp).toISOString() };
}
