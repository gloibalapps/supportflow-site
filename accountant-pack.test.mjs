import assert from "node:assert";
import fs from "node:fs";
import {
  buildAccountantPack, accountantPackText, accountantPackFilename, accountantPackYears,
} from "./accountant-pack.js";

function incomeTax(t) {
  if (t <= 18200) return 0;
  if (t <= 45000) return (t - 18200) * 0.16;
  if (t <= 135000) return 4288 + (t - 45000) * 0.30;
  if (t <= 190000) return 31288 + (t - 135000) * 0.37;
  return 51638 + (t - 190000) * 0.45;
}
function medicare(t) {
  if (t <= 27222) return 0;
  if (t <= 34027) return (t - 27222) * 0.10;
  return t * 0.02;
}

const POISONS = [
  "POISON-PARTICIPANT-NAME",
  "POISON-NDIS-439991111",
  "POISON-NOTE-TEXT",
  "POISON-INCIDENT-DETAIL",
  "POISON-ADDRESS-99-SECRET-ST",
  "POISON-PHONE-0400000000",
  "poison-client@example.test",
  "POISON-PLAN-MANAGER",
  "POISON-PAYER-NAME",
  "POISON-DISABILITY-SUPPORT-DESC",
  "POISON-EXPENSE-DESC",
  "POISON-CATEGORY",
  "POISON-ODO-START",
  "POISON-TRAVEL-MINS",
  "POISON-INVOICE-CLIENT-FIELD",
  "POISON-LINE-CODE",
  "POISON-SERVICE-DATE",
  "POISON-WORKER-PHONE",
  "POISON-WORKER-EMAIL",
  "POISON-WORKER-BANK",
  "POISON-WORKER-ADDRESS",
  "POISON-METHOD",
  "POISON-SHIFT-NOTE",
  "Vehicle running costs",
];

const ALLOWED = new Set([
  "businessName", "tradingName", "abn", "fy", "fyLabel", "periodLabel", "periodStart", "periodEnd", "preparedOn",
  "income", "lines", "count", "totalReceived", "startingPoint", "countedForTax", "excludedCount", "startingPointSaved",
  "date", "invoiceNo", "paidDate", "amount", "invoiceTotal", "partPaid",
  "expenses", "byCategory", "category", "categoryGroup", "gstOnReceipt", "businessUsePct", "total",
  "vehicle", "method", "rateCents", "rateYear", "capKm", "loggedKm", "deductibleKm", "notCountedKm",
  "startingPointKm", "kmBeforeCap", "deduction", "overCap", "trips", "km", "counted", "logbook",
  "pct", "vehicleExpenses", "logbookEstimate", "centsEstimate", "difference", "vehicleGstCredit",
  "tax", "incomeCounted", "expensesCounted", "vehicleDeduction", "totalDeductions", "taxable",
  "incomeTax", "medicare", "setAside", "setAsideRounded", "effectivePct",
  "gst", "registered", "paidIncome", "gstDetected", "potentialCredits", "hypotheticalCredits",
  "turnoverFrom", "turnoverTo", "turnover", "threshold", "turnoverBand",
  "bas", "label", "rangeLabel", "due", "g1", "g3", "oneA", "g11", "oneB", "net",
]);

function assertShape(value, path) {
  if (Array.isArray(value)) {
    value.forEach((v, i) => assertShape(v, `${path}[${i}]`));
    return;
  }
  if (value && typeof value === "object") {
    for (const k of Object.keys(value)) {
      assert.ok(ALLOWED.has(k), `unexpected field ${path}.${k}`);
      assertShape(value[k], `${path}.${k}`);
    }
    return;
  }
  if (typeof value === "string") {
    for (const p of POISONS) assert.ok(!value.includes(p), `${path} leaked ${p}`);
  }
}

