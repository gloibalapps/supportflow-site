import crypto from "node:crypto";
process.env.TRACKER_DATA_KEY = crypto.randomBytes(32).toString("base64");
process.env.LICENCE_SECRET = "x".repeat(40);
process.env.SUPABASE_URL = "https://supa.test"; process.env.SUPABASE_SERVICE_KEY = "k";
process.env.RESEND_API_KEY = "re_test"; process.env.TRACKER_AUTOSEND_ENABLED = "true"; process.env.TRACKER_AUTOSEND_DRY_RUN = "false";
const T = await import("./lib/tracker.mjs");
const sealed = T.seal({ a: 1 }); if (T.open(sealed).a !== 1) throw 1;
const tok = T.unsubToken("sub1", "h"); if (T.readUnsubToken(tok).s !== "sub1" || T.readUnsubToken(tok + "x")) throw 2;
const calls = [];
const rec = (stage, payer, sent) => ({ id: "r" + stage + payer, google_sub: "sub1", sent_at: sent, due: null, payer_type: payer, thresholds: null, paused: false, closed: false, last_stage_sent: stage, recipient_hash: T.emailHash("pm@x.test"),
  payload_enc: T.seal({ invoiceNo: "9", to: "pm@x.test", m1: { subject: "S1", body: "B1 {bdays}" }, m2: { subject: "S2 {bdays}", body: "B2 by {reply_by}" }, m3: { subject: "Draft", body: "D {bdays}" } }) });
globalThis.fetch = async (url, opt = {}) => {
  url = String(url); calls.push([opt.method || "GET", url.replace("https://supa.test/rest/v1/", ""), opt.body ? JSON.parse(opt.body) : null]);
  const ok = (b) => new Response(JSON.stringify(b), { status: 200 });
  if (url.includes("tracker_prefs?enabled")) return ok([{ google_sub: "sub1", state: "SA", notify_push: true, worker_enc: T.seal({ replyTo: "jane@w.test", name: "Jane" }) }]);
  if (url.includes("licence_payments")) return ok([{ product: "tracker" }]);
  if (url.includes("tracker_records?google_sub")) return ok([rec(0, "plan", "2026-10-01"), rec(2, "plan", "2026-09-01"), rec(1, "self", "2026-10-20")]);
  if (url.includes("tracker_suppressions")) return ok([]);
  if (url.includes("api.resend.com")) return ok({ id: "em_" + calls.length });
  return new Response(null, { status: 204 });
};
// Force a weekday 10am in Adelaide.
T.localNow; const realDTF = Intl.DateTimeFormat;
const mod = await import("./functions/tracker-sender.mjs");
const fixed = new Date("2026-11-05T00:30:00Z"); // 11:00 Adelaide Thu
const RealDate = Date; globalThis.Date = class extends RealDate { constructor(...a) { super(...(a.length ? a : [fixed])); } static now() { return fixed.getTime(); } };
await mod.default();
const sends = calls.filter((c) => c[1].includes("resend")).map((c) => ({ to: c[2].to[0], subject: c[2].subject, reply: c[2].reply_to, unsub: !!c[2].headers["List-Unsubscribe"] }));
console.log(JSON.stringify(sends, null, 1));
console.log(calls.filter((c) => c[1].startsWith("tracker_send_log") && c[2]).map((c) => c[2].status + "/" + c[2].stage + "/" + c[2].recipient_masked).join("  "));
