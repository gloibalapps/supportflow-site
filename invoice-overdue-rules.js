// Invoice overdue, part-payment, due-date and share rules.
// ONE source of truth: imported by tests and inlined into app.jsx by
// build-app.mjs between the @@INVOICE_RULES markers. Dates are YYYY-MM-DD
// in the worker's local calendar (Australia/Adelaide for SupportFlow).
// Keep it dependency-free plain JS.

export function ovInvoiceTotal(inv) {
  return (inv?.lines || []).reduce((s, l) => s + Number(l.qty || 0) * Number(l.rate || 0), 0);
}

export function ovHasAmountPaid(inv) {
  return !!inv && inv.amountPaid != null && inv.amountPaid !== "" && !isNaN(Number(inv.amountPaid));
}

// Cash received. A paid invoice with no amount recorded counts as paid in full.
// A sent invoice only counts money when an amount was actually entered.
export function ovAmountReceived(inv) {
  if (!inv || inv.status === "draft") return 0;
  if (ovHasAmountPaid(inv)) return Number(inv.amountPaid);
  if (inv.status === "paid") return ovInvoiceTotal(inv);
  return 0;
}

function round2(n) {
  return Math.round((Number(n) + Number.EPSILON) * 100) / 100;
}

export function ovBalanceDue(inv) {
  if (!inv || inv.status === "draft") return 0;
  const bal = ovInvoiceTotal(inv) - ovAmountReceived(inv);
  return bal > 0.005 ? round2(bal) : 0;
}

export function ovIsFullyPaid(inv) {
  return !!inv && inv.status === "paid" && ovBalanceDue(inv) <= 0.005;
}

// Still owed: sent and not settled, or marked paid while a balance remains.
export function ovIsAwaiting(inv) {
  if (!inv || inv.status === "draft") return false;
  if (inv.status === "sent") return ovBalanceDue(inv) > 0.005 || !ovHasAmountPaid(inv);
  if (inv.status === "paid") return ovBalanceDue(inv) > 0.005;
  return false;
}

export function ovIsPartPaid(inv) {
  if (!ovIsAwaiting(inv) || !ovHasAmountPaid(inv)) return false;
  return Number(inv.amountPaid) > 0.005 && ovBalanceDue(inv) > 0.005;
}

export function ovIsOverdue(inv, asOf) {
  return ovIsAwaiting(inv) && !!inv.due && String(inv.due).slice(0, 10) < String(asOf || "").slice(0, 10);
}

export function ovStatusKey(inv, asOf) {
  if (!inv || inv.status === "draft") return "draft";
  if (ovIsFullyPaid(inv)) return "paid";
  if (ovIsOverdue(inv, asOf)) return "overdue";
  if (ovIsPartPaid(inv)) return "part";
  if (ovIsAwaiting(inv)) return "sent";
  return inv.status === "paid" ? "paid" : "draft";
}

// "sent" is the Waiting filter: unpaid and not yet overdue.
// "owing" is waiting and overdue together (the Home Outstanding set).
export function ovInFilter(inv, key, asOf) {
  if (key === "all") return true;
  if (key === "owing") return ovIsAwaiting(inv);
  if (key === "paid") return ovIsFullyPaid(inv);
  if (key === "sent") return ovIsAwaiting(inv) && !ovIsOverdue(inv, asOf);
  if (key === "overdue") return ovIsOverdue(inv, asOf);
  if (key === "draft") return !inv || inv.status === "draft";
  return ovStatusKey(inv, asOf) === key;
}

export function ovOutstanding(invoices) {
  return round2((invoices || []).filter(ovIsAwaiting).reduce((n, i) => n + ovBalanceDue(i), 0));
}

// What a payment reminder should quote: the balance still owed while the
// invoice is open, and the invoice total once it is fully paid.
export function ovReminderAmount(inv) {
  if (ovIsAwaiting(inv)) return ovBalanceDue(inv);
  return round2(ovInvoiceTotal(inv));
}

function ovPad2(n) { return String(n).padStart(2, "0"); }

// Local calendar arithmetic. Do not use toISOString(): UTC shifts an
// Australian midnight back a day.
export function ovAddDays(iso, n) {
  const x = new Date(String(iso).slice(0, 10) + "T00:00:00");
  if (isNaN(x.getTime())) return "";
  x.setDate(x.getDate() + Number(n || 0));
  return `${x.getFullYear()}-${ovPad2(x.getMonth() + 1)}-${ovPad2(x.getDate())}`;
}

export function ovDueFromTerms(issued, termsDays) {
  if (!issued) return "";
  if (termsDays == null || String(termsDays).trim() === "" || isNaN(Number(termsDays))) return "";
  return ovAddDays(issued, Number(termsDays));
}

export function ovDueIsManual(inv, termsDays) {
  if (!inv) return false;
  if (inv.dueManual === true) return true;
  if (inv.dueManual === false) return false;
  if (!inv.due) return false;
  const calculated = ovDueFromTerms(inv.date, termsDays);
  if (!calculated) return true;
  return String(inv.due).slice(0, 10) !== calculated;
}

export function ovIssuedChange(inv, nextIssued, termsDays) {
  if (ovDueIsManual(inv, termsDays)) return { date: nextIssued };
  return { date: nextIssued, due: ovDueFromTerms(nextIssued, termsDays), dueManual: false };
}

export function ovCanShare(inv) {
  return !!(inv && inv.participantId && ovInvoiceTotal(inv) > 0 && inv.due);
}

export function ovMarkSent(inv, today) {
  return {
    ...inv,
    status: "sent",
    sentAt: inv.sentAt && !inv.sentAtEstimated ? inv.sentAt : today,
    sentAtEstimated: false,
  };
}

// Uploaded for automatic reminders: sent, still unpaid, and has a sent date.
export function ovSyncInvoice(inv) {
  return !!(inv && inv.sentAt && ovIsAwaiting(inv));
}

// "off"     TRACKER_AUTOSEND_ENABLED is not true. The sender returns before it logs.
// "dry-run" enabled, but TRACKER_AUTOSEND_DRY_RUN is not the string false. Nothing is emailed.
// ""        real sends are allowed by the server flags.
export function ovSyncNotice(flags) {
  if (!flags || !flags.autosendServer) return "off";
  if (flags.autosendDryRun) return "dry-run";
  return "";
}
