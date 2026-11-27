// Voice notes UI contract. Run with: node --test tests/
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const app = readFileSync(new URL("../app.jsx", import.meta.url), "utf8");
const manual = readFileSync(new URL("../USER-MANUAL.md", import.meta.url), "utf8");
const mic = app.slice(app.indexOf("function VoiceNoteMic"), app.indexOf("function VoiceNotesSettings"));
const notesStart = app.indexOf("function Notes(");
const notes = app.slice(notesStart, app.indexOf("\nfunction ", notesStart + 20));

test("mic sends only the clip, a duration, a timezone offset, and a draft id", () => {
  assert.match(mic, /fd\.append\("audio"/);
  assert.match(mic, /fd\.append\("durationMs"/);
  assert.match(mic, /fd\.append\("tzOffsetMinutes"/);
  assert.match(mic, /fd\.append\("draftId"/);
  assert.doesNotMatch(mic, /participantId|ndisNumber|fd\.append\("text"|fd\.append\("name"/);
});

test("transcription is inserted at the caret and does not replace the whole note", () => {
  assert.match(app, /function voiceSplice/);
  assert.match(notes, /voiceSplice\(cur\.rough/);
  assert.doesNotMatch(notes, /rough:\s*text\b/);
});

test("save stays manual while a recording is in progress", () => {
  assert.match(notes, /disabled=\{voiceBusy \|\| !hasContent\(f\)\}/);
  assert.match(notes, /readOnly=\{voiceBusy\}/);
  assert.match(notes, /Nothing is saved until you tap Save note/);
});

test("the mic sits with the note, and the draft button stays beside Save", () => {
  assert.match(notes, /className="vn-compose"/);
  assert.match(notes, /<VoiceNoteMic/);
  assert.match(notes, /className="vn-actions"/);
  assert.match(notes, /Tidy this up/);
  assert.match(notes, /disabled=\{voiceBusy \|\| busy \|\| !hasContent\(f\)\}/);
});

test("a missing transcription key is a friendly message, not a crash", () => {
  assert.match(app, /Voice notes aren't set up on this site yet\. You can still type the note\./);
  assert.match(mic, /catch \(e\)/);
});

test("the A$5 add-on and the 120-minute top-up are offered, and a missing price stays quiet", () => {
  const ui = app.slice(app.indexOf("function VoiceNoteMic"), app.indexOf("function Notes("));
  assert.match(ui, /Add Voice notes — A\$5\/month/);
  assert.match(ui, /Add 120 minutes for A\$5/);
  assert.match(ui, /Voice notes checkout isn't available yet/);
  assert.match(ui, /sent to OpenAI/);
  assert.match(ui, /catch \(e\)/);
});

test("the manual explains hold, limits, AI assist, then Save, and leaves the videos alone", () => {
  const section = manual.slice(manual.indexOf("### Voice notes"), manual.indexOf("### Tidy this up"));
  assert.match(section, /Hold the microphone/);
  assert.match(section, /2 minutes/);
  assert.match(section, /120 minutes a month/);
  assert.match(section, /A\$5 a month/);
  assert.match(section, /another \*\*120 minutes\*\*/);
  assert.match(section, /OpenAI/);
  assert.match(section, /AI assist/);
  assert.match(section, /Save note/);
  assert.doesNotMatch(section, /youtube|iframe|watch\?v=/i);
  assert.match(manual, /https:\/\/www\.youtube\.com\/watch\?v=AgoKAyv3gDM/);
  assert.match(manual, /https:\/\/www\.youtube\.com\/watch\?v=pamrCvBMwX0/);
});
