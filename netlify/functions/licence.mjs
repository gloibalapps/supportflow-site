// One-off device licensing API. See LICENSING.md and netlify/lib/licence.mjs.
//
//   GET  ?action=config                 -> { enabled, clientId, publicKey }
//   POST ?action=google-redirect        <- Google's redirect-mode sign-in form post (iPhone home-screen app)
//   POST { action: "signin",    idToken, deviceId, label, legacyRef }
//   POST { action: "heartbeat", session, deviceId, label, legacyRef }
//   POST { action: "activate",  session, deviceId, label, replaceDeviceId? }   "Move the licence here"
//   POST { action: "remove",    session, deviceId, targetDeviceId }
//   POST { action: "signout",   session, deviceId }
//   POST { action: "checkout",  session, deviceId, product: "one"|"two"|"upgrade" }
//
// While the owner switch is off (and the account isn't a LICENSING_TEST_EMAILS
// address) every call answers { state: "disabled" } and the app carries on
// exactly as before.

import {
  json, supa, supaConfigured, licensingSwitchOn, enforcedFor, getLeaseKeys, signSession, verifySession,
  verifyGoogleIdToken, evaluate, activateDevice, getLicence, listDevices, isUuid, cleanLabel,
  PLAN_NAMES, PRODUCTS, sendEmail,
} from "../lib/licence.mjs";

const STRIPE_API = "https://api.stripe.com/v1";
const formBody = (obj) => Object.entries(obj).map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join("&");

function sameOrigin(req) {
  const origin = req.headers.get("origin");
  const host = req.headers.get("host");
  if (!origin || !host) return true;
  try { return new URL(origin).host === host; } catch { return false; }
}

async function config(req) {
  const enabled = await licensingSwitchOn();
  let publicKey = null;
  try { publicKey = getLeaseKeys().publicJwk; } catch { publicKey = null; }
  return json({
    enabled,
    // Only true when the server is fully set up; the app never enforces a
    // half-configured system.
    ready: !!(publicKey && supaConfigured() && process.env.GOOGLE_CLIENT_ID),
    clientId: process.env.GOOGLE_CLIENT_ID || "",
    publicKey,
    staleDays: 21,
    leaseDays: 7,
    plans: [
      { id: "one", plan: 1, name: PLAN_NAMES[1], priceAud: 49 },
      { id: "two", plan: 2, name: PLAN_NAMES[2], priceAud: 69 },
    ],
    upgradeAud: 20,
  });
}

// Google "redirect" UX mode posts the ID token here as a form. Checked with
// Google's double-submit CSRF cookie, then handed to the app in the URL
// fragment (never sent to a server again as part of a URL).
async function googleRedirect(req) {
  const form = await req.formData().catch(() => null);
  const credential = form?.get("credential");
  const csrfBody = form?.get("g_csrf_token");
  const cookie = req.headers.get("cookie") || "";
  const csrfCookie = (cookie.match(/(?:^|;\s*)g_csrf_token=([^;]+)/) || [])[1];
  const site = process.env.SITE_URL || new URL(req.url).origin;
  if (!credential || !csrfBody || !csrfCookie || csrfBody !== csrfCookie) {
    return new Response(null, { status: 303, headers: { Location: `${site}/app#sf_signin_error=1` } });
  }
  return new Response(null, { status: 303, headers: { Location: `${site}/app#sf_idt=${encodeURIComponent(credential)}`, "Cache-Control": "no-store" } });
}

function deviceArgs(body) {
  const deviceId = String(body?.deviceId || "");
  if (!isUuid(deviceId)) return null;
  return { deviceId: deviceId.toLowerCase(), label: cleanLabel(body?.label), legacyRef: isUuid(body?.legacyRef) ? body.legacyRef : null };
}

async function stateFor(session, dev, extra = {}) {
  if (!(await enforcedFor(session.email))) return json({ state: "disabled" });
  const result = await evaluate({ sub: session.sub, email: session.email, ...dev });
  // Re-issue the session when it's past halfway, so an app in daily use never
  // has to bounce through Google again.
  const fresh = session.exp - Date.now() < 45 * 86400000 ? signSession(session) : undefined;
  return json({ ...result, account: { email: session.email, name: session.name }, ...(fresh ? { session: fresh } : {}), ...extra });
}

