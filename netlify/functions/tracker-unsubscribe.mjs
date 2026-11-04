// One-click unsubscribe for people who receive automatic payment reminders
// (plan managers, self-managed participants). Spam Act 2003 s18 style:
// works without logging in, takes effect immediately (the Act allows up to
// 5 business days), and also honours RFC 8058 List-Unsubscribe-Post.
import { supa } from "../lib/licence.mjs";
import { readUnsubToken } from "../lib/tracker.mjs";

const page = (title, msg, form = "") => new Response(
  `<!doctype html><html lang="en-AU"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex">` +
  `<title>${title}</title><body style="font:16px/1.5 system-ui;max-width:520px;margin:48px auto;padding:0 16px"><h1 style="font-size:22px">${title}</h1><p>${msg}</p>${form}</body></html>`,
  { headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" } });

export default async (req) => {
  const url = new URL(req.url);
  const t = url.searchParams.get("t") || "";
  const tok = readUnsubToken(t);
  if (!tok?.s || !tok?.r) return page("Link not recognised", "This unsubscribe link is incomplete. Reply to the email and ask the sender to stop reminders.");
  if (req.method === "GET") {
    return page("Stop payment reminders?",
      "You'll stop getting automatic payment reminder emails sent through SupportFlow from this support worker. They can still contact you directly.",
      `<form method="post"><input type="hidden" name="t" value="${t.replace(/[^\w.\-]/g, "")}"><button style="font-size:16px;padding:10px 18px">Stop reminders</button></form>`);
  }
  if (req.method !== "POST") return new Response("Method not allowed", { status: 405 });
  await supa("tracker_suppressions?on_conflict=google_sub,recipient_hash", {
    method: "POST", prefer: "resolution=ignore-duplicates,return=minimal", body: { google_sub: tok.s, recipient_hash: tok.r, created_at: new Date().toISOString() },
  });
  const now = new Date().toISOString();
  await supa(`tracker_records?google_sub=eq.${encodeURIComponent(tok.s)}&recipient_hash=eq.${encodeURIComponent(tok.r)}`, {
    method: "PATCH", prefer: "return=minimal", body: { stop_reason: "unsubscribed", updated_at: now },
  });
  await supa("tracker_send_log", { method: "POST", prefer: "return=minimal", body: { google_sub: tok.s, stage: 0, channel: "unsubscribe", status: "unsubscribed", detail: "Recipient used the unsubscribe link", created_at: now } });
  return page("Done", "You won't get any more automatic payment reminders from this sender through SupportFlow.");
};
