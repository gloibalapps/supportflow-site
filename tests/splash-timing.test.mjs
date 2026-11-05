// Run: node --test tests/
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const s = readFileSync(new URL("../app.html", import.meta.url), "utf8");
test("splash: 5s minimum on cold open only, measured from page start", () => {
  assert.match(s, /BOOT_MIN_MS=5000/);
  assert.match(s, /bootCold=!sessionStorage\.getItem\('sf:booted'\)/);
  assert.match(s, /wait=bootCold\?Math\.max\(0,BOOT_MIN_MS-now\):0/);
});
test("splash: errors shown immediately, never delayed", () => {
  const f = s.slice(s.indexOf("function fail(text)"), s.indexOf("function fail(text)") + 200);
  assert.doesNotMatch(f, /setTimeout/);
});
test("splash: launch hides via hideBoot (fade .6s)", () => {
  assert.match(s, /hideBoot\(\);/);
  assert.match(s, /transition:opacity \.6s ease/);
});
