// Run: node --test invoice-overdue-rules.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import * as ov from "./invoice-overdue-rules.js";

const line = (qty, rate) => ({ qty, rate });
const inv = (over) => ({
  status: "draft",
  date: "2026-11-01",
  due: "2026-11-15",
  lines: [line(1, 100)],
  ...over,
});

test("outstanding counts sent unpaid amounts and leaves drafts out", () => {
  const rows = [
    inv({ id: "d", status: "draft", lines: [line(1, 500)] }),
    inv({ id: "s", status: "sent", sentAt: "2026-11-01", lines: [line(2, 40)] }),
    inv({ id: "p", status: "paid", amountPaid: 100, lines: [line(1, 100)] }),
  ];
  assert.equal(ov.ovOutstanding(rows), 80);
});

test("a part payment stays owing for the remainder until the balance is gone", () => {
  const part = inv({ status: "paid", amountPaid: 40, sentAt: "2026-11-01", due: "2026-11-10" });
  const today = "2026-11-28";
  assert.equal(ov.ovIsPartPaid(part), true);
  assert.equal(ov.ovIsFullyPaid(part), false);
  assert.equal(ov.ovBalanceDue(part), 60);
  assert.equal(ov.ovIsAwaiting(part), true);
  assert.equal(ov.ovIsOverdue(part, today), true);
  assert.equal(ov.ovInFilter(part, "overdue", today), true);
  assert.equal(ov.ovInFilter(part, "sent", today), false);
  assert.equal(ov.ovInFilter(part, "paid", today), false);
  assert.equal(ov.ovInFilter(part, "owing", today), true);
  assert.equal(ov.ovOutstanding([part]), 60);
  const settled = { ...part, amountPaid: 100 };
  assert.equal(ov.ovIsFullyPaid(settled), true);
  assert.equal(ov.ovIsAwaiting(settled), false);
  assert.equal(ov.ovIsOverdue(settled, today), false);
  assert.equal(ov.ovOutstanding([settled]), 0);
});

test("waiting excludes overdue sent invoices and overdue includes them", () => {
  const today = "2026-11-28";
  const waiting = inv({ status: "sent", sentAt: "2026-11-20", due: "2026-12-01" });
  const late = inv({ status: "sent", sentAt: "2026-11-01", due: "2026-11-10" });
  assert.equal(ov.ovInFilter(waiting, "sent", today), true);
  assert.equal(ov.ovInFilter(waiting, "overdue", today), false);
  assert.equal(ov.ovInFilter(late, "sent", today), false);
  assert.equal(ov.ovInFilter(late, "overdue", today), true);
  assert.equal(ov.ovStatusKey(late, today), "overdue");
  assert.equal(ov.ovStatusKey(waiting, today), "sent");
});

test("share requires a due date, the same gate as save", () => {
  const ok = inv({ participantId: "p1", status: "draft" });
  assert.equal(ov.ovCanShare(ok), true);
  assert.equal(ov.ovCanShare({ ...ok, due: "" }), false);
  assert.equal(ov.ovCanShare({ ...ok, participantId: "" }), false);
  assert.equal(ov.ovCanShare({ ...ok, lines: [line(1, 0)] }), false);
});

test("desktop share fallback uses the same sent stamp as a successful share", () => {
  const draft = inv({ status: "draft", sentAt: "", sentAtEstimated: true });
  const sent = ov.ovMarkSent(draft, "2026-11-28");
  assert.equal(sent.status, "sent");
  assert.equal(sent.sentAt, "2026-11-28");
  assert.equal(sent.sentAtEstimated, false);
  const kept = ov.ovMarkSent({ ...draft, sentAt: "2026-11-02", sentAtEstimated: false }, "2026-11-28");
  assert.equal(kept.sentAt, "2026-11-02");
});

test("changing the issued date recalculates due from payment terms unless the due date was edited", () => {
  const auto = inv({ date: "2026-11-01", due: "2026-11-15" });
  const next = ov.ovIssuedChange(auto, "2026-11-03", 14);
  assert.deepEqual(next, { date: "2026-11-03", due: "2026-11-17", dueManual: false });
  const custom = inv({ date: "2026-11-01", due: "2026-12-01", dueManual: true });
  assert.deepEqual(ov.ovIssuedChange(custom, "2026-11-03", 14), { date: "2026-11-03" });
  const legacyCustom = inv({ date: "2026-11-01", due: "2026-12-20" });
  assert.equal(ov.ovDueIsManual(legacyCustom, 14), true);
  assert.deepEqual(ov.ovIssuedChange(legacyCustom, "2026-11-05", 14), { date: "2026-11-05" });
  const legacyAuto = inv({ date: "2026-11-01", due: "2026-11-15" });
  assert.equal(ov.ovDueIsManual(legacyAuto, 14), false);
  assert.equal(ov.ovIssuedChange(legacyAuto, "2026-12-01", 14).due, "2026-12-15");
  assert.equal(ov.ovDueFromTerms("2026-11-28", 7), "2026-12-05");
});

