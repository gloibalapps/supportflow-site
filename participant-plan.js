// SupportFlow participant plan rules.
// ONE source of truth for saving a participant against how their plan is
// managed. Inlined into app.jsx by build-app.mjs between the
// @@PARTICIPANT_PLAN markers. Keep it dependency-free plain JS.
//
// Storage is unchanged. Plan managers are not a database table and not a
// free-text field. They already live in the on-device record as
// data.managers[]. A participant stores planType ("plan" | "self" |
// "agency") and managerId, which points at data.managers[].id.
// Existing participants are never rewritten by these helpers. A failed
// save returns the same data object it was given.

export const PLAN_MANAGED = "plan";
export const SELF_MANAGED = "self";
export const NDIA_MANAGED = "agency";

// Show a search box once the saved list is long enough that scanning it is
// the slow part. Shorter lists are just buttons.
export const PLAN_MANAGER_SEARCH_AT = 6;

export const PLAN_TYPE_CHOICES = [
  ["plan", "Plan-managed", "Invoices are sent to their plan manager."],
  ["self", "Self-managed", "Invoices go to the participant or their nominee."],
  ["agency", "NDIA-managed (agency-managed)", "Claims go through the NDIA myplace portal. No plan manager."],
];

export const PLAN_MANAGER_EXPLAIN =
  "Invoices for plan-managed participants are sent to their plan manager, so without one your invoices have nowhere to go.";

export const PLAN_MANAGER_REQUIRED_MESSAGE =
  "Add a plan manager before saving. " + PLAN_MANAGER_EXPLAIN;

export const SELF_MANAGED_EXPLAIN =
  "Invoices for self-managed participants go to the participant or their nominee. Add the billing email those invoices should use.";

export const SELF_MANAGED_EMAIL_MESSAGE =
  "Add the billing email invoices should go to. For a self-managed participant that is the participant or their nominee.";

// NDIA-managed (planType "agency") already has no plan manager in the app.
// resolve() addresses the invoice PDF to the participant, the same as
// self-managed, because planType !== "plan". The payment tracker treats
// "agency" separately: reminders tell the worker to check the myplace
// provider portal and are not emailed to a payer. This step does not invent
// a second billing path. It skips the plan manager and says that plainly.
export const NDIA_MANAGED_EXPLAIN =
  "NDIA-managed (agency-managed) claims are lodged in the NDIA myplace provider portal. There is no plan manager to invoice. SupportFlow still keeps payment terms on the participant, which set the due date on the invoice you hold for your records. Portal reminders go to you, not to a plan manager.";

export function isInvoiceEmail(v) {
  return /^[^\s@]+@[^\s@.]+(\.[^\s@.]+)+$/.test(String(v || "").trim());
}

export function managerById(managers, id) {
  const key = String(id || "").trim();
  if (!key) return null;
  return (managers || []).find((m) => m && m.id === key) || null;
}

export function filterPlanManagers(managers, query) {
  const q = String(query || "").trim().toLowerCase();
  const list = Array.isArray(managers) ? managers.filter(Boolean) : [];
  if (!q) return list.slice();
  return list.filter((m) => [m.name, m.email, m.contact].join(" ").toLowerCase().includes(q));
}

export function planChoiceLabel(planType) {
  const row = PLAN_TYPE_CHOICES.find((c) => c[0] === planType);
  return row ? row[1] : PLAN_TYPE_CHOICES[0][1];
}

// Name, invoice email, and payment terms are what invoice sending and the
// due date actually read (manager name, email, address, terms). Address is
// optional because a blank address already prints as blank. Contact, phone
// and ABN are stored when entered so the existing plan-manager record shape
// stays intact, and are not required to send an invoice.
export function planManagerDraftError(draft) {
  const name = String(draft?.name || "").trim();
  const email = String(draft?.email || "").trim();
  const terms = String(draft?.terms ?? "").trim();
  if (!name) return "Enter the plan manager's name.";
  if (!isInvoiceEmail(email)) return "Enter the invoice email invoices should be sent to.";
  if (!(Number(terms) > 0)) return "Enter payment terms in days. They set the due date on invoices sent to this plan manager.";
  return "";
}

export function normalisePlanManager(draft, id) {
  return {
    id,
    name: String(draft?.name || "").trim(),
    contact: String(draft?.contact || "").trim(),
    email: String(draft?.email || "").trim().toLowerCase(),
    phone: String(draft?.phone || "").trim(),
    address: String(draft?.address || "").trim(),
    abn: String(draft?.abn || "").trim(),
    terms: String(draft?.terms ?? "").trim(),
    notes: String(draft?.notes || "").trim(),
  };
}

export function participantSaveError(participant, managers) {
  if (!participant || participant.planType !== PLAN_MANAGED) return "";
  if (managerById(managers, participant.managerId)) return "";
  return PLAN_MANAGER_REQUIRED_MESSAGE;
}

// New self-managed participants need the billing email resolve() already
// uses (participant.email). Existing self-managed records stay saveable
// without one, so older participants remain editable.
export function selfManagedBillingError(participant) {
  if (!participant || participant.planType !== SELF_MANAGED || participant.id) return "";
  if (isInvoiceEmail(participant.email)) return "";
  return SELF_MANAGED_EMAIL_MESSAGE;
}

export function participantPlanBlock(participant, managers, pendingManager) {
  if (!participant) return "";
  if (participant.planType === PLAN_MANAGED && pendingManager) {
    return planManagerDraftError(pendingManager);
  }
  return participantSaveError(participant, managers) || selfManagedBillingError(participant);
}

// Creates a pending plan manager and links it in the same save when needed.
// Refuses a plan-managed participant with no real manager. Self-managed and
// NDIA-managed participants are saved with no plan manager. On any refusal
// the original data object is returned untouched.
export function applyParticipantSave(data, participant, pendingManager, options) {
  const idFactory = (options && options.idFactory) || (() => Math.random().toString(36).slice(2, 10));
  const base = data && typeof data === "object" ? data : {};
  const managers = Array.isArray(base.managers) ? base.managers.slice() : [];
  const participants = Array.isArray(base.participants) ? base.participants.slice() : [];
  const isNew = !participant?.id;
  let createdManager = null;
  let managerId = String(participant?.managerId || "").trim();

  if (participant?.planType === PLAN_MANAGED && pendingManager) {
    const draftError = planManagerDraftError(pendingManager);
    if (draftError) return { ok: false, error: draftError, data: base, participant: null, createdManager: null };
    const id = String(pendingManager.id || "").trim() || idFactory();
    createdManager = normalisePlanManager(pendingManager, id);
    const at = managers.findIndex((m) => m && m.id === id);
    if (at >= 0) managers[at] = { ...managers[at], ...createdManager };
    else managers.push(createdManager);
    managerId = id;
  }

  const next = {
    ...participant,
    planType: participant?.planType || PLAN_MANAGED,
    managerId: participant?.planType === PLAN_MANAGED ? managerId : (isNew ? "" : String(participant?.managerId || "")),
  };

  const error = participantSaveError(next, managers) || selfManagedBillingError(next);
  if (error) return { ok: false, error, data: base, participant: null, createdManager: null };

  let saved;
  if (next.id) {
    const at = participants.findIndex((p) => p && p.id === next.id);
    if (at >= 0) participants[at] = { ...participants[at], ...next };
    else participants.push(next);
    saved = participants[at >= 0 ? at : participants.length - 1];
  } else {
    saved = { ...next, id: idFactory() };
    participants.push(saved);
  }

  return {
    ok: true,
    error: "",
    data: { ...base, managers, participants },
    participant: saved,
    createdManager,
  };
}
