// Basic (A$79) must sign in with Google, then start the licence checkout
// for product "one" (google_sub on the Stripe session). It must not use the
// anonymous create-checkout lifetime pack.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const root = new URL("../", import.meta.url);
const read = (f) => readFileSync(new URL(f, root), "utf8");

test("pricing Buy now A$79 opens the in-app Google flow", () => {
  const html = read("pricing.html");
  assert.match(html, /href="\/app\?buy=1"[^>]*>\s*Buy now/);
  assert.doesNotMatch(html, /startCheckout|create-checkout/);
});

test("homepage Get Basic still opens /app?buy=1 and does not call create-checkout", () => {
  const html = read("index.html");
  assert.match(html, /href="\.\/app\?buy=1"[^>]*>\s*Get Basic/);
  assert.doesNotMatch(html, /create-checkout|startCheckout/);
});

for (const f of ["app.jsx", "app.html"]) {
  test(`${f}: Basic chooser asks for Google, then licence checkout product one`, () => {
    const s = read(f);
    assert.match(s, /function wantsBasicCheckout\(\)[^\n]*get\("buy"\) === "1"/);
    const chooser = s.slice(s.indexOf("function BasicChooser"), s.indexOf("function OfferOrUpgradeBanner"));
    assert.ok(chooser.length > 200, "BasicChooser missing");
    assert.match(chooser, /<LicenceAccountSignIn/);
    assert.match(chooser, /!signedIn/);
    assert.match(chooser, /checkout\("one"\)/);
    assert.match(chooser, /Buy Basic — A\$79|Buy Basic \\u2014 A\$79/);
    assert.doesNotMatch(chooser, /create-checkout|clientReferenceId|tracker_full/);
    assert.match(s, /<BasicChooser licence=\{licence\} \/>/);
  });

  test(`${f}: in-app lifetime/basic buttons do not call create-checkout`, () => {
    const s = read(f);
    assert.doesNotMatch(s, /create-checkout/);
    const notice = s.slice(s.indexOf("function TrialEndedNotice"), s.indexOf("function TrialEndingBanner"));
    assert.match(notice, /BUY_URL/);
    assert.match(notice, /Buy Basic — A\$79|Buy Basic \\u2014 A\$79/);
    assert.doesNotMatch(notice, /Buy Lifetime|A\$49/);
    const banner = s.slice(s.indexOf("function TrialEndingBanner"), s.indexOf("function LockScreen"));
    assert.match(banner, /Buy Basic — A\$79|Buy Basic \\u2014 A\$79/);
    assert.doesNotMatch(banner, /A\$49/);
    assert.match(s, /window\.location\.href = BUY_URL/);
    assert.match(s, /Basic — A\$79|Basic \\u2014 A\$79/);
    assert.doesNotMatch(s.slice(s.indexOf("function CreditNotice"), s.indexOf("function CreditNotice") + 500), /A\$49/);
  });

  test(`${f}: unpaid licence screen sells Basic as product one at A$79`, () => {
    const s = read(f);
    const plans = s.slice(s.indexOf("function LicencePlans"), s.indexOf("function LicenceDeviceChooser"));
    assert.match(plans, /"one"/);
    assert.match(plans, /Basic/);
    assert.match(plans, /79/);
    assert.doesNotMatch(plans, /"two"|A\$49|A\$69/);
  });

  test(`${f}: Premium chooser still uses Google then tracker_full`, () => {
    const s = read(f);
    const up = s.slice(s.indexOf("function UpgradeChooser"), s.indexOf("function BasicChooser"));
    assert.match(up, /<LicenceAccountSignIn/);
    assert.match(up, /product: "tracker_full"/);
    assert.match(up, /session: session\?\.token, deviceId/);
  });

  test(`${f}: PIN unlock has no Google button`, () => {
    const s = read(f);
    const ls = s.slice(s.indexOf("function LockScreen"), s.indexOf("function LockScreen") + 4500);
    assert.doesNotMatch(ls, /LicenceGoogleButton|google/i);
  });
}

