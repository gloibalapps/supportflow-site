import { checkRequestLicence } from "../lib/licence.mjs";
const API = "https://api.anthropic.com/v1/messages";
const MODEL = process.env.ASSISTANT_MODEL || process.env.ANTHROPIC_MODEL || "claude-haiku-4-5-20251001";

// Server-side proxy for the SupportFlow Assistant -- help-and-navigation
// only, deliberately kept separate from assist.mjs (Claimable's deduction
// checker and note tidying). Different system prompt, different
// boundaries, different rate limit, so a change to one can never quietly
// affect the other.
//
// Reuses the same ANTHROPIC_API_KEY already configured for Claimable --
// same account, same billing, no new secret needed. Model is separately
// configurable via ASSISTANT_MODEL so the two features can be tuned
// independently.
//
// The API key lives here, in a Netlify environment variable, and never
// reaches the browser.

const MAX_QUESTION = 800;
const MAX_CONTEXT = 4000;   // the manual snippets the client selected, not the whole manual
const MAX_HISTORY_TURNS = 6;
const MAX_TOKENS = 350;     // answers are meant to be short and practical, not essays

const WINDOW_MS = 60 * 60 * 1000;
const PER_IP_PER_HOUR = 30;
const hits = new Map();

function overLimit(ip) {
  if (!ip) return false;
  const now = Date.now();
  const list = (hits.get(ip) || []).filter((t) => now - t < WINDOW_MS);
  if (list.length >= PER_IP_PER_HOUR) { hits.set(ip, list); return true; }
  list.push(now);
  hits.set(ip, list);
  if (hits.size > 5000) hits.clear();
  return false;
}

const SYSTEM_PROMPT = `You are the SupportFlow Assistant, built into the SupportFlow app for Australian NDIS
support workers. You help people use the app, nothing else.

STRICT RULES:
- Answer ONLY from the "Relevant manual content" provided in this request. If it doesn't cover the
  question, say so plainly rather than guessing or inventing app features that may not exist.
- You are not a source of legal, tax, accounting, clinical or definitive NDIS compliance advice.
  If asked for any of that, reply with exactly: "I'm designed to help you use SupportFlow. For NDIS,
  tax, legal or professional advice, please use the appropriate official or professional source." and
  nothing else.
- Never state a definitive dollar figure someone owes, or definitively confirm a support item is
  legally billable for a specific situation. You can say where in the app the relevant feature lives
  and how it works, not give the underlying professional judgement.
- Keep answers SHORT and practical. Prefer "Go to Work → Shifts, open the shift, then..." over long
  explanations. Use numbered steps only when genuinely useful.
- If a step in your answer corresponds to a screen the user can be sent to directly, end your answer
  with one line in exactly this form: [[OPEN:key]] using one of these keys only: invoices, shifts,
  travel, notes, people, settings, expenses, tax, backup, tracker. Omit this line entirely if no single screen
  is the clear destination.
- Never claim to have created, deleted, edited or sent anything. You can only explain and point to a
  screen, never perform an action yourself.
- Payment tracker, SMS alerts and push notifications are covered in the user manual (USER-MANUAL.md
  section 14a, and the in-app manual section "Payment tracker, SMS alerts and notifications"). Use only
  the steps in that content. The ONLY prices you may quote are: Basic A$79 once for one device;
  a second device A$29 once, separate from the tracker; the Payment tracker A$29 once, on top of Basic;
  Premium A$149 once (everything in Basic, a two-device licence and the Payment tracker, one-off, no subscription).
  Until the end of 31 January 2027, Australia/Adelaide time, Premium is charged at A$129. That is A$20 less
  once. The percentage under A$149 is (149 minus 129) divided by 149, rounded to the nearest whole percent,
  which is 13%. From 1 February 2027 the charge is A$149. Do not call this a sale, a founding offer, or a cap.
  The optional SMS pack is A$4.99 a month for 50 texts, offered only after the tracker is unlocked, and it is
  NOT included in Basic, the tracker, or Premium. Never quote an A$49 or A$69 tracker price. Never quote,
  estimate or calculate any other price or per-text cost, even if older content mentions one; if asked about
  any other price, say to check the in-app purchase screen. Never describe any option as lifetime, unlimited or
  forever. Always say the SMS pack is optional and separate, and texts only go to the worker's own verified
  mobile. Say push delivery isn't guaranteed and doesn't work in a plain iPhone Safari tab.
  Use [[OPEN:tracker]] for Payment tracker screens.`;

export default async (req) => {
  if (req.method !== "POST") {
    return json({ error: "POST only" }, 405);
  }

  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) {
    return json({ error: "not-configured" }, 503);
  }

  const origin = req.headers.get("origin");
  const host = req.headers.get("host");
  if (origin && host && !origin.includes(host)) {
    return json({ error: "forbidden" }, 403);
  }

  // Device licensing: once the owner switch is on, AI calls need a licensed,
  // active device (checked server-side; see netlify/lib/licence.mjs).
  {
    const lic = await checkRequestLicence(req).catch(() => ({ enforced: false }));
    if (lic.enforced && !lic.ok && !lic.error) return json({ error: "licence-required" }, 402);
  }

  const ip = req.headers.get("x-nf-client-connection-ip") || req.headers.get("x-forwarded-for") || "";
  if (overLimit(ip.split(",")[0].trim())) {
    return json({ error: "rate-limited" }, 429);
  }

  let body;
  try {
    body = await req.json();
  } catch {
    return json({ error: "bad request" }, 400);
  }

  const question = typeof body.question === "string" ? body.question.slice(0, MAX_QUESTION).trim() : "";
  if (!question) {
    return json({ error: "empty question" }, 400);
  }
  const screen = typeof body.screen === "string" ? body.screen.slice(0, 40) : "";
  const manualContext = typeof body.manualContext === "string" ? body.manualContext.slice(0, MAX_CONTEXT) : "";
  const history = Array.isArray(body.history) ? body.history.slice(-MAX_HISTORY_TURNS) : [];

  const messages = [];
  for (const turn of history) {
    if (!turn || (turn.role !== "user" && turn.role !== "assistant")) continue;
    const text = typeof turn.text === "string" ? turn.text.slice(0, 800) : "";
    if (!text) continue;
    messages.push({ role: turn.role, content: text });
  }
  messages.push({
    role: "user",
    content: [
      screen ? `Current screen: ${screen}` : null,
      manualContext ? `Relevant manual content:\n${manualContext}` : "Relevant manual content: (none matched)",
      `Question: ${question}`,
    ].filter(Boolean).join("\n\n"),
  });

  try {
    const res = await fetch(API, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": key,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: MAX_TOKENS,
        system: SYSTEM_PROMPT,
        messages,
      }),
    });

    if (!res.ok) {
      const detail = await res.text();
      console.error("assistant upstream", res.status, detail.slice(0, 500));
      return json({ error: "upstream", status: res.status }, 502);
    }

    const data = await res.json();
    const text = (data.content || [])
      .filter((b) => b.type === "text")
      .map((b) => b.text)
      .join("\n")
      .trim();

    return json({ text });
  } catch (e) {
    console.error("assistant failed", e);
    return json({ error: "failed" }, 500);
  }
};

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });
}
