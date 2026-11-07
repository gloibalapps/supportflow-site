// Run: node --test tests/
// Guards the rule: Google sign-in is only for linking a PAID licence; the free
// trial path (homepage "Try it for free", Open App, offer banner, paywall
// notice) must not require, show or offer it.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const root = new URL("../", import.meta.url);
const read = (f) => readFileSync(new URL(f, root), "utf8");
const google = /sign[ -]?in with google|google sign|gsi\/client|accounts\.google/i;

test("homepage has no Google sign-in", () => {
  assert.doesNotMatch(read("index.html"), google);
});
for (const f of ["app.html", "app.jsx"]) {
  const s = read(f);
  test(`${f}: signed-out trial users bypass the sign-in gate unless ?buy=1`, () => {
    assert.match(s, /licence\.phase === "locked" && !\(licence\.info\?\.state === "signed_out" && !wantsLicenceFlow\(\)\)/);
    assert.match(s, /function wantsLicenceFlow\(\)[^\n]*=== "1"/);
  });
  test(`${f}: offer banner / upgrade reminder / paywall notice never mention Google`, () => {
    const banner = s.slice(s.indexOf("function OfferOrUpgradeBanner"), s.indexOf("/* ---------------- trial ended notice"));
    assert.ok(banner.length > 200);
    assert.doesNotMatch(banner, /google/i);
    const notice = s.slice(s.indexOf("function CreditNotice"), s.indexOf("function CreditNotice") + 900);
    assert.doesNotMatch(notice, /google/i);
  });
  test(`${f}: trial credits keyed by anonymous device ref`, () => {
    assert.match(s, /clientReferenceId: getDeviceRef\(\)/);
  });
}
