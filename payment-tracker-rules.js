// SupportFlow Payment tracker: shared rules (business days, chase stages,
// message templates). ONE source of truth: imported by the Netlify functions
// (netlify/lib/tracker.mjs) and inlined into app.jsx by build-app.mjs between
// the @@TRACKER_RULES markers. Keep it dependency-free plain JS.
//
// Dates are "YYYY-MM-DD" strings in the worker's local calendar.

export const TRACKER_DEFAULT_THRESHOLDS = Object.freeze({ plan: [7, 12, 20], self: [7, 12, 20], agency: [3, 10, 15] });
export const TRACKER_STATES = ["SA", "NSW", "VIC", "QLD", "WA", "TAS", "ACT", "NT"];

const pad2 = (n) => String(n).padStart(2, "0");
export const ymd = (d) => `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`;
const parse = (s) => { const [y, m, d] = String(s).slice(0, 10).split("-").map(Number); return new Date(Date.UTC(y, m - 1, d)); };
const addCal = (s, n) => { const d = parse(s); d.setUTCDate(d.getUTCDate() + n); return ymd(d); };
const dow = (s) => parse(s).getUTCDay();
// nth weekday (0=Sun..6=Sat) of month; n<0 = last.
function nthDow(y, m, wd, n) {
  if (n > 0) { const d = new Date(Date.UTC(y, m - 1, 1)); const off = (wd - d.getUTCDay() + 7) % 7; d.setUTCDate(1 + off + 7 * (n - 1)); return ymd(d); }
  const d = new Date(Date.UTC(y, m, 0)); const off = (d.getUTCDay() - wd + 7) % 7; d.setUTCDate(d.getUTCDate() - off); return ymd(d);
}
function easterSunday(y) { // Anonymous Gregorian algorithm
  const a = y % 19, b = Math.floor(y / 100), c = y % 100, d = Math.floor(b / 4), e = b % 4, f = Math.floor((b + 8) / 25),
    g = Math.floor((b - f + 1) / 3), h = (19 * a + b - d - g + 15) % 30, i = Math.floor(c / 4), k = c % 4,
    l = (32 + 2 * e + 2 * i - h - k) % 7, m = Math.floor((a + 11 * h + 22 * l) / 451), mo = Math.floor((h + l - 7 * m + 114) / 31),
    da = ((h + l - 7 * m + 114) % 31) + 1;
  return `${y}-${pad2(mo)}-${pad2(da)}`;
}
// Weekend holiday -> next Monday (Christmas/Boxing Day pair handled together).
const observed = (s) => (dow(s) === 6 ? addCal(s, 2) : dow(s) === 0 ? addCal(s, 1) : s);

// Public holidays that close a business day: national days plus the main
// state-wide ones. Part-day and regional holidays (Adelaide Christmas Eve /
// NYE evenings, Brisbane Ekka, AFL Grand Final Friday) are ignored. Verify
// against data.gov.au "Australian Public Holidays Dates" each year.
const _hol = {};
export function auHolidays(year, state = "SA") {
  const key = year + state;
  if (_hol[key]) return _hol[key];
  const y = year, S = String(state || "SA").toUpperCase(), set = new Set();
  const add = (s) => set.add(s);
  add(observed(`${y}-01-01`)); add(observed(`${y}-01-26`));
  const easter = easterSunday(y); add(addCal(easter, -2)); add(addCal(easter, 1));
  add(`${y}-04-25`); // Anzac Day (WA/ACT substitute a weekday; others don't)
  if (S === "WA" || S === "ACT") add(observed(`${y}-04-25`));
  const xmas = `${y}-12-25`, box = `${y}-12-26`;
  if (dow(xmas) === 6) { add(addCal(xmas, 2)); add(addCal(xmas, 3)); }
  else if (dow(xmas) === 0) { add(addCal(xmas, 1)); add(addCal(xmas, 2)); }
  else { add(xmas); add(dow(box) === 6 ? addCal(box, 2) : box); }
  const kingsJune = nthDow(y, 6, 1, 2);
  if (S === "SA") { add(nthDow(y, 3, 1, 2)); add(kingsJune); add(nthDow(y, 10, 1, 1)); }
  if (S === "NSW") { add(kingsJune); add(nthDow(y, 10, 1, 1)); }
  if (S === "VIC") { add(nthDow(y, 3, 1, 2)); add(kingsJune); add(addCal(nthDow(y, 11, 1, 1), 1)); }
  if (S === "QLD") { add(nthDow(y, 5, 1, 1)); add(nthDow(y, 10, 1, 1)); }
  if (S === "WA") { add(nthDow(y, 3, 1, 1)); add(nthDow(y, 6, 1, 1)); add(nthDow(y, 9, 1, -1)); }
  if (S === "TAS") { add(nthDow(y, 3, 1, 2)); add(kingsJune); }
  if (S === "ACT") { add(nthDow(y, 3, 1, 2)); const r = `${y}-05-27`; add(addCal(r, (8 - dow(r)) % 7)); /* Reconciliation Day: Monday on or after 27 May */ add(kingsJune); add(nthDow(y, 10, 1, 1)); }
  if (S === "NT") { add(nthDow(y, 5, 1, 1)); add(kingsJune); add(nthDow(y, 8, 1, 1)); }
  _hol[key] = set;
  return set;
}
export function isBusinessDay(s, state) {
  const w = dow(s);
  return w !== 0 && w !== 6 && !auHolidays(Number(String(s).slice(0, 4)), state).has(String(s).slice(0, 10));
}
// Business days after `from` up to and including `to` (the send day is BD 0).
export function businessDaysBetween(from, to, state) {
  if (!from || !to || to <= from) return 0;
  let n = 0, d = String(from).slice(0, 10);
  for (let i = 0; i < 4000 && d < to; i++) { d = addCal(d, 1); if (isBusinessDay(d, state)) n++; }
  return n;
}
export function addBusinessDays(from, n, state) {
  let d = String(from).slice(0, 10), k = 0;
  while (k < n) { d = addCal(d, 1); if (isBusinessDay(d, state)) k++; }
  return d;
}
export const nextBusinessDayAfter = (s, state) => addBusinessDays(s, 1, state);

