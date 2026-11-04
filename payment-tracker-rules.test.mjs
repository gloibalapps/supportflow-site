import assert from "node:assert";
import * as r from "./payment-tracker-rules.js";
// SA 2026: Proclamation Day observed Mon 28 Dec; Christmas Fri 25 Dec.
assert(!r.isBusinessDay("2026-12-25", "SA") && !r.isBusinessDay("2026-12-28", "SA") && r.isBusinessDay("2026-12-29", "SA"));
assert(!r.isBusinessDay("2026-10-05", "SA"));            // Labour Day SA
assert(r.isBusinessDay("2026-11-03", "SA") && !r.isBusinessDay("2026-11-03", "VIC")); // Melbourne Cup
assert.equal(r.businessDaysBetween("2026-10-20", "2026-11-05", "SA"), 12);
const st = r.trackerStage({ sentAt: "2026-10-20", due: "2026-10-27", payerType: "plan", state: "SA", asOf: "2026-11-05" });
assert.equal(st.stage, 2);
// Due date later than BD 7 holds stage 1 until the first business day after due.
const st2 = r.trackerStage({ sentAt: "2026-10-01", due: "2026-10-30", payerType: "plan", state: "SA", asOf: "2026-10-30" });
assert.equal(st2.stage, 0); assert.equal(st2.dates[0], "2026-11-02");
const ag = r.trackerStage({ sentAt: "2026-11-02", payerType: "agency", state: "SA", asOf: "2026-11-05" });
assert.equal(ag.stage, 1);
const t = r.trackerTemplate("plan", 1, { invoice_no: 7, amount: "10.00", sent_date: "01/10/2026", participant: "Alex E.", ndis_bit: "", service_bit: "", to_name: "Sam", worker_name: "Jane", business_line: "" });
assert(!/\{/.test(t.body), t.body);
assert(/\{bdays\}/.test(r.trackerTemplate("plan", 2, {}).subject));
console.log("rules tests pass");