function sample(registered) {
  return {
    profile: {
      name: "Harbour Support",
      tradingName: "Harbour Trading",
      abn: "51 824 753 556",
      gstRegistered: registered,
      carMethod: "POISON-METHOD",
      carRate: 0.91,
      logbookPct: 50,
      phone: "POISON-WORKER-PHONE",
      email: "POISON-WORKER-EMAIL",
      bankName: "POISON-WORKER-BANK",
      bsb: "000-000",
      account: "12345678",
      address: "POISON-WORKER-ADDRESS",
    },
    participants: [{ id: "p1", name: "POISON-PARTICIPANT-NAME", ndisNumber: "POISON-NDIS-439991111", address: "POISON-ADDRESS-99-SECRET-ST", email: "poison-client@example.test", phone: "POISON-PHONE-0400000000", disability: "POISON-DISABILITY-SUPPORT-DESC" }],
    managers: [{ id: "m1", name: "POISON-PLAN-MANAGER", email: "poison-client@example.test", address: "POISON-ADDRESS-99-SECRET-ST" }],
    notes: [{ text: "POISON-NOTE-TEXT", body: "POISON-SHIFT-NOTE" }],
    incidents: [{ description: "POISON-INCIDENT-DETAIL", location: "POISON-ADDRESS-99-SECRET-ST", affectedName: "POISON-PARTICIPANT-NAME" }],
    shifts: [{ notes: "POISON-SHIFT-NOTE", participantId: "p1" }],
    priorTotals: { fy: 2025, income: 1000, expenses: 200, km: 10 },
    invoices: [
      {
        number: 14,
        status: "paid",
        date: "2025-08-01",
        paidAt: "2025-08-05",
        amountPaid: 80,
        participantId: "p1",
        client: "POISON-INVOICE-CLIENT-FIELD",
        notes: "POISON-NOTE-TEXT",
        billToName: "POISON-PAYER-NAME",
        lines: [{ qty: 2, rate: 50, desc: "POISON-DISABILITY-SUPPORT-DESC", code: "POISON-LINE-CODE", dates: ["POISON-SERVICE-DATE"] }],
      },
      {
        number: "POISON-PARTICIPANT-NAME",
        status: "paid",
        date: "2025-09-01",
        paidAt: "2025-09-02",
        participantId: "p1",
        lines: [{ qty: 1, rate: 20000, desc: "weekday support", code: "01_011_0107_1_1" }],
      },
      {
        number: 3,
        status: "sent",
        date: "2026-01-15",
        participantId: "p1",
        client: "POISON-INVOICE-CLIENT-FIELD",
        lines: [{ qty: 1, rate: 6543.21, desc: "POISON-DISABILITY-SUPPORT-DESC", code: "POISON-LINE-CODE" }],
      },
      {
        number: 9,
        status: "paid",
        date: "2025-06-30",
        lines: [{ qty: 1, rate: 999 }],
      },
      {
        number: 8,
        status: "paid",
        date: "2026-07-01",
        lines: [{ qty: 1, rate: 888 }],
      },
    ],
    expenses: [
      { date: "2025-08-02", cat: "Phone", desc: "POISON-EXPENSE-DESC for POISON-PARTICIPANT-NAME", amount: 100, gstAmount: 10, businessUsePct: 80 },
      { date: "2025-08-03", cat: "Vehicle running costs", desc: "POISON-EXPENSE-DESC", amount: 40, gstAmount: 4, businessUsePct: 100 },
      { date: "2025-08-04", cat: "POISON-CATEGORY", desc: "POISON-EXPENSE-DESC", amount: 5, gstAmount: 0 },
      { date: "2024-08-01", cat: "Fuel", desc: "POISON-EXPENSE-DESC", amount: 70 },
    ],
    trips: [
      { date: "2025-08-06", km: 100, taxDeductible: true, participantId: "p1", odoStart: "POISON-ODO-START", odoEnd: "999", travelMins: "POISON-TRAVEL-MINS", billable: true },
      { date: "2025-08-07", km: 15, taxDeductible: false, participantId: "p1" },
    ],
  };
}

const opts = { asOf: "2026-11-06", carRateDefault: 0.91, carCap: 5000, carYear: "2026-27", gstThreshold: 75000 };

const pack = buildAccountantPack(sample(true), 2025, opts);
assertShape(pack, "pack");
const text = accountantPackText(pack).join("\n");
for (const p of POISONS) assert.ok(!text.includes(p), `text leaked ${p}`);
assert.ok(text.includes("Harbour Support"));
assert.ok(text.includes("Harbour Trading"));
assert.ok(text.includes("51 824 753 556"));
assert.ok(!text.includes("POISON-WORKER-PHONE"));
assert.ok(text.includes("Other vehicle expense"));
assert.ok(text.includes("Other business expense"));
assert.ok(!text.includes("01_011_0107_1_1"));

// Paid received: part-paid 80 + full 20000. Prior income 1000.
assert.equal(pack.income.totalReceived, 20080);
assert.equal(pack.income.countedForTax, 21080);
assert.equal(pack.income.excludedCount, 1);
assert.equal(pack.income.lines.length, 2);
assert.equal(pack.income.lines[0].invoiceNo, "14");
assert.equal(pack.income.lines[0].partPaid, true);
assert.equal(pack.income.lines[1].invoiceNo, "");
assert.equal(pack.expenses.total, 145);
assert.equal(pack.vehicle.loggedKm, 115);
assert.equal(pack.vehicle.deductibleKm, 100);
assert.equal(pack.vehicle.startingPointKm, 10);
assert.equal(pack.vehicle.method, "cents");
// (100 + 10) km * 0.91
assert.ok(Math.abs(pack.vehicle.deduction - 100.1) < 0.001);
const taxable = 21080 - (145 + 200) - 100.1;
assert.ok(Math.abs(pack.tax.taxable - taxable) < 0.001);
assert.ok(Math.abs(pack.tax.incomeTax - incomeTax(taxable)) < 0.001);
assert.ok(Math.abs(pack.tax.medicare - medicare(taxable)) < 0.001);
assert.ok(text.includes(pack.tax.setAside.toFixed(2)));