// payerType from the participant's planType ("plan" | "self" | "agency").
export const trackerPayerType = (planType) => (planType === "self" ? "self" : planType === "agency" ? "agency" : "plan");

// The date each chase stage becomes due. Stage 1 never fires before the
// first business day after the invoice's own due date (brief s5 rule).
export function trackerStageDates({ sentAt, due, payerType = "plan", thresholds, state }) {
  const t = (thresholds && thresholds[payerType]) || TRACKER_DEFAULT_THRESHOLDS[payerType] || TRACKER_DEFAULT_THRESHOLDS.plan;
  const d = t.map((n) => addBusinessDays(sentAt, n, state));
  if (due && payerType !== "agency") {
    const afterDue = nextBusinessDayAfter(due, state);
    if (afterDue > d[0]) d[0] = afterDue;
    if (d[1] < d[0]) d[1] = d[0];
    if (d[2] < d[1]) d[2] = d[1];
  }
  return d;
}
// stage 0 = OK (waiting), 1 = nudge due, 2 = firm reminder due, 3 = complaint / NDIA draft ready.
// A missed stage shows only the latest one; it never queues several.
export function trackerStage({ sentAt, due, payerType = "plan", thresholds, state, asOf }) {
  if (!sentAt) return { stage: -1, bd: 0, dates: [] };
  const dates = trackerStageDates({ sentAt, due, payerType, thresholds, state });
  const bd = businessDaysBetween(sentAt, asOf, state);
  let stage = 0;
  dates.forEach((dt, i) => { if (asOf >= dt) stage = i + 1; });
  return { stage, bd, dates, next: stage < 3 ? dates[stage] : null };
}
export const TRACKER_STAGE_LABEL = {
  plan: ["Waiting", "Nudge due", "Firm reminder due", "Complaint ready"],
  self: ["Waiting", "Reminder due", "Firmer reminder due", "NDIA contact draft ready"],
  agency: ["Waiting", "Check the portal", "Check for a hold", "NDIA enquiry ready"],
};

/* ---------------- message templates ----------------
   Rendered on the device with everything the worker can see and edit. The
   only tokens left for the server to fill at send time are {bdays},
   {reply_by} and {today}, which depend on the day it actually goes out. */
const fill = (s, v) => String(s).replace(/\{(\w+)\}/g, (m, k) => (v[k] != null ? String(v[k]) : m));
export function trackerFillDynamic(text, { sentAt, state, asOf }) {
  return String(text)
    .replace(/\{bdays\}/g, String(businessDaysBetween(sentAt, asOf, state)))
    .replace(/\{reply_by\}/g, fmtAu(addBusinessDays(asOf, 5, state)))
    .replace(/\{today\}/g, fmtAu(asOf));
}
export const fmtAu = (s) => { if (!s) return ""; const [y, m, d] = String(s).slice(0, 10).split("-"); return `${d}/${m}/${y}`; };

