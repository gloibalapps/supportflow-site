// Pricing page copy, layout, and GST wording only.
// Does not call checkout, Stripe, or Netlify.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const html = readFileSync(new URL("../pricing.html", import.meta.url), "utf8");

test("pricing page states one-off plans and optional monthly SMS", () => {
  assert.match(html, /<h1>SupportFlow pricing<\/h1>/);
  assert.match(html, /<title>SupportFlow pricing: Basic A\$79, Premium A\$129<\/title>/);
  assert.match(html, /Basic and Premium are paid once\. The only monthly charge is optional SMS\./);
  assert.doesNotMatch(html, /no subscription|No monthly fees|All future updates|OneDrive|5 free invoices/i);
  assert.match(html, /Get Basic &mdash; A\$79/);
  assert.match(html, /Get Premium &mdash; A\$129/);
  assert.match(html, /startCheckout\('lifetime'\)/);
  assert.match(html, /href="\/app\?buy=upgrade"/);
});

test("pricing cards match and GST is shown once beside the plan prices", () => {
  assert.match(html, /class="plan-grid"/);
  assert.equal((html.match(/class="p plan-card/g) || []).length, 2);
  assert.match(html, /A\$79 <small class="inc">inc GST<\/small>/);
  assert.match(html, /A\$129 <small class="inc">inc GST<\/small>/);
  assert.equal((html.match(/All prices include GST/g) || []).length, 1);
  assert.doesNotMatch(html, /A\$7\.18|A\$11\.73|A\$2\.64|A\$0\.45|Includes A\$/);
  assert.match(html, /"valueAddedTaxIncluded": true/);
  const cards = [...html.matchAll(/<section class="p plan-card[\s\S]*?<\/section>/g)].map((m) => m[0]);
  assert.equal(cards.length, 2);
  for (const card of cards) {
    assert.match(card, /class="tag"/);
    assert.match(card, /class="price big"/);
    assert.match(card, /class="inc"/);
    assert.match(card, /class="once"/);
    assert.match(card, /class="btn"/);
    assert.match(card, /class="incl"/);
  }
});

test("add-on prices, trial, backup, restore, and refund stay accurate and unrepeated", () => {
  assert.match(html, /Backups encrypted before uploading to your Google Drive/);
  assert.match(html, /5 invoice credits for 30 days/);
  assert.match(html, /first preview of a new invoice uses one credit/);
  assert.match(html, /does not use another credit/);
  assert.match(html, /full A\$129, not the difference after buying Basic/);
  assert.match(html, /sign in with Google/);
  assert.match(html, /only after the Payment tracker/);
  assert.match(html, /Restore licence/);
  assert.match(html, /checkout email/);
  assert.match(html, /Google account you sign in with/);
  assert.match(html, /Lifetime licence/);
  assert.match(html, /Australian Consumer Law/);
  assert.match(html, /not affiliated with or endorsed by the NDIA or NDIS/);
  assert.match(html, /not tax or legal advice/);
  assert.equal((html.match(/A\$4\.99/g) || []).length, 1);
  assert.equal((html.match(/A\$29/g) || []).length, 2);
  const fine = html.match(/<div class="fine">([\s\S]*?)<\/div>/)[1];
  assert.doesNotMatch(fine, /A\$79|A\$129|A\$29|A\$4\.99/);
});
