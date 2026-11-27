// Run: node --test tests/notes-ai-assist-ui.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { acceptNoteSuggestion, discardNoteSuggestion } from "../netlify/lib/notes-ai.mjs";

const root = new URL("../", import.meta.url);
const read = (f) => readFileSync(new URL(f, root), "utf8");

function notesSlice(src) {
  const start = src.indexOf("function Notes(");
  const end = src.indexOf("function classifyShift(");
  assert.ok(start > 0 && end > start);
  return src.slice(start, end);
}

const notes = notesSlice(read("app.jsx"));
const original = "Supported a grocery shop and they paid. No incident today at all.";
const suggestion = "The participant completed a grocery shop and paid. [add how this relates to the participant's goals]";

test("accept copies the suggestion into the editor and does not save", () => {
  const accepted = acceptNoteSuggestion(original, suggestion);
  assert.equal(accepted.editorText, suggestion);
  assert.equal(accepted.saved, false);
  assert.equal(accepted.reviewOpen, false);
  const body = notes.slice(notes.indexOf("const acceptReview = () => {"), notes.indexOf("const discardReview = () => {"));
  assert.match(body, /acceptNoteSuggestion\(f\.rough, review\.text\)/);
  assert.match(body, /setF\(\{ \.\.\.f, rough: next\.editorText \}\)/);
  assert.doesNotMatch(body, /\bsave\(/);
});

test("discard keeps the original note and does not save", () => {
  const discarded = discardNoteSuggestion(original);
  assert.equal(discarded.editorText, original);
  assert.equal(discarded.saved, false);
  assert.equal(discarded.reviewOpen, false);
  const body = notes.slice(notes.indexOf("const discardReview = () => {"), notes.indexOf("const onReviewKey"));
  assert.match(body, /discardNoteSuggestion\(f\.rough\)/);
  assert.doesNotMatch(body, /\bsave\(/);
});

test("a suggestion is shown for review and does not overwrite or save", () => {
  const body = notes.slice(notes.indexOf("const askAssist = async () => {"), notes.indexOf("const acceptReview = () => {"));
  assert.match(body, /setReview\(\{ text: suggestion \}\)/);
  assert.match(body, /JSON\.stringify\(notesAssistRequestBody\(text\)\)/);
  assert.doesNotMatch(body, /setF\(/);
  assert.doesNotMatch(body, /\bsave\(/);
  assert.doesNotMatch(body, /body:\s*JSON\.stringify\(\s*\{[^}]*participant/);
});

test("the notes screen offers AI assist and not Tidy this up", () => {
  assert.match(notes, /AI assist/);
  assert.match(notes, />Accept</);
  assert.match(notes, />Discard</);
  assert.match(notes, /to Anthropic to draft a progress note/);
  assert.match(notes, /Nothing else from the record is sent/);
  assert.doesNotMatch(notes, /Tidy this up/);
  const html = read("app.html");
  assert.match(notesSlice(html), /AI assist/);
  assert.doesNotMatch(notesSlice(html), /Tidy this up/);
});

test("user manual instructions no longer say Tidy up", () => {
  const manual = read("USER-MANUAL.md");
  assert.match(manual, /tap \*\*AI assist\*\*/);
  assert.match(manual, /isn't configured yet/);
  assert.match(manual, /Nothing is overwritten/);
  assert.doesNotMatch(manual, /Tidy this up|Tidy up|note tidies|untidied|\btidying\b/i);
});
