// Signing parties on a service agreement.
// build-app.mjs inlines this file into app.jsx between the
// @@AGREEMENT_SIG markers, with the export keywords removed.
// Any number of parties. A missing list means the participant and the
// sole trader, and has not been saved yet. An array, including an empty
// one, is what was saved.

export const AGREEMENT_ROLES = [
  { id: "participant", label: "Participant" },
  { id: "representative", label: "Participant's representative" },
  { id: "worker", label: "Sole trader (support worker)" },
  { id: "nominee", label: "Nominee or guardian" },
  { id: "planManager", label: "Plan manager" },
  { id: "coordinator", label: "Support coordinator" },
  { id: "witness", label: "Witness" },
  { id: "other", label: "Other" },
];

const ROLE_IDS = new Set(AGREEMENT_ROLES.map((r) => r.id));
const MAX_SIG_CHARS = 500000;
const MAX_STROKES = 80;
const MAX_POINTS = 2000;

export function agreementRoleLabel(party) {
  if (!party) return "";
  if (party.role === "other") {
    const custom = String(party.customRole || "").trim();
    return custom || "Other";
  }
  const hit = AGREEMENT_ROLES.find((r) => r.id === party.role);
  return hit ? hit.label : "Signatory";
}

function clamp01(n) {
  const x = Number(n);
  if (!Number.isFinite(x)) return 0;
  return Math.round(Math.min(1, Math.max(0, x)) * 10000) / 10000;
}

export function normaliseStrokes(strokes) {
  if (!Array.isArray(strokes)) return [];
  const out = [];
  for (const stroke of strokes.slice(0, MAX_STROKES)) {
    if (!Array.isArray(stroke)) continue;
    const pts = [];
    for (const p of stroke.slice(0, MAX_POINTS)) {
      if (Array.isArray(p)) pts.push([clamp01(p[0]), clamp01(p[1])]);
      else if (p && typeof p === "object") pts.push([clamp01(p.x), clamp01(p.y)]);
    }
    if (pts.length) out.push(pts);
  }
  return out;
}

export function isSignatureImage(value) {
  return typeof value === "string" && value.startsWith("data:image/png") && value.length > "data:image/png".length && value.length <= MAX_SIG_CHARS;
}

export function blankParty({ id, role, name, customRole } = {}) {
  return {
    id: id || "",
    role: ROLE_IDS.has(role) ? role : "other",
    customRole: role === "other" ? String(customRole || "") : "",
    name: name || "",
    signature: "",
    strokes: [],
    signedAt: "",
    redo: null,
  };
}

function sanitiseRedo(raw) {
  if (!raw || typeof raw !== "object") return null;
  const signature = isSignatureImage(raw.signature) ? raw.signature : "";
  const strokes = normaliseStrokes(raw.strokes);
  if (!signature && !strokes.length) return null;
  return {
    signature,
    strokes,
    signedAt: typeof raw.signedAt === "string" ? raw.signedAt.slice(0, 10) : "",
  };
}

export function sanitiseParty(raw, index) {
  const src = raw && typeof raw === "object" ? raw : {};
  const role = ROLE_IDS.has(src.role) ? src.role : "other";
  const id = typeof src.id === "string" && src.id.trim() ? src.id.trim().slice(0, 40) : `party-${index}`;
  return {
    id,
    role,
    customRole: role === "other" ? String(src.customRole || "").trim().slice(0, 80) : "",
    name: String(src.name || "").slice(0, 120),
    signature: isSignatureImage(src.signature) ? src.signature : "",
    strokes: normaliseStrokes(src.strokes),
    signedAt: typeof src.signedAt === "string" ? src.signedAt.slice(0, 10) : "",
    redo: sanitiseRedo(src.redo),
  };
}

export function defaultAgreementParties(participant, profile) {
  const pt = participant || {};
  const prof = profile || {};
  return [
    blankParty({ id: "party-participant", role: "participant", name: pt.name || "" }),
    blankParty({ id: "party-worker", role: "worker", name: prof.name || "" }),
  ];
}

// Missing list → the two defaults, not yet stored.
// A saved array is returned as stored, including when every party was removed.
export function resolveAgreementParties(participant, profile) {
  const stored = participant && participant.agreementParties;
  if (!Array.isArray(stored)) return defaultAgreementParties(participant, profile);
  const seen = new Set();
  return stored.map((raw, i) => {
    const party = sanitiseParty(raw, i);
    if (seen.has(party.id)) party.id = `${party.id}-${i}`.slice(0, 40);
    seen.add(party.id);
    return party;
  });
}

export function partiesForSave(parties) {
  return resolveAgreementParties({ agreementParties: Array.isArray(parties) ? parties : [] }, {});
}

export function suggestedPartyName(role, participant, profile, managers) {
  const pt = participant || {};
  const prof = profile || {};
  if (role === "participant") return pt.name || "";
  if (role === "worker") return prof.name || "";
  if (role === "planManager") {
    const list = Array.isArray(managers) ? managers : [];
    const linked = list.find((m) => m && m.id && m.id === pt.managerId);
    return (linked && linked.name) || "";
  }
  return "";
}

export function commitStroke(party, stroke, png, signedAt) {
  const p = sanitiseParty(party, 0);
  const added = normaliseStrokes([stroke]);
  if (!added.length) return p;
  const strokes = normaliseStrokes([...p.strokes, ...added]);
  return {
    ...p,
    strokes,
    signature: isSignatureImage(png) ? png : p.signature,
    signedAt: p.signedAt || (typeof signedAt === "string" ? signedAt.slice(0, 10) : ""),
    redo: null,
  };
}

export function dropLastStroke(party) {
  const p = sanitiseParty(party, 0);
  if (!p.strokes.length) return { changed: false, party: p };
  const strokes = p.strokes.slice(0, -1);
  return {
    changed: true,
    party: {
      ...p,
      strokes,
      signature: "",
      signedAt: strokes.length ? p.signedAt : "",
      redo: { signature: p.signature, strokes: p.strokes, signedAt: p.signedAt },
    },
  };
}

export function clearParty(party) {
  const p = sanitiseParty(party, 0);
  if (!p.signature && !p.strokes.length) return p;
  return {
    ...p,
    signature: "",
    strokes: [],
    signedAt: "",
    redo: { signature: p.signature, strokes: p.strokes, signedAt: p.signedAt },
  };
}

export function redoParty(party) {
  const p = sanitiseParty(party, 0);
  if (!p.redo) return p;
  return {
    ...p,
    signature: p.redo.signature,
    strokes: p.redo.strokes,
    signedAt: p.redo.signedAt || "",
    redo: null,
  };
}

export function patchParty(party, patch) {
  const src = patch && typeof patch === "object" ? patch : {};
  return sanitiseParty({ ...party, ...src, id: party && party.id, redo: src.redo === undefined ? party && party.redo : src.redo }, 0);
}

export function replaceParty(parties, id, next) {
  return (Array.isArray(parties) ? parties : []).map((p) => (p.id === id ? sanitiseParty(next, 0) : sanitiseParty(p, 0)));
}

export function removeParty(parties, id) {
  return (Array.isArray(parties) ? parties : []).filter((p) => p.id !== id).map((p, i) => sanitiseParty(p, i));
}

export function addParty(parties, draft) {
  const list = Array.isArray(parties) ? parties : [];
  return [...list.map((p, i) => sanitiseParty(p, i)), sanitiseParty(draft, list.length)];
}