// Other financial years are not itemised. 888 is inside the rolling GST window, so it may sit in that one total.
assert.ok(!text.includes("999"));
assert.equal(pack.income.lines.some((l) => Math.abs(l.invoiceTotal - 888) < 0.001 || Math.abs(l.invoiceTotal - 999) < 0.001), false);
assert.equal(pack.expenses.lines.some((l) => Math.abs(l.amount - 70) < 0.001), false);
assert.ok(!text.includes("$70.00"));

// Unpaid 6543.21 is in rolling turnover, not in the paid list.
assert.ok(pack.gst.turnover >= 6543.21);
assert.equal(pack.income.lines.some((l) => Math.abs(l.amount - 6543.21) < 0.001), false);

// BAS uses invoice total for the part-paid invoice (100), not 80, plus 20000.
assert.ok(pack.bas);
const g1 = pack.bas.reduce((s, q) => s + q.g1, 0);
assert.ok(Math.abs(g1 - 20100) < 0.001);
assert.ok(text.includes("Total sales (G1)"));
// Phone GST credit 10 * 80% = 8. Vehicle running costs are vehicle, so not in non-vehicle credits.
// logbook pct is ignored because poisoned method normalised to cents, and logbook block needs method logbook? 
// Wait: normalMethod("POISON-METHOD") is "cents", methodOn true, logbookPct 50 > 0, so logbook IS included.
assert.ok(pack.vehicle.logbook);
assert.equal(pack.vehicle.logbook.pct, 50);
assert.equal(pack.vehicle.logbook.vehicleExpenses, 40);

const off = buildAccountantPack({
  ...sample(false),
  profile: { ...sample(false).profile, gstRegistered: false, carMethod: "off", logbookPct: 0 },
}, 2025, opts);
const offText = accountantPackText(off).join("\n");
for (const p of POISONS) assert.ok(!offText.includes(p), `off text leaked ${p}`);
assert.equal(off.bas, null);
assert.ok(offText.includes("BAS quarters are not included"));
assert.ok(!offText.includes("Total sales (G1)"));
assert.equal(off.vehicle.deduction, 0);
assert.equal(off.tax.vehicleDeduction, 0);

const otherYear = buildAccountantPack(sample(true), 2024, opts);
assert.equal(otherYear.income.startingPoint, 0);
assert.equal(otherYear.income.lines.length, 1);
assert.equal(otherYear.income.totalReceived, 999);
assert.equal(otherYear.expenses.total, 70);

const years = accountantPackYears(sample(true), 2026);
assert.ok(years.includes(2026) && years.includes(2025) && years.includes(2024));
assert.equal(accountantPackFilename(2025), "supportflow-accountant-pack-2025-26.pdf");

const src = fs.readFileSync(new URL("./accountant-pack.js", import.meta.url), "utf8");
for (const needle of [
  "data.participants", "data.managers", "data.notes", "data.incidents", "data.shifts", "data.clients",
  ".desc", ".notes", "ndisNumber", "participantId", ".client", "billTo", "profile.address", "profile.email", "profile.phone",
  "affectedName", "odoStart", "travelMins", "bankName", "profile.bsb", "profile.account",
]) {
  assert.ok(!src.includes(needle), `accountant-pack.js reads ${needle}`);
}

// A plain taxable example: 20000 income, 1000 expenses, 100 km at 91c.
const plain = buildAccountantPack({
  profile: { name: "A", abn: "12345678901", carMethod: "cents", carRate: 0.91 },
  invoices: [{ status: "paid", date: "2025-08-01", number: 1, lines: [{ qty: 1, rate: 20000 }] }],
  expenses: [{ date: "2025-08-02", cat: "Phone", amount: 1000 }],
  trips: [{ date: "2025-08-03", km: 100, taxDeductible: true }],
}, 2025, opts);
const expectTaxable = 20000 - 1000 - 91;
assert.ok(Math.abs(plain.tax.taxable - expectTaxable) < 0.001);
assert.ok(Math.abs(plain.tax.setAside - (incomeTax(expectTaxable) + medicare(expectTaxable))) < 0.001);
assert.equal(medicare(expectTaxable), 0);
assert.ok(Math.abs(incomeTax(expectTaxable) - (expectTaxable - 18200) * 0.16) < 0.001);

const app = fs.readFileSync(new URL("./app.jsx", import.meta.url), "utf8");
const drawAt = app.indexOf("function drawAccountantPack");
const invoiceAt = app.indexOf("async function makeInvoicePDF");
assert.ok(drawAt > 0 && invoiceAt > drawAt);
const drawer = app.slice(drawAt, invoiceAt);
for (const needle of ["data.participants", "data.incidents", "makeIncidentRegisterPDF", ".desc", "ndisNumber", "data.notes", "data.managers"]) {
  assert.ok(!drawer.includes(needle), `PDF drawer reads ${needle}`);
}
assert.ok(drawer.includes("accountantPackText"));
assert.ok(!drawer.includes("doc.save") || drawer.includes("filename"));

console.log("accountant pack tests pass");
