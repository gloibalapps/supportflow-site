const API = "https://api.anthropic.com/v1/messages";
const MODEL = process.env.ANTHROPIC_MODEL || "claude-haiku-4-5-20251001";

// Server-side proxy for the app's two AI features.
//
// The API key lives here, in a Netlify environment variable, and never reaches
// the browser. The app calls /.netlify/functions/assist with a prompt; this
// forwards it to the model and returns only the text.
//
// Set ANTHROPIC_API_KEY in Netlify: Site configuration → Environment variables.

const MAX_PROMPT = 6000;          // a deduction question is a few hundred characters
const MAX_TOKENS = 1000;

// Best-effort throttle by IP. Serverless instances recycle, so this is a brake
// on runaway cost rather than real security — the client cap and a spend limit
// in the provider console are the other two layers.
const WINDOW_MS = 60 * 60 * 1000;
const PER_IP_PER_HOUR = 25;
const hits = new Map();

function overLimit(ip) {
  if (!ip) return false;
  const now = Date.now();
  const list = (hits.get(ip) || []).filter((t) => now - t < WINDOW_MS);
  if (list.length >= PER_IP_PER_HOUR) { hits.set(ip, list); return true; }
  list.push(now);
  hits.set(ip, list);
  if (hits.size > 5000) hits.clear();          // keep memory bounded
  return false;
}

export default async (req) => {
  if (req.method !== "POST") {
    return json({ error: "POST only" }, 405);
  }

  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) {
    return json({ error: "not-configured" }, 503);
  }

  // Same-origin only. Blocks the most casual form of someone else using your key.
  const origin = req.headers.get("origin");
  const host = req.headers.get("host");
  if (origin && host && !origin.includes(host)) {
    return json({ error: "forbidden" }, 403);
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

  const prompt = typeof body.prompt === "string" ? body.prompt.slice(0, MAX_PROMPT) : "";
  if (!prompt.trim()) {
    return json({ error: "empty prompt" }, 400);
  }

  const payload = {
    model: MODEL,
    max_tokens: MAX_TOKENS,
    messages: [{ role: "user", content: prompt }],
  };

  // The deduction checker reads the ATO and nothing else. Restricting the tool
  // at this level means the model cannot reach an accounting blog even if it
  // wanted to — this is enforced here, not left to the prompt.
  if (body.search) {
    payload.tools = [{
      type: "web_search_20250305",
      name: "web_search",
      max_uses: 5,
      allowed_domains: ["ato.gov.au"],
    }];
  }

  try {
    const res = await fetch(API, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": key,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify(payload),
    });

    if (!res.ok) {
      const detail = await res.text();
      console.error("upstream", res.status, detail.slice(0, 500));
      return json({ error: "upstream", status: res.status }, 502);
    }

    const data = await res.json();
    const blocks = data.content || [];

    const text = blocks
      .filter((b) => b.type === "text")
      .map((b) => b.text)
      .join("\n")
      .trim();

    // Citations come from the search layer, not from the model's own account of
    // what it read. Only pages actually retrieved appear here, and only ATO ones.
    const sources = [];
    const seen = new Set();
    for (const b of blocks) {
      const results =
        b.type === "web_search_tool_result" ? (b.content || []) :
        Array.isArray(b.citations) ? b.citations : [];
      for (const r of results) {
        const url = r.url || r.source || "";
        if (!/^https?:\/\/([a-z0-9-]+\.)*ato\.gov\.au\//i.test(url)) continue;
        if (seen.has(url)) continue;
        seen.add(url);
        sources.push({ title: (r.title || r.page_title || url).slice(0, 160), url });
      }
    }

    return json({ content: [{ type: "text", text }], sources });
  } catch (e) {
    console.error("assist failed", e);
    return json({ error: "failed" }, 500);
  }
};

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });
}
