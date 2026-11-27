// Shared rules for shift-note AI assist. build-app.mjs copies this file into
// app.jsx (export keywords stripped) so the review actions the worker sees
// are the same functions the tests call. The system prompt stays here too;
// the browser does not send it. The Netlify function owns the model call.

export const NOTES_AI_MIN = 40;
export const NOTES_AI_MAX = 8000;
// Same default the deduction checker already uses. Override with ANTHROPIC_MODEL.
export const NOTES_AI_MODEL_DEFAULT = "claude-haiku-4-5-20251001";

export const NOTES_AI_SYSTEM_PROMPT = `You rewrite a support worker's rough shift notes into one objective, person-centred, professional NDIS progress note in Australian English.

Rules:
- Use only facts that are in the notes. Do not invent details, times, durations, locations, medications, dosages, diagnoses, appointments, names, or outcomes.
- If a usual part of a progress note is missing, flag it with a short bracketed prompt such as [add what support was provided] or [add how this relates to the participant's goals]. Never fill that gap yourself.
- A progress note usually covers what support was provided, how the participant took part, any link to their goals, observations, and follow-up. Include a part only when the notes support it, and add a bracketed prompt when it does not.
- Keep any incident clearly stated, in plain factual language. Do not soften it, omit it, or add drama.
- Write in past tense and plain language. Refer to the person as "the participant" and the worker as "the support worker" unless the notes already use other wording you are keeping.
- No diagnosis, clinical judgement, blame, or advice.
- Output plain text only. No markdown, no title, no preamble, and no sign-off.
- Do not repeat contact details, identification numbers, dates of birth, or street addresses. If one was removed, leave it out.`;

const STREET = "Street|St|Road|Rd|Avenue|Ave|Drive|Dr|Court|Ct|Place|Pl|Crescent|Cres|Lane|Ln|Way|Parade|Pde|Terrace|Tce|Boulevard|Blvd|Highway|Hwy";

// Best-effort removal of obvious identifiers that were typed into the note.
// Names the app already holds are stripped separately, before this runs.
export function redactNoteText(text) {
  let out = String(text || "");
  out = out.replace(/[\w.+-]+@[\w-]+\.[a-z.-]+/gi, "[contact removed]");
  out = out.replace(/\b(?:\+?61[ -]?|0)[2-478](?:[ -]?\d){8}\b/g, "[phone removed]");
  out = out.replace(/\b(?:d\.?o\.?b\.?|date of birth|born on)\s*[:\-]?\s*\d{1,2}[\/.\-]\d{1,2}[\/.\-]\d{2,4}\b/gi, "[date of birth removed]");
  out = out.replace(new RegExp("\\b(?:ndis(?:\\s*(?:number|no\\.?|#))?|abn)\\s*[:#]?\\s*(?:\\d[ \\-]?){8,11}\\d\\b", "gi"), "[identifier removed]");
  out = out.replace(/\b\d{9}\b/g, "[identifier removed]");
  out = out.replace(/\b\d{11}\b/g, "[identifier removed]");
  out = out.replace(new RegExp(
    "\\b\\d{1,5}(?:\\/\\d{1,5})?\\s+[A-Z][A-Za-z']+(?:\\s+[A-Z][A-Za-z']+){0,4}\\s+(?:" + STREET + ")\\b(?:,?\\s+[A-Z][A-Za-z]+(?:\\s+[A-Z][A-Za-z]+){0,3})?(?:,?\\s+(?:NSW|VIC|QLD|SA|WA|TAS|NT|ACT)\\s+\\d{4})?",
    "g"
  ), "[address removed]");
  return out;
}

function pushPhrase(pairs, value, replacement) {
  const v = String(value || "").replace(/\s+/g, " ").trim();
  if (v.length < 3) return;
  pairs.push([v, replacement]);
  const bits = v.split(" ").filter((b) => b.length >= 3);
  if (bits.length > 1) {
    for (const bit of bits) pairs.push([bit, replacement]);
  }
}

// known fields are used only on the device to strip text. They are not sent.
export function scrubNoteForAssist(text, known = {}) {
  const pairs = [];
  for (const n of known.participantNames || []) pushPhrase(pairs, n, "the participant");
  for (const n of known.workerNames || []) pushPhrase(pairs, n, "the support worker");
  for (const n of known.otherNames || []) pushPhrase(pairs, n, "someone else");
  for (const n of known.identifiers || []) pushPhrase(pairs, n, "");
  pairs.sort((a, b) => b[0].length - a[0].length);
  let out = String(text || "");
  const seen = new Set();
  for (const [value, replacement] of pairs) {
    const key = value.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    const esc = value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const edged = /^[\w]/.test(value) && /[\w]$/.test(value);
    out = out.replace(new RegExp((edged ? "\\b" : "") + esc + (edged ? "\\b" : ""), "gi"), replacement);
  }
  out = redactNoteText(out);
  return out.replace(/[ \t]{2,}/g, " ").replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
}

// The only JSON the browser is allowed to post.
export function notesAssistRequestBody(text) {
  return { text: String(text || "") };
}

export function noteAssistBlockReason(text) {
  const t = String(text || "").trim();
  if (!t) return "empty";
  if (t.length < NOTES_AI_MIN) return "short";
  if (t.length > NOTES_AI_MAX) return "long";
  return "";
}

// Accept copies the (possibly edited) suggestion into the editor. It does not save.
export function acceptNoteSuggestion(editorText, suggestionText) {
  return { editorText: String(suggestionText ?? ""), reviewOpen: false, saved: false };
}

// Discard leaves the editor exactly as it was. It does not save.
export function discardNoteSuggestion(editorText) {
  return { editorText: String(editorText ?? ""), reviewOpen: false, saved: false };
}