test("open sent invoices, including part-paid ones, are what the reminder sync uploads", () => {
  const today = "2026-11-28";
  const sent = inv({ id: "s", status: "sent", sentAt: "2026-11-01" });
  const part = inv({ id: "part", status: "paid", amountPaid: 25, sentAt: "2026-11-01", due: "2026-11-10" });
  const paid = inv({ id: "paid", status: "paid", amountPaid: 100, sentAt: "2026-11-01" });
  const draft = inv({ id: "d", status: "draft" });
  const noSent = inv({ id: "n", status: "sent", sentAt: "" });
  assert.equal(ov.ovSyncInvoice(sent), true);
  assert.equal(ov.ovSyncInvoice(part), true);
  assert.equal(ov.ovSyncInvoice(paid), false);
  assert.equal(ov.ovSyncInvoice(draft), false);
  assert.equal(ov.ovSyncInvoice(noSent), false);
  assert.equal(ov.ovIsOverdue(part, today), true);
});

test("server reminder mode: off unless enabled, and dry-run unless explicitly false", async () => {
  assert.equal(ov.ovSyncNotice({ autosendServer: false, autosendDryRun: true }), "off");
  assert.equal(ov.ovSyncNotice({ autosendServer: true, autosendDryRun: true }), "dry-run");
  assert.equal(ov.ovSyncNotice({ autosendServer: true, autosendDryRun: false }), "");
  const prevE = process.env.TRACKER_AUTOSEND_ENABLED;
  const prevD = process.env.TRACKER_AUTOSEND_DRY_RUN;
  delete process.env.TRACKER_AUTOSEND_ENABLED;
  delete process.env.TRACKER_AUTOSEND_DRY_RUN;
  const T = await import("./netlify/lib/tracker.mjs");
  assert.equal(T.autosendEnabled(), false);
  assert.equal(T.autosendDryRun(), true);
  process.env.TRACKER_AUTOSEND_ENABLED = "true";
  assert.equal(T.autosendEnabled(), true);
  assert.equal(T.autosendDryRun(), true);
  process.env.TRACKER_AUTOSEND_DRY_RUN = "false";
  assert.equal(T.autosendDryRun(), false);
  process.env.TRACKER_AUTOSEND_DRY_RUN = "FALSE";
  assert.equal(T.autosendDryRun(), false);
  process.env.TRACKER_AUTOSEND_DRY_RUN = "true";
  assert.equal(T.autosendDryRun(), true);
  if (prevE == null) delete process.env.TRACKER_AUTOSEND_ENABLED; else process.env.TRACKER_AUTOSEND_ENABLED = prevE;
  if (prevD == null) delete process.env.TRACKER_AUTOSEND_DRY_RUN; else process.env.TRACKER_AUTOSEND_DRY_RUN = prevD;
});

test("app shell applies the rules on share, issued date, filters, outstanding, and sync", () => {
  const src = readFileSync(new URL("./app.jsx", import.meta.url), "utf8");
  const shareStart = src.indexOf("const share = async");
  const share = src.slice(shareStart, src.indexOf("const firstName", shareStart));
  assert.match(share, /ovCanShare\(inv\)/);
  assert.match(share, /setPdf\("fellback"\)/);
  const afterFallback = share.slice(share.indexOf("setPdf(\"fellback\")"));
  assert.match(afterFallback, /onSent\s*&&\s*onSent\(\)/);
  assert.match(src, /ovIssuedChange\(/);
  assert.match(src, /ovInFilter\(/);
  assert.match(src, /ovOutstanding\(/);
  const appFn = src.indexOf("function App()");
  const trackerFn = src.indexOf("function PaymentTracker(");
  assert.ok(appFn > 0 && trackerFn > appFn);
  const appBody = src.slice(appFn, trackerFn);
  assert.match(appBody, /Sync open sent invoices even when the Payment Tracker screen is closed/);
  assert.match(src, /invoiceFilter:\s*"owing"/);
  const outstanding = src.slice(src.indexOf('label="Outstanding"'), src.indexOf('label="Outstanding"') + 700);
  assert.match(outstanding, /invoiceFilter:\s*"owing"/);
  assert.doesNotMatch(outstanding, /"tracker"/);
});
