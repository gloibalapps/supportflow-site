// Run: node --test netlify/notes-ai-assist.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { handleNotesAiAssist, NOTES_AI_PER_HOUR } from "./functions/notes-ai-assist.mjs";
import { redactNoteText, scrubNoteForAssist, notesAssistRequestBody } from "./lib/notes-ai.mjs";

const KEY = "test-key-not-real";
const NOTE = "Supported a planned grocery shop. The participant chose each item from their list, compared two prices, and paid at the checkout. No incident. Back home they unpacked the bags.";

function req(body, headers = {}) {
  return new Request("https://supportflow.work/.netlify/functions/notes-ai-assist", {
    method: "POST",
    headers: { "content-type": "application/json", origin: "https://supportflow.work", host: "supportflow.work", ...headers },
    body: JSON.stringify(body),
  });
}

function allow() {
  return async () => ({ enforced: false, ok: false });
}

test("missing API key returns 503 and does not call Anthropic", async () => {
  let called = 0;
  const res = await handleNotesAiAssist(req({ text: NOTE }), {
    env: {},
    checkRequestLicence: allow(),
    fetch: async () => { called += 1; return new Response("no"); },
    hits: new Map(),
  });
  assert.equal(res.status, 503);
  assert.equal(res.headers.get("cache-control"), "no-store");
  assert.deepEqual(await res.json(), { error: "AI assist isn't configured yet" });
  assert.equal(called, 0);
});

test("unauthenticated call is rejected when licensing is enforced", async () => {
  let called = 0;
  const res = await handleNotesAiAssist(req({ text: NOTE }), {
    env: { ANTHROPIC_API_KEY: KEY },
    checkRequestLicence: async () => ({ enforced: true, ok: false }),
    fetch: async () => { called += 1; return new Response("no"); },
    hits: new Map(),
  });
  assert.equal(res.status, 402);
  assert.equal((await res.json()).error, "licence-required");
  assert.equal(called, 0);
});

test("payload sends only redacted note text", async () => {
  let sent;
  const raw = "Met Alex at 12 Sunrise Ave, Adelaide SA 5000. NDIS 431234567. Email alex.j@example.com. Phone 0423 111 222. DOB: 01/02/1990. " + NOTE;
  const res = await handleNotesAiAssist(req({
    text: raw,
    participantName: "Alex Johnson",
    ndisNumber: "431234567",
    workerName: "Sam Taylor",
    address: "12 Sunrise Ave, Adelaide SA 5000",
    dateOfBirth: "01/02/1990",
    email: "alex.j@example.com",
  }), {
    env: { ANTHROPIC_API_KEY: KEY, ANTHROPIC_MODEL: "claude-test" },
    checkRequestLicence: allow(),
    hits: new Map(),
    fetch: async (_url, opts) => {
      sent = { url: _url, headers: opts.headers, body: JSON.parse(opts.body) };
      return new Response(JSON.stringify({ content: [{ type: "text", text: "A plain progress note. [add how this relates to the participant's goals]" }] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    },
  });
  assert.equal(res.status, 200);
  assert.equal(res.headers.get("cache-control"), "no-store");
  const client = await res.json();
  assert.deepEqual(Object.keys(client), ["text"]);
  assert.equal(client.text.includes(KEY), false);
  assert.equal(sent.headers["x-api-key"], KEY);
  assert.equal(sent.body.model, "claude-test");
  assert.deepEqual(Object.keys(sent.body).sort(), ["max_tokens", "messages", "model", "system"]);
  assert.equal(sent.body.messages.length, 1);
  assert.equal(sent.body.messages[0].role, "user");
  const blob = JSON.stringify(sent.body);
  assert.equal(blob.includes("Alex Johnson"), false);
  assert.equal(blob.includes("Sam Taylor"), false);
  assert.equal(blob.includes("431234567"), false);
  assert.equal(blob.includes("alex.j@example.com"), false);
  assert.equal(blob.includes("0423 111 222"), false);
  assert.equal(blob.includes("12 Sunrise Ave"), false);
  assert.equal(blob.includes("01/02/1990"), false);
  assert.equal(blob.includes("participantName"), false);
  assert.match(sent.body.messages[0].content, /grocery shop/);
  assert.match(sent.body.system, /Do not invent/);
});

test("known names are stripped before a request body is built", () => {
  const text = scrubNoteForAssist(
    "Alex Johnson chose the apples. Sam Taylor drove. NDIS 431234567.",
    {
      participantNames: ["Alex Johnson"],
      workerNames: ["Sam Taylor"],
      identifiers: ["431234567"],
    }
  );
  assert.equal(/Alex|Johnson|Sam|Taylor|431234567/.test(text), false);
  assert.match(text, /the participant/);
  assert.match(text, /the support worker/);
  assert.deepEqual(Object.keys(notesAssistRequestBody(text)), ["text"]);
  assert.equal(notesAssistRequestBody(text).text, text);
});

test("redactNoteText removes obvious identifiers", () => {
  const out = redactNoteText("Call 0423 111 222 or alex.j@example.com about NDIS 431234567 at 12 Sunrise Ave.");
  assert.equal(/0423|alex\.j@|431234567|Sunrise/.test(out), false);
});

test("oversized input is rejected before Anthropic is called", async () => {
  let called = 0;
  const res = await handleNotesAiAssist(req({ text: "a".repeat(8001) }), {
    env: { ANTHROPIC_API_KEY: KEY },
    checkRequestLicence: allow(),
    fetch: async () => { called += 1; return new Response("no"); },
    hits: new Map(),
  });
  assert.equal(res.status, 413);
  assert.equal((await res.json()).error, "too-long");
  assert.equal(called, 0);
});

test("rate limit is per caller and does not log the note", async () => {
  const hits = new Map();
  const logs = [];
  const orig = console.error;
  console.error = (...args) => { logs.push(args.map(String).join(" ")); };
  let called = 0;
  try {
    const opts = {
      env: { ANTHROPIC_API_KEY: KEY },
      checkRequestLicence: async () => ({ enforced: true, ok: true, sub: "user-1" }),
      hits,
      fetch: async () => {
        called += 1;
        if (called === 1) {
          return new Response("upstream echoed UNIQUE_NOTE_PHRASE", { status: 500 });
        }
        return new Response(JSON.stringify({ content: [{ type: "text", text: "Noted." }] }), { status: 200 });
      },
    };
    const headers = { "x-nf-client-connection-ip": "203.0.113.9" };
    const first = await handleNotesAiAssist(req({ text: NOTE + " UNIQUE_NOTE_PHRASE" }, headers), opts);
    assert.equal(first.status, 502);
    for (let i = 1; i < NOTES_AI_PER_HOUR; i++) {
      const res = await handleNotesAiAssist(req({ text: NOTE }, headers), opts);
      assert.equal(res.status, 200);
    }
    const blocked = await handleNotesAiAssist(req({ text: NOTE }, headers), opts);
    assert.equal(blocked.status, 429);
    assert.equal(called, NOTES_AI_PER_HOUR);
    assert.equal(logs.some((line) => line.includes("UNIQUE_NOTE_PHRASE") || line.includes("grocery")), false);
  } finally {
    console.error = orig;
  }
});
