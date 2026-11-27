import { checkRequestLicence } from "../lib/licence.mjs";
import {
  NOTES_AI_MAX,
  NOTES_AI_MIN,
  NOTES_AI_MODEL_DEFAULT,
  NOTES_AI_SYSTEM_PROMPT,
  redactNoteText,
} from "../lib/notes-ai.mjs";

const API = "https://api.anthropic.com/v1/messages";
const MAX_TOKENS = 1200;
const WINDOW_MS = 60 * 60 * 1000;
export const NOTES_AI_PER_HOUR = 30;

// In-memory brake. A serverless instance recycles, so this is a cost brake
// beside the daily cap in the app, not a durable quota.
const sharedHits = new Map();

export function resetNotesAiAssistLimits() {
  sharedHits.clear();
}

function overLimit(hits, key) {
  if (!key) return false;
  const now = Date.now();
  const list = (hits.get(key) || []).filter((t) => now - t < WINDOW_MS);
  if (list.length >= NOTES_AI_PER_HOUR) {
    hits.set(key, list);
    return true;
  }
  list.push(now);
  hits.set(key, list);
  if (hits.size > 5000) hits.clear();
  return false;
}

function limitKey(req, lic) {
  if (lic && lic.ok && lic.sub) return "user:" + lic.sub;
  const ip = (req.headers.get("x-nf-client-connection-ip") || req.headers.get("x-forwarded-for") || "")
    .split(",")[0].trim();
  return ip ? "ip:" + ip : "";
}

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });
}

// Same licence gate as assist.mjs and supportflow-assistant.mjs: when the
// owner switch is on, a call without an active licensed device is rejected.
// When the switch is off, the app does not send a session, and the call is
// allowed through the same-origin and rate-limit checks those functions use.
export async function handleNotesAiAssist(req, deps = {}) {
  const fetchImpl = deps.fetch || fetch;
  const check = deps.checkRequestLicence || checkRequestLicence;
  const env = deps.env || process.env;
  const hits = deps.hits || sharedHits;

  if (req.method !== "POST") return json({ error: "POST only" }, 405);

  const origin = req.headers.get("origin");
  const host = req.headers.get("host");
  if (origin && host && !origin.includes(host)) return json({ error: "forbidden" }, 403);

  let lic;
  try {
    lic = await check(req);
  } catch {
    lic = { enforced: false, ok: false, error: true };
  }
  if (lic && lic.enforced && !lic.ok && !lic.error) {
    return json({ error: "licence-required" }, 402);
  }

  if (!env.ANTHROPIC_API_KEY) {
    return json({ error: "AI assist isn't configured yet" }, 503);
  }

  let body;
  try {
    body = await req.json();
  } catch {
    return json({ error: "bad request" }, 400);
  }
  if (!body || typeof body !== "object" || typeof body.text !== "string") {
    return json({ error: "bad request" }, 400);
  }
  if (body.text.length > NOTES_AI_MAX) return json({ error: "too-long" }, 413);

  const text = redactNoteText(body.text).trim();
  if (text.length < NOTES_AI_MIN) return json({ error: "too-short" }, 400);

  if (overLimit(hits, limitKey(req, lic))) return json({ error: "rate-limited" }, 429);

  const payload = {
    model: env.ANTHROPIC_MODEL || NOTES_AI_MODEL_DEFAULT,
    max_tokens: MAX_TOKENS,
    system: NOTES_AI_SYSTEM_PROMPT,
    messages: [{ role: "user", content: text }],
  };

  try {
    const res = await fetchImpl(API, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": env.ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      try { await res.text(); } catch { /* never log upstream bodies */ }
      console.error("notes-ai-assist upstream", res.status);
      return json({ error: "upstream" }, 502);
    }
    const data = await res.json();
    const out = (data.content || [])
      .filter((b) => b && b.type === "text" && typeof b.text === "string")
      .map((b) => b.text)
      .join("\n")
      .trim();
    if (!out) return json({ error: "empty" }, 502);
    return json({ text: out });
  } catch {
    console.error("notes-ai-assist failed");
    return json({ error: "failed" }, 500);
  }
}

export default function notesAiAssist(req) {
  return handleNotesAiAssist(req);
}
