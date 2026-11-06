// Accountant pack for one Australian financial year (1 July–30 June).
//
// ONE source of truth for what the PDF may contain. build-app.mjs inlines
// this file into app.jsx between the @@ACCOUNTANT_PACK markers. The PDF
// drawer prints accountantPackText() plus ACCOUNTANT_PACK_FOOTER and a
// page number. It must not read invoices, expenses, trips, or the profile
// itself.
//
// Privacy: never read participant, client, plan manager, note, incident,
// shift, address, contact, NDIS number, support description, or item code
// fields. Free-text expense descriptions and raw category strings are
// dropped. Only the worker's business name, trading name, and ABN are
// copied off the profile, plus the tax flags and rates named below.
//
// Figures follow Money → Tax and Money → BAS in app.jsx:
//   incomeTax, medicare, gstCreditFor, carDeduction, gstTurnover, BAS().

export const ACCOUNTANT_PACK_FOOTER = "SupportFlow accountant pack. No participant or client personal information.";

// Wrapped so the helpers do not collide with names already used in app.jsx
// (incomeTax, inFY, MONTHS, gstCreditFor, and the rest) when this file is inlined.
const acctPack = (() => {
const VEHICLE_CATS = [
  "Fuel", "EV charging", "Servicing", "Repairs", "Tyres", "Vehicle registration",
  "Vehicle insurance", "Car wash / cleaning", "Tolls", "Parking",
  "Vehicle lease / rental", "Vehicle finance interest", "Vehicle accessories",
  "Other vehicle expense",
];
const WORK_CATS = [
  "Training / Courses", "PPE", "First aid supplies", "Cleaning / sanitation supplies",
  "Work equipment", "Phone", "Internet", "Software / subscriptions",
  "Accounting / bookkeeping", "Professional fees", "Training / professional development",
  "Business insurance", "Police checks / screening", "Printing / stationery",
  "Office supplies", "Other business expense",
];
const SAFE_CATS = new Set([...VEHICLE_CATS, ...WORK_CATS]);
const CAT_ALIASES = {
  "Vehicle running costs": "Other vehicle expense",
  "Phone & internet": "Phone",
  "Equipment & PPE": "PPE",
  "Registration & checks": "Police checks / screening",
};

const num = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};
const clampPct = (v) => Math.max(0, Math.min(100, num(v)));

function invoiceTotal(inv) {
  return (inv.lines || []).reduce((s, l) => s + num(l.qty) * num(l.rate), 0);
}
function hasAmountPaid(inv) {
  return inv.amountPaid != null && inv.amountPaid !== "" && Number.isFinite(Number(inv.amountPaid));
}
function amountPaid(inv) {
  if (inv.status !== "paid") return 0;
  return hasAmountPaid(inv) ? num(inv.amountPaid) : invoiceTotal(inv);
}
function isPartPaid(inv) {
  return inv.status === "paid" && hasAmountPaid(inv) && num(inv.amountPaid) + 0.005 < invoiceTotal(inv);
}

// Copied from app.jsx so the pack matches Money → Tax.
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
function gstCreditFor(expense, gstRegistered) {
  if (!gstRegistered) return 0;
  const gst = num(expense.gstAmount);
  if (gst <= 0) return 0;
  const pct = expense.businessUsePct === "" || expense.businessUsePct == null ? 100 : clampPct(expense.businessUsePct);
  return gst * (pct / 100);
}
function carDeduction(km, rate, cap) {
  return Math.min(num(km), num(cap)) * num(rate);
}

function fyOfDate(d) {
  if (!d || !/^\d{4}-\d{2}-\d{2}/.test(String(d))) return null;
  const [y, m] = String(d).slice(0, 10).split("-").map(Number);
  if (!y || !m) return null;
  return m >= 7 ? y : y - 1;
}
const inFY = (d, y) => fyOfDate(d) === Number(y);

function financialYearLabel(y) {
  return `${y}\u2013${String(Number(y) + 1).slice(2)}`;
}
function financialYearPeriod(y) {
  return `1 July ${y} \u2013 30 June ${Number(y) + 1}`;
}
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
function auDate(iso) {
  if (!iso || !/^\d{4}-\d{2}-\d{2}/.test(String(iso))) return "";
  const [y, m, d] = String(iso).slice(0, 10).split("-").map(Number);
  if (!y || !m || !d || m < 1 || m > 12) return "";
  return `${d} ${MONTHS[m - 1]} ${y}`;
}
function aud(n) {
  const v = num(n);
  const sign = v < 0 ? "-" : "";
  return sign + "$" + Math.abs(v).toLocaleString("en-AU", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function kmText(n) {
  return num(n).toLocaleString("en-AU", { minimumFractionDigits: 0, maximumFractionDigits: 1 }) + " km";
}
function centsText(rate) {
  const c = Math.round(num(rate) * 100 * 100) / 100;
  const body = Number.isInteger(c) ? String(c) : String(c);
  return `${body}c per kilometre`;
}
function safeInvoiceNo(n) {
  const s = String(n ?? "").trim();
  return /^\d{1,12}$/.test(s) ? s : "";
}
function safeAbn(v) {
  const d = String(v || "").replace(/\D/g, "");
  if (d.length !== 11) return d ? d : "";
  return `${d.slice(0, 2)} ${d.slice(2, 5)} ${d.slice(5, 8)} ${d.slice(8, 11)}`;
}
function oneLine(v, max) {
  return String(v || "").replace(/\s+/g, " ").trim().slice(0, max);
}
function safeCategory(cat) {
  const mapped = CAT_ALIASES[cat] || cat;
  return SAFE_CATS.has(mapped) ? mapped : "Other business expense";
}
function categoryGroup(cat) {
  return VEHICLE_CATS.includes(safeCategory(cat)) ? "Vehicle" : "Work";
}
function normalMethod(v) {
  if (v === "off" || v === "logbook" || v === "cents") return v;
  return "cents";
}
function safeRateYear(v) {
  const s = String(v || "").trim();
  return /^\d{4}[-\u2013]\d{2}$/.test(s) ? s : "";
}
function businessUseShown(expense) {
  if (expense.businessUsePct === "" || expense.businessUsePct == null) return 100;
  return clampPct(expense.businessUsePct);
}

function basQuarters(fy) {
  const y = Number(fy);
  return [
    { label: "Q1", rangeLabel: `Jul\u2013Sep ${y}`, start: `${y}-07-01`, end: `${y}-09-30`, due: `${y}-10-28` },
    { label: "Q2", rangeLabel: `Oct\u2013Dec ${y}`, start: `${y}-10-01`, end: `${y}-12-31`, due: `${y + 1}-02-28` },
    { label: "Q3", rangeLabel: `Jan\u2013Mar ${y + 1}`, start: `${y + 1}-01-01`, end: `${y + 1}-03-31`, due: `${y + 1}-04-28` },
    { label: "Q4", rangeLabel: `Apr\u2013Jun ${y + 1}`, start: `${y + 1}-04-01`, end: `${y + 1}-06-30`, due: `${y + 1}-07-28` },
  ];
}

// Same window as gstTurnover() in app.jsx, including its local-Date toISOString step.
function rollingTurnover(invoices, asOf) {
  const end = new Date(asOf + "T00:00:00");
  const start = new Date(end);
  start.setMonth(start.getMonth() - 11);
  start.setDate(1);
  const from = start.toISOString().slice(0, 10);
  const total = (invoices || []).filter((i) => i.date && i.date >= from).reduce((n, i) => n + invoiceTotal(i), 0);
  return { from, total };
}

function accountantPackYears(data, currentFy) {
  const current = Number(currentFy);
  const years = new Set([current, current - 1]);
  const src = data || {};
  const add = (d) => {
    const y = fyOfDate(d);
    if (y != null) years.add(y);
  };
  (src.invoices || []).forEach((i) => add(i.date));
  (src.expenses || []).forEach((e) => add(e.date));
  (src.trips || []).forEach((t) => add(t.date));
  if (src.priorTotals && src.priorTotals.fy != null && Number.isFinite(Number(src.priorTotals.fy))) {
    years.add(Number(src.priorTotals.fy));
  }
  return [...years].filter((y) => y >= current - 7 && y <= current + 1).sort((a, b) => b - a);
}

function accountantPackFilename(fy) {
  return `supportflow-accountant-pack-${financialYearLabel(fy).replace("\u2013", "-")}.pdf`;
}

function buildAccountantPack(data, fy, opts) {
  const options = opts || {};
  const year = Number(fy);
  const asOf = /^\d{4}-\d{2}-\d{2}/.test(String(options.asOf || "")) ? String(options.asOf).slice(0, 10) : "";
  const cap = num(options.carCap != null ? options.carCap : 5000);
  const defaultRate = num(options.carRateDefault != null ? options.carRateDefault : 0.91);
  const threshold = num(options.gstThreshold != null ? options.gstThreshold : 75000);
  const profile = data && data.profile && typeof data.profile === "object" ? data.profile : {};
  const invoices = data && Array.isArray(data.invoices) ? data.invoices : [];
  const expenses = data && Array.isArray(data.expenses) ? data.expenses : [];
  const trips = data && Array.isArray(data.trips) ? data.trips : [];

  const method = normalMethod(profile.carMethod);
  const methodOn = method !== "off";
  const rate = profile.carRate != null && profile.carRate !== "" && Number.isFinite(Number(profile.carRate))
    ? num(profile.carRate)
    : defaultRate;
  const logbookPct = num(profile.logbookPct);
  const gstRegistered = !!profile.gstRegistered;
  const prior = data && data.priorTotals && Number(data.priorTotals.fy) === year ? data.priorTotals : null;
  const priorIncome = prior ? num(prior.income) : 0;
  const priorExpenses = prior ? num(prior.expenses) : 0;
  const priorKm = prior ? num(prior.km) : 0;

  const inYear = (row) => inFY(row && row.date, year);
  const paid = invoices.filter((i) => inYear(i) && i.status === "paid");
  const incomeLines = paid
    .slice()
    .sort((a, b) => String(a.date).localeCompare(String(b.date)) || String(a.number ?? "").localeCompare(String(b.number ?? "")))
    .map((i) => ({
      date: auDate(i.date),
      invoiceNo: safeInvoiceNo(i.number),
      paidDate: auDate(i.paidAt),
      amount: amountPaid(i),
      invoiceTotal: invoiceTotal(i),
      partPaid: isPartPaid(i),
    }));
  const totalReceived = incomeLines.reduce((s, l) => s + l.amount, 0);
  const excludedCount = invoices.filter((i) => inYear(i) && i.status !== "paid").length;

  const expenseRows = expenses.filter(inYear);
  const expenseLines = expenseRows
    .slice()
    .sort((a, b) => String(a.date).localeCompare(String(b.date)) || safeCategory(a.cat).localeCompare(safeCategory(b.cat)))
    .map((e) => ({
      date: auDate(e.date),
      category: safeCategory(e.cat),
      categoryGroup: categoryGroup(e.cat),
      amount: num(e.amount),
      gstOnReceipt: num(e.gstAmount),
      businessUsePct: businessUseShown(e),
    }));
  const expenseTotal = expenseLines.reduce((s, l) => s + l.amount, 0);
  const byCategoryMap = {};
  expenseLines.forEach((l) => {
    const key = l.category + "\t" + l.categoryGroup;
    byCategoryMap[key] = (byCategoryMap[key] || 0) + l.amount;
  });
  const byCategory = Object.entries(byCategoryMap)
    .map(([key, amount]) => {
      const [category, categoryGroupName] = key.split("\t");
      return { category, categoryGroup: categoryGroupName, amount };
    })
    .sort((a, b) => b.amount - a.amount || (a.category < b.category ? -1 : 1));

  const tripRows = trips.filter(inYear);
  const tripLines = tripRows
    .slice()
    .sort((a, b) => String(a.date).localeCompare(String(b.date)))
    .map((t) => ({
      date: auDate(t.date),
      km: num(t.km),
      counted: t.taxDeductible !== false,
    }));
  const loggedKm = tripLines.reduce((s, t) => s + t.km, 0);
  const deductibleKm = tripLines.filter((t) => t.counted).reduce((s, t) => s + t.km, 0);
  const kmBeforeCap = deductibleKm + priorKm;
  const deduction = methodOn ? carDeduction(kmBeforeCap, rate, cap) : 0;

  const vehicleExpenseRows = expenseRows.filter((e) => categoryGroup(e.cat) === "Vehicle");
  const vehicleExpenses = vehicleExpenseRows.reduce((s, e) => s + num(e.amount), 0);
  const vehicleGstFY = vehicleExpenseRows.reduce((s, e) => s + gstCreditFor(e, gstRegistered), 0);
  const centsEstimate = carDeduction(kmBeforeCap, rate, cap);
  const logbook = methodOn && logbookPct > 0 ? {
    pct: clampPct(logbookPct),
    vehicleExpenses,
    logbookEstimate: (clampPct(logbookPct) / 100) * vehicleExpenses,
    centsEstimate,
    difference: (clampPct(logbookPct) / 100) * vehicleExpenses - centsEstimate,
    vehicleGstCredit: gstRegistered ? (clampPct(logbookPct) / 100) * vehicleGstFY : null,
  } : null;

  const incomeCounted = totalReceived + priorIncome;
  const expensesCounted = expenseTotal + priorExpenses;
  const totalDeductions = expensesCounted + deduction;
  const taxable = Math.max(0, incomeCounted - totalDeductions);
  const taxAmount = incomeTax(taxable);
  const medicareAmount = medicare(taxable);
  const setAside = taxAmount + medicareAmount;

  const gstDetected = expenseRows.reduce((s, e) => s + num(e.gstAmount), 0);
  const nonVehicleCredit = expenseRows
    .filter((e) => categoryGroup(e.cat) !== "Vehicle")
    .reduce((s, e) => s + gstCreditFor(e, gstRegistered), 0);
  const vehicleGstCredit = logbook && logbook.vehicleGstCredit != null ? logbook.vehicleGstCredit : 0;
  const potentialCredits = nonVehicleCredit + vehicleGstCredit;
  const hypotheticalNonVehicle = expenseRows
    .filter((e) => categoryGroup(e.cat) !== "Vehicle")
    .reduce((s, e) => s + gstCreditFor(e, true), 0);
  const hypotheticalVehicle = logbookPct > 0 ? (clampPct(logbookPct) / 100) * vehicleGstFY : 0;
  const hypotheticalCredits = hypotheticalNonVehicle + hypotheticalVehicle;

  const roll = asOf ? rollingTurnover(invoices, asOf) : { from: "", total: 0 };
  let turnoverBand = "under";
  if (roll.total >= threshold) turnoverBand = "over";
  else if (threshold > 0 && roll.total >= threshold * 0.8) turnoverBand = "near";

  let bas = null;
  if (gstRegistered) {
    bas = basQuarters(year).map((q) => {
      const inQ = (d) => d && d >= q.start && d <= q.end;
      const paidQ = invoices.filter((i) => i.status === "paid" && inQ(i.date));
      const expQ = expenses.filter((e) => inQ(e.date));
      const g1 = paidQ.reduce((s, i) => s + invoiceTotal(i), 0);
      const g11 = expQ.reduce((s, e) => s + num(e.amount), 0);
      const oneB = expQ.reduce((s, e) => s + gstCreditFor(e, true), 0);
      return {
        label: q.label,
        rangeLabel: q.rangeLabel,
        due: q.due,
        g1,
        g3: g1,
        oneA: 0,
        g11,
        oneB,
        net: oneB - 0,
      };
    });
  }

  return {
    businessName: oneLine(profile.name, 120),
    tradingName: oneLine(profile.tradingName, 120),
    abn: safeAbn(profile.abn),
    fy: year,
    fyLabel: financialYearLabel(year),
    periodLabel: financialYearPeriod(year),
    periodStart: `${year}-07-01`,
    periodEnd: `${year + 1}-06-30`,
    preparedOn: asOf,
    income: {
      lines: incomeLines,
      count: incomeLines.length,
      totalReceived,
      startingPoint: priorIncome,
      countedForTax: incomeCounted,
      excludedCount,
      startingPointSaved: !!prior,
    },
    expenses: {
      lines: expenseLines,
      byCategory,
      count: expenseLines.length,
      total: expenseTotal,
      startingPoint: priorExpenses,
      countedForTax: expensesCounted,
      startingPointSaved: !!prior,
    },
    vehicle: {
      method,
      rateCents: Math.round(rate * 100 * 100) / 100,
      rateYear: safeRateYear(options.carYear),
      capKm: cap,
      loggedKm,
      deductibleKm,
      notCountedKm: loggedKm - deductibleKm,
      startingPointKm: priorKm,
      kmBeforeCap,
      deduction,
      overCap: kmBeforeCap > cap,
      trips: tripLines,
      logbook,
    },
    tax: {
      incomeCounted,
      expensesCounted,
      vehicleDeduction: deduction,
      totalDeductions,
      taxable,
      incomeTax: taxAmount,
      medicare: medicareAmount,
      setAside,
      setAsideRounded: Math.round(setAside),
      effectivePct: taxable > 0 ? (setAside / taxable) * 100 : 0,
    },
    gst: {
      registered: gstRegistered,
      paidIncome: totalReceived,
      gstDetected,
      potentialCredits,
      hypotheticalCredits,
      turnoverFrom: roll.from,
      turnoverTo: asOf,
      turnover: roll.total,
      threshold,
      turnoverBand,
    },
    bas,
  };
}

function moneyLine(label, amount) {
  return `${label}: ${aud(amount)}`;
}

function accountantPackText(pack) {
  const lines = [];
  const push = (s) => lines.push(s);
  push("# Accountant pack");
  push(pack.preparedOn ? `Prepared ${auDate(pack.preparedOn)}` : "Prepared from SupportFlow records on this device");
  push("This PDF is a record of figures kept in SupportFlow for your accountant. It is not a tax return, not a BAS lodgement, and not tax advice.");
  push("Privacy: this pack excludes participant and client personal information. It does not include names, NDIS numbers, notes, incident details, addresses, contact details, plan manager or payer names, or anything about a person's disability or supports.");
  push("");
  push("## Business");
  push(`Business name: ${pack.businessName || "Not recorded"}`);
  if (pack.tradingName) push(`Trading name: ${pack.tradingName}`);
  push(`ABN: ${pack.abn || "Not recorded"}`);
  push("");
  push("## Period");
  push(`Financial year: ${pack.fyLabel}`);
  push(`From: ${auDate(pack.periodStart)}`);
  push(`To: ${auDate(pack.periodEnd)}`);
  push("Australian financial year, 1 July to 30 June.");
  push("");
  push("## Income");
  push("Paid invoices only. The date is the invoice date. Received is the amount recorded when the invoice was marked paid. Invoice total is the sum of quantity times rate. Unpaid invoices are not listed. No payer, participant, description, or item code is shown.");
  if (pack.income.startingPointSaved) push(moneyLine("Starting point income (Settings, this financial year only, not an invoice)", pack.income.startingPoint));
  push(`Paid invoices: ${pack.income.count}`);
  push(moneyLine("Total received", pack.income.totalReceived));
  push(moneyLine("Income counted for tax", pack.income.countedForTax));
  push(`Invoices in this year not marked paid, excluded from income: ${pack.income.excludedCount}`);
  push("### Paid invoices");
  if (!pack.income.lines.length) push("None.");
  pack.income.lines.forEach((l) => {
    const bits = [l.date || "Date not recorded"];
    if (l.invoiceNo) bits.push(`Invoice ${l.invoiceNo}`);
    bits.push(l.paidDate ? `Paid ${l.paidDate}` : "Paid date not recorded");
    bits.push(`Received ${aud(l.amount)}`);
    bits.push(`Invoice total ${aud(l.invoiceTotal)}`);
    bits.push(l.partPaid ? "Part paid: Yes" : "Part paid: No");
    push(bits.join(" · "));
  });
  push("");
  push("## Expenses");
  push("The words typed into an expense are not shown. Only a category from the app's fixed list is shown, with the date and amount entered.");
  if (pack.expenses.startingPointSaved) push(moneyLine("Starting point expenses (Settings, this financial year only)", pack.expenses.startingPoint));
  push(`Logged expenses: ${pack.expenses.count}`);
  push(moneyLine("Total logged", pack.expenses.total));
  push(moneyLine("Expenses counted for tax", pack.expenses.countedForTax));
  push("### By category");
  if (!pack.expenses.byCategory.length) push("None.");
  pack.expenses.byCategory.forEach((c) => {
    push(`${c.category} · ${c.categoryGroup} · ${aud(c.amount)}`);
  });
  push("### Expense lines");
  if (!pack.expenses.lines.length) push("None.");
  pack.expenses.lines.forEach((l) => {
    push(`${l.date || "Date not recorded"} · ${l.category} · ${l.categoryGroup} · Amount ${aud(l.amount)} · GST on receipt ${aud(l.gstOnReceipt)} · Business use ${l.businessUsePct}%`);
  });
  push("");
  push("## Vehicle");
  const methodLabel = pack.vehicle.method === "off" ? "Not calculated" : pack.vehicle.method === "logbook" ? "Logbook" : "Cents per kilometre";
  push(`Method in Settings: ${methodLabel}`);
  push(`Cents per kilometre rate: ${centsText(pack.vehicle.rateCents / 100)}`);
  if (pack.vehicle.rateYear) push(`Rate year: ${pack.vehicle.rateYear}`);
  push(`Cap: ${kmText(pack.vehicle.capKm)}`);
  push(`Kilometres logged: ${kmText(pack.vehicle.loggedKm)}`);
  push(`Kilometres counted for the deduction: ${kmText(pack.vehicle.deductibleKm)}`);
  push(`Kilometres not counted: ${kmText(pack.vehicle.notCountedKm)}`);
  if (pack.income.startingPointSaved || pack.vehicle.startingPointKm) push(`Starting point kilometres: ${kmText(pack.vehicle.startingPointKm)}`);
  push(`Kilometres used before the cap: ${kmText(pack.vehicle.kmBeforeCap)}`);
  push(moneyLine("Deduction included in the set-aside", pack.vehicle.deduction));
  push(`Over the cap: ${pack.vehicle.overCap ? "Yes" : "No"}`);
  if (pack.vehicle.method === "off") {
    push("Vehicle calculation is off in Settings, so the set-aside includes no cents-per-kilometre deduction. Kilometres are still listed.");
  } else {
    push("The cents-per-kilometre rate already includes fuel, servicing, registration, insurance, and depreciation. Those costs should not also be claimed as separate expenses.");
    push("If vehicle costs are also listed under Expenses, the set-aside has subtracted them as well as this deduction. Money → Tax does the same. Do not claim both.");
    if (pack.vehicle.overCap) push("Counted kilometres are over the cap, so this method stops at the cap. A logbook method is not capped. That is a question for a registered tax agent.");
  }
  if (pack.vehicle.method === "logbook") {
    push("Money → Tax still subtracts the cents-per-kilometre deduction while vehicle calculation is on. A logbook amount below is the comparison estimate on that screen. It is not swapped into the set-aside.");
  }
  if (pack.vehicle.logbook) {
    const g = pack.vehicle.logbook;
    push("### Logbook comparison");
    push(`Business-use percentage: ${g.pct}%`);
    push(moneyLine("Vehicle expenses logged", g.vehicleExpenses));
    push(moneyLine("Logbook estimate", g.logbookEstimate));
    push(moneyLine("Cents per kilometre estimate", g.centsEstimate));
    push(`Difference (logbook estimate minus cents per kilometre): ${aud(g.difference)}`);
    if (g.vehicleGstCredit != null) {
      push(moneyLine("Potential GST credit on vehicle expenses, logbook percentage", g.vehicleGstCredit));
      push("The app shows this credit only for the logbook comparison. The cents-per-kilometre rate is not a GST purchase.");
    } else {
      push("Potential GST credit on vehicle expenses: not applied.");
    }
  } else if (pack.vehicle.method === "logbook") {
    push("No business-use percentage is saved, so there is no logbook estimate.");
  }
  push("### Trips");
  push("Each trip is the date, the kilometres, and whether it was counted. Who it was for, odometer readings, and travel time are not shown.");
  if (!pack.vehicle.trips.length) push("None.");
  pack.vehicle.trips.forEach((t) => {
    push(`${t.date || "Date not recorded"} · ${kmText(t.km)} · Counted: ${t.counted ? "Yes" : "No"}`);
  });
  push("");
  push("## Tax set-aside");
  push(moneyLine("Income counted", pack.tax.incomeCounted));
  push(moneyLine("Expenses counted", pack.tax.expensesCounted));
  push(moneyLine("Vehicle deduction", pack.tax.vehicleDeduction));
  push(moneyLine("Total deductions", pack.tax.totalDeductions));
  push(moneyLine("Taxable income", pack.tax.taxable));
  push(moneyLine("Income tax", pack.tax.incomeTax));
  push(moneyLine("Medicare levy", pack.tax.medicare));
  push(moneyLine("Set aside", pack.tax.setAside));
  push(`Set aside rounded to the nearest dollar, as on Money → Tax: ${aud(pack.tax.setAsideRounded)}`);
  push(`Effective rate on taxable income: ${pack.tax.effectivePct.toFixed(1)}%`);
  push("Worked out as paid amounts received, plus starting-point income for this year, minus logged expenses, starting-point expenses, and the vehicle deduction above.");
  push("Estimates use 2025–26 resident rates and ignore other income, HELP debt and PAYG instalments. Confirm with a registered tax agent.");
  push("");
  push("## GST");
  push(`GST registered: ${pack.gst.registered ? "Yes" : "No"}`);
  push(moneyLine(pack.gst.registered ? "GST-free income (paid invoices, amount received)" : "Income (paid invoices, amount received)", pack.gst.paidIncome));
  push(moneyLine("GST detected on expenses (as entered on receipts)", pack.gst.gstDetected));
  if (pack.gst.registered) {
    push(moneyLine("Potential GST credits (same rule as Money → Tax)", pack.gst.potentialCredits));
    push("Potential GST credits count non-vehicle expenses at the business-use percentage. Vehicle GST is included only as the logbook percentage of vehicle GST, and only when that percentage is saved. This matches Money → Tax.");
  } else {
    push(moneyLine("Estimated GST credits if registered (same rule as Money → Tax)", pack.gst.hypotheticalCredits));
    push("GST registration is off, so Money → Tax does not treat these as credits you can claim. Qualifying NDIS supports stay GST-free either way. This is an estimate from records in the app.");
  }
  if (pack.gst.turnoverTo) {
    push(moneyLine("Rolling 12-month turnover", pack.gst.turnover));
    push(`Turnover window: ${auDate(pack.gst.turnoverFrom) || pack.gst.turnoverFrom} to ${auDate(pack.gst.turnoverTo)}`);
    push(moneyLine("GST registration threshold", pack.gst.threshold));
    const band = pack.gst.turnoverBand === "over"
      ? "At or over the threshold"
      : pack.gst.turnoverBand === "near"
        ? "At or above 80% of the threshold"
        : "Under the threshold";
    push(`Threshold position: ${band}`);
    push("This turnover is every invoice dated in that window, paid or not, at the invoice total. It is the app's GST threshold check. It is not limited to this financial year, and it is not the paid-income total above.");
  }
  push("");
  push("## BAS");
  if (!pack.bas) {
    push("BAS quarters are not included because GST registration is off in Settings. Money → BAS is hidden in that case.");
  } else {
    push("Same figures as Money → BAS, cash basis. A paid invoice counts on its invoice date at the invoice total, including a part payment. Expenses count on the expense date. Starting-point amounts are not included here. They are included in the tax set-aside.");
    const sum = (key) => pack.bas.reduce((s, q) => s + num(q[key]), 0);
    push(moneyLine("Full year total sales (G1)", sum("g1")));
    push(moneyLine("Full year GST-free sales (G3)", sum("g3")));
    push(moneyLine("Full year GST on sales (1A)", sum("oneA")));
    push(moneyLine("Full year non-capital purchases (G11)", sum("g11")));
    push(moneyLine("Full year GST credits (1B)", sum("oneB")));
    push("BAS 1B credits the GST recorded on each expense, including vehicle expenses, at that expense's business-use percentage. That can differ from Potential GST credits above, which is how Money → BAS differs from Money → Tax.");
    pack.bas.forEach((q) => {
      push(`### ${q.label} ${q.rangeLabel}`);
      push(`Due: ${auDate(q.due) || q.due}`);
      push(moneyLine("Total sales (G1)", q.g1));
      push(moneyLine("GST-free sales (G3)", q.g3));
      push(moneyLine("GST on sales (1A)", q.oneA));
      push(moneyLine("Non-capital purchases (G11)", q.g11));
      push(moneyLine("GST credits (1B)", q.oneB));
      if (q.net > 0) push(moneyLine("GST refund (1B minus 1A)", q.net));
      else if (q.net < 0) push(moneyLine("GST payable (1A minus 1B)", Math.abs(q.net)));
      else push("Net GST: $0.00");
    });
    push("These are a reference from SupportFlow records. They are not lodged figures.");
  }
  push("");
  push("## Left out on purpose");
  push("Participant and client names.");
  push("NDIS numbers.");
  push("Notes, invoice notes, and expense descriptions.");
  push("Incident records.");
  push("Addresses and contact details.");
  push("Plan manager and payer names.");
  push("Support descriptions, item codes, and disability information.");
  push("Who a trip was for, odometer readings, and travel time.");
  push("Bank account details.");
  push("The worker's phone number and email are not on this pack. Business name, trading name, and ABN are.");
  return lines;
}

return { buildAccountantPack, accountantPackText, accountantPackFilename, accountantPackYears, financialYearPeriod };
})();

export const buildAccountantPack = acctPack.buildAccountantPack;
export const accountantPackText = acctPack.accountantPackText;
export const accountantPackFilename = acctPack.accountantPackFilename;
export const accountantPackYears = acctPack.accountantPackYears;
export const financialYearPeriod = acctPack.financialYearPeriod;