test("licence checkout for product one is allowed while the lock switch is off and binds google_sub", async () => {
  process.env.LICENCE_SECRET = "s".repeat(40);
  process.env.SUPABASE_URL = "https://supa.test";
  process.env.SUPABASE_SERVICE_KEY = "service";
  process.env.STRIPE_SECRET_KEY = "sk_test_x";
  process.env.SITE_URL = "https://sf.test";
  process.env.STRIPE_PRICE_49 = "price_basic_79";
  process.env.LICENSING_ENABLED = "false";
  const calls = [];
  const previous = globalThis.fetch;
  globalThis.fetch = async (url, opt = {}) => {
    const u = String(url);
    calls.push({ url: u, body: opt.body || "" });
    if (u.includes("checkout/sessions")) {
      return new Response(JSON.stringify({ url: "https://checkout.test/basic" }), { status: 200 });
    }
    return new Response("[]", { status: 200, headers: { "Content-Type": "application/json" } });
  };
  try {
    const L = await import("../netlify/lib/licence.mjs");
    const licence = (await import("../netlify/functions/licence.mjs")).default;
    const session = L.signSession({ sub: "gsub_1", email: "w@x.test", name: "W", ev: true });
    const res = await licence(new Request("https://sf.test/.netlify/functions/licence", {
      method: "POST",
      headers: { "Content-Type": "application/json", origin: "https://sf.test", host: "sf.test" },
      body: JSON.stringify({
        action: "checkout",
        product: "one",
        session,
        deviceId: "11111111-1111-4111-8111-111111111111",
      }),
    }));
    const data = await res.json();
    assert.equal(res.status, 200);
    assert.equal(data.url, "https://checkout.test/basic");
    const stripe = calls.find((c) => c.url.includes("checkout/sessions"));
    assert.ok(stripe, "Stripe checkout was not started");
    const p = new URLSearchParams(stripe.body);
    assert.equal(p.get("metadata[kind]"), "licence");
    assert.equal(p.get("metadata[product]"), "one");
    assert.equal(p.get("metadata[google_sub]"), "gsub_1");
    assert.equal(p.get("payment_intent_data[metadata][google_sub]"), "gsub_1");
    assert.equal(p.get("client_reference_id"), "gsub_1");
    assert.equal(p.get("line_items[0][price]"), "price_basic_79");
    assert.equal(p.get("metadata[pack]"), null);
  } finally {
    globalThis.fetch = previous;
  }
});

test("signin still returns a session when licensing is not enforced, so checkout can be linked", () => {
  const src = read("netlify/functions/licence.mjs");
  assert.match(src, /state: "disabled", session/);
  const checkoutAt = src.indexOf('if (action === "checkout") return await checkout(session, dev, body);');
  const gateAt = src.lastIndexOf('if (!(await enforcedFor(session.email))) return json({ state: "disabled" });');
  assert.ok(checkoutAt > 0 && gateAt > checkoutAt, "checkout must run before the enforcement gate");
});

test("webhook records licence checkouts on the Google account, separate from the credit ledger", () => {
  const src = read("netlify/functions/stripe-webhook.mjs");
  const paid = src.slice(src.indexOf("async function handlePaidSession"), src.indexOf("export default"));
  const licenceBranch = paid.indexOf('session.metadata?.kind === "licence"');
  const creditBranch = paid.indexOf("grantLifetime");
  assert.ok(licenceBranch > 0 && licenceBranch < creditBranch);
  assert.match(read("netlify/lib/licence.mjs"), /product === "one"/);
});

test("create-checkout refuses the anonymous lifetime/basic pack", async () => {
  process.env.STRIPE_SECRET_KEY = "sk_test_x";
  process.env.SITE_URL = "https://sf.test";
  process.env.STRIPE_PRICE_49 = "price_basic_79";
  let stripe = false;
  const previous = globalThis.fetch;
  globalThis.fetch = async (url) => {
    if (String(url).includes("api.stripe.com")) stripe = true;
    return new Response("{}", { status: 500 });
  };
  try {
    const create = (await import("../netlify/functions/create-checkout.mjs")).default;
    const res = await create(new Request("https://sf.test/.netlify/functions/create-checkout", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ plan: "lifetime", clientReferenceId: "11111111-1111-4111-8111-111111111111" }),
    }));
    assert.equal(res.status, 400);
    const body = await res.json();
    assert.match(body.error, /Google/i);
    assert.equal(stripe, false);
  } finally {
    globalThis.fetch = previous;
  }
});
