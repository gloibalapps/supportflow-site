// Run: node --test tests/
// Owner rule: on a member's EXISTING device, unlock is PIN/fingerprint only and
// Google sign-in never appears. Google appears only via /app?buy=1 (purchase
// link, or finding an existing licence on a NEW device).
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
process.env.LICENCE_SECRET ||= "test-secret-for-unit-tests-only-0123456789";
const { signSession, verifySession, RENEW_GRACE_DAYS } = await import("../netlify/lib/licence.mjs");
const read = (f) => readFileSync(new URL(`../${f}`, import.meta.url), "utf8");

for (const f of ["app.html", "app.jsx"]) {
  const s = read(f);
  const app = s.slice(s.indexOf('if (!loaded) return <div className="sl"'));
  test(`${f}: existing device - PIN/fingerprint screen renders before any licence screen`, () => {
    const lock = app.indexOf("<LockScreen"), checking = app.indexOf("<LicenceChecking"), gate = app.indexOf("<LicenceGate");
    assert.ok(lock > 0 && lock < checking && lock < gate);
  });
  test(`${f}: existing device - no 'checking' screen and no Google gate for member devices`, () => {
    assert.match(app, /licence\.phase === "checking" && !isMemberDevice\(\)/);
    assert.match(app, /!\(isMemberDevice\(\) && licence\.info\?\.state === "offline"\)/);
    // signed_out (the only state that renders the Google button) needs ?buy=1
    assert.match(app, /licence\.info\?\.state === "signed_out" && !wantsLicenceFlow\(\)/);
  });
  test(`${f}: existing device - server 401 falls back to stored lease, never to sign-in`, () => {
    assert.match(s, /if \(isMemberDevice\(\) && !wantsLicenceFlow\(\)\) \{ await offlineDecision\(\); return data; \}/);
  });
  test(`${f}: LockScreen itself has no Google sign-in`, () => {
    const ls = s.slice(s.indexOf("function LockScreen"), s.indexOf("function LockScreen") + 4000);
    assert.doesNotMatch(ls, /google|LicenceGoogleButton/i);
  });
  test(`${f}: account sign-in is on the purchase and restore paths, with a PIN prompt after linking`, () => {
    const signIn = s.slice(s.indexOf("function LicenceAccountSignIn"), s.indexOf("function LicencePlans"));
    assert.match(signIn, /<LicenceGoogleButton/);
    assert.match(signIn, /type="password"/);
    assert.match(signIn, /Create account and continue/);
    assert.equal([...s.matchAll(/<LicenceAccountSignIn/g)].length, 3);
    assert.match(s, /out\?\.state === "active"\) \{ try \{ if \(!readLock\(\)\) localStorage\.setItem\(ASK_PIN_FLAG, "1"\)/);
    assert.match(s, /<PinSetupPrompt/);
  });
  test(`${f}: new device with no licence gets the trial (gate not forced), with an opt-in 'Already a member?' link`, () => {
    assert.match(s, /href="\/app\?buy=restore"[^>]*>Already a member\?<\/a>/);
  });
}

test("server: expired session renews silently within grace, rejected strictly", () => {
  const tok = signSession({ sub: "u1", email: "a@b.c" });
  const [p, sig] = tok.split(".");
  assert.ok(verifySession(tok));
  // forge-free check: a tampered payload never verifies, even with grace
  assert.equal(verifySession(`${p}x.${sig}`, { allowExpiredDays: RENEW_GRACE_DAYS }), null);
});
test("server: heartbeat renewal requires an active device on an active licence", () => {
  const s = read("netlify/functions/licence.mjs");
  assert.match(s, /if \(!session && action === "heartbeat"\)[\s\S]{0,400}result\?\.state === "active"/);
});