async function checkout(session, dev, body) {
  const key = process.env.STRIPE_SECRET_KEY;
  const site = process.env.SITE_URL;
  if (!key || !site) return json({ error: "Payments aren't set up on this site yet." }, 500);
  const product = String(body?.product || "");
  const spec = PRODUCTS[product];
  if (!spec) return json({ error: "Choose One device or Phone and computer." }, 400);
  const price = spec.env.map((e) => process.env[e]).find(Boolean);
  if (!price) return json({ error: "That option isn't available yet." }, 500);

  const lic = await getLicence(session.sub);
  const activePlan = lic && lic.status === "active" ? lic.plan : 0;
  if (product === "upgrade" && activePlan !== 1) {
    return json({ error: activePlan === 2 ? "You already have Phone and computer." : "The $20 upgrade is for One device licences." }, 409);
  }
  if (product === "one" && activePlan >= 1) return json({ error: "This Google account already has a licence." }, 409);
  if (product === "two" && activePlan === 2) return json({ error: "This Google account already has Phone and computer." }, 409);
  if (product === "two" && activePlan === 1) return json({ error: "You already have One device. Upgrade for $20 instead.", upgrade: true }, 409);

  const meta = { kind: "licence", product, google_sub: session.sub, device_id: dev.deviceId };
  const params = {
    mode: "payment",
    "line_items[0][price]": price,
    "line_items[0][quantity]": 1,
    client_reference_id: session.sub,
    customer_creation: "always",
    success_url: `${site}/app?licence=success`,
    cancel_url: `${site}/app?licence=cancelled`,
  };
  if (session.email) params.customer_email = session.email;
  for (const [k, v] of Object.entries(meta)) {
    params[`metadata[${k}]`] = v;
    params[`payment_intent_data[metadata][${k}]`] = v;
  }
  try {
    const resp = await fetch(`${STRIPE_API}/checkout/sessions`, {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/x-www-form-urlencoded" },
      body: formBody(params),
    });
    const s = await resp.json();
    if (!resp.ok) return json({ error: s?.error?.message || "Stripe couldn't start checkout." }, 502);
    return json({ url: s.url });
  } catch {
    return json({ error: "Couldn't reach Stripe. Try again in a moment." }, 502);
  }
}

export default async (req) => {
  const url = new URL(req.url);
  const qAction = url.searchParams.get("action");
  try {
    if (req.method === "GET" && (qAction === "config" || !qAction)) return await config(req);
    if (req.method === "POST" && qAction === "google-redirect") return await googleRedirect(req);
    if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);
    if (!sameOrigin(req)) return json({ error: "forbidden" }, 403);

    let body;
    try { body = await req.json(); } catch { return json({ error: "Malformed request." }, 400); }
    const action = String(body?.action || "");
    const dev = deviceArgs(body);
    if (!dev) return json({ error: "Missing device id." }, 400);
    if (!supaConfigured() || !process.env.LICENCE_SECRET) return json({ state: "disabled", reason: "unconfigured" });

    if (action === "signin") {
      const who = await verifyGoogleIdToken(body?.idToken).catch((e) => { console.warn("id token check failed", e.message); return null; });
      if (!who) return json({ error: "Google sign-in couldn't be confirmed. Try again." }, 401);
      const session = signSession(who);
      const parsed = verifySession(session);
      return await stateFor(parsed, dev, { session });
    }

    const session = verifySession(body?.session);
    if (!session) {
      if (!(await licensingSwitchOn())) return json({ state: "disabled" });
      return json({ state: "signed_out" }, 401);
    }

    if (action === "heartbeat") return await stateFor(session, dev);

    if (!(await enforcedFor(session.email))) return json({ state: "disabled" });

    if (action === "activate") {
      const replace = isUuid(body?.replaceDeviceId) ? body.replaceDeviceId.toLowerCase() : null;
      const before = await listDevices(session.sub);
      const r = await activateDevice(session.sub, dev.deviceId, dev.label, replace);
      if (!r?.ok) return await stateFor(session, dev, { error: r?.reason === "unpaid" ? "This Google account doesn't have a licence yet." : "Choose a device to replace." });
      if (r.replaced) {
        const old = before.find((d) => d.device_id === replace);
        const lic = await getLicence(session.sub);
        const to = session.email || lic?.email;
        await sendEmail(to, "Your SupportFlow licence was moved",
          `Hi${session.name ? " " + session.name.split(" ")[0] : ""},\n\n` +
          `Your SupportFlow licence was just moved to "${dev.label}".\n` +
          `"${old?.label || r.replaced_label || "Your other device"}" will lock the next time it connects (or within 7 days if it stays offline).\n\n` +
          `If this was you, there's nothing to do. If it wasn't, open SupportFlow on your own device, sign in with Google and choose "Move the licence here", then change your Google password.\n\n` +
          `SupportFlow`);
      }
      return await stateFor(session, dev, { moved: !!r.replaced });
    }

    if (action === "remove") {
      const target = String(body?.targetDeviceId || "").toLowerCase();
      if (!isUuid(target)) return json({ error: "Missing device." }, 400);
      await supa(`licence_devices?google_sub=eq.${encodeURIComponent(session.sub)}&device_id=eq.${encodeURIComponent(target)}&revoked_at=is.null`, {
        method: "PATCH", body: { revoked_at: new Date().toISOString(), revoked_reason: "removed" }, prefer: "return=minimal",
      });
      return await stateFor(session, dev);
    }

    if (action === "signout") {
      // Signing out frees this device's slot straight away.
      await supa(`licence_devices?google_sub=eq.${encodeURIComponent(session.sub)}&device_id=eq.${encodeURIComponent(dev.deviceId)}&revoked_at=is.null`, {
        method: "PATCH", body: { revoked_at: new Date().toISOString(), revoked_reason: "signed_out" }, prefer: "return=minimal",
      });
      return json({ state: "signed_out" });
    }

    if (action === "checkout") return await checkout(session, dev, body);

    return json({ error: "Unknown action." }, 400);
  } catch (e) {
    console.error("licence:", e);
    // The app treats 5xx as "couldn't check" and falls back to its offline
    // lease, so a server hiccup never locks out a paying user mid-shift.
    return json({ error: "Licence check failed. Try again shortly." }, 500);
  }
};