const T = {
  plan: [
    { subject: "Invoice {invoice_no} for {participant}: payment check",
      body: "Hi {to_name},\n\nI hope you're well. I'm following up on invoice {invoice_no} for ${amount}, sent on {sent_date} for supports provided to {participant}{ndis_bit}{service_bit}.\n\nCould you please confirm you've received it and let me know when payment is expected? If anything is missing or needs correcting, just tell me and I'll fix it straight away.\n\nThank you,\n{worker_name}\n{business_line}" },
    { subject: "Second request: invoice {invoice_no} (${amount}) now {bdays} business days outstanding",
      body: "Hi {to_name},\n\nI followed up earlier about invoice {invoice_no} for ${amount}, sent on {sent_date} for {participant}{ndis_bit}. It is now {bdays} business days since the invoice was sent and I have not received payment.\n\nThe NDIS Guide to Plan Management says a plan manager \"must validate\" invoices \"within no more than five business days\", and the NDIA says plan managers should pay providers \"within 2 business days\" of receiving payment from the NDIS.\n\nPlease reply by {reply_by} with either:\n- the date payment will be made, or\n- the specific reason the invoice is on hold and what you need from me.\n\nPlease also send me a copy of your complaints process, in case this cannot be resolved.\n\nRegards,\n{worker_name}\n{business_line}" },
  ],
  self: [
    { subject: "Invoice {invoice_no}: friendly reminder",
      body: "Hi {to_name},\n\nJust a friendly reminder about invoice {invoice_no} for ${amount}{service_bit}, sent on {sent_date}. If you've already paid, thank you, and please let me know the date so I can match it up. If anything on the invoice needs changing, just tell me.\n\nThanks,\n{worker_name}" },
    { subject: "Invoice {invoice_no}: payment now overdue",
      body: "Hi {to_name},\n\nInvoice {invoice_no} for ${amount}, sent on {sent_date}, is now {bdays} business days old and I haven't received payment yet. When you self-manage, the NDIA usually pays your claim into your account within 2 business days, and then the provider is paid. Could you let me know by {reply_by} when you expect to pay? If something is holding up your claim, I'm happy to help with the details it needs.\n\nThanks,\n{worker_name}\n{business_line}" },
  ],
};
export function trackerTemplate(payerType, stage, vars) {
  const set = T[payerType];
  if (!set || stage < 1 || stage > 2) return null;
  const t = set[stage - 1];
  return { subject: fill(t.subject, vars), body: fill(t.body, vars) };
}
// Day-20 (plan/self) or day-15 (agency) draft for the worker to file with the
// NDIA. Never filed automatically.
export function trackerNdiaDraft(payerType, vars) {
  const role = payerType === "plan" ? "Provider (sole-trader support worker) to a plan-managed participant"
    : payerType === "self" ? "Provider (sole-trader support worker) to a self-managed participant"
    : "Provider to an NDIA-managed participant";
  const ask = payerType === "plan" ? "Please contact the plan manager and help resolve payment of the outstanding invoice(s)."
    : payerType === "self" ? "The participant has not responded to my payment requests. Please advise how this can be resolved."
    : "Please advise the status of this payment request and what is needed for it to be paid.";
  const fields = [
    ["Feedback type", payerType === "agency" ? "Enquiry" : "Complaint"],
    ["Have you contacted the Agency about this before?", "(answer yes/no and add any reference number)"],
    ["Your details", vars.business_line ? `${vars.worker_name}, ${vars.business_line}` : vars.worker_name],
    ["Your role", role],
    ["Participant", `${vars.participant}${vars.ndis_number ? ` (NDIS ${vars.ndis_number})` : ""}`],
    ...(payerType === "plan" ? [["Plan manager", vars.payer_name || ""]] : []),
    ["Invoice", `${vars.invoice_no}, $${vars.amount}, sent ${vars.sent_date}${vars.service_period ? `, supports ${vars.service_period}` : ""}`],
    ["Business days outstanding", "{bdays}"],
    ["Follow-up so far", vars.chase_history || "(none recorded)"],
    ["Benchmark", "NDIS Guide to Plan Management s4.2.1: validate invoices within 5 business days; NDIA: plan managers pay providers within 2 business days of receiving NDIS funds."],
    ["Requested action", ask],
    ["Attach", "The invoice PDF, the reminder emails, and the SupportFlow payment history report."],
  ];
  return {
    subject: `Ready to file: NDIA ${payerType === "agency" ? "enquiry" : "complaint"} draft for invoice ${vars.invoice_no}`,
    fields,
    body: fields.map(([k, v]) => `${k}:\n${v}`).join("\n\n") +
      "\n\nHow to file: NDIA Feedback and complaints form https://www.ndis.gov.au/contact/feedback-and-complaints or phone 1800 800 110." +
      "\nThe NDIS Quality and Safeguards Commission does not handle unpaid invoices; contact it only about conduct concerns or if supports to the participant may stop.",
  };
}
