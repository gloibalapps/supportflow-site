// Payment tracker: scheduled automatic chasers. See PAYMENT-TRACKER.md.
//
// Runs hourly. Does NOTHING unless TRACKER_AUTOSEND_ENABLED=true, and while
// TRACKER_AUTOSEND_DRY_RUN is not "false" it only writes "dry_run" rows to the
// send log. Sends only on the worker's business days, 9am-4pm their time.
//
// Per open invoice record, the latest stage reached (never a backlog):
//   plan-managed  stage 1 (BD 7) + 2 (BD 12) -> plan manager, Reply-To worker
//                 stage 3 (BD 20)           -> WORKER ONLY: ready-to-file NDIA complaint draft
//   self-managed  stage 1 + 2               -> participant / nominee, Reply-To worker
//                 stage 3                   -> worker only: NDIA contact draft
//   NDIA-managed  stages 1-3 (BD 3/10/15)   -> worker only (portal checks, NDIA enquiry draft)
// Every stage also pushes a notification to the worker's devices if they
// subscribed. Nothing is ever filed with the NDIA or the Commission.
import { supa } from "../lib/licence.mjs";
import { autosendEnabled, autosendDryRun, open, maskEmail, unsubToken, localNow, resendSend, trackerUnlock } from "../lib/tracker.mjs";
import { sendWorkerSms, smsEnabled } from "../lib/sms.mjs";
import { trackerStage, trackerFillDynamic, isBusinessDay, TRACKER_STAGE_LABEL } from "../../payment-tracker-rules.js";

export const config = { schedule: "5 * * * *" };
const q = encodeURIComponent;
const MAX_PER_RUN = 200;

async function log(row) {
  try { await supa("tracker_send_log", { method: "POST", prefer: "return=minimal", body: { ...row, created_at: new Date().toISOString() } }); }
  catch (e) { console.warn("tracker-sender: log failed", e.message); }
}

let webpush = null;
async function pushTo(sub, title, body) {
  if (!process.env.VAPID_PUBLIC_KEY || !process.env.VAPID_PRIVATE_KEY) return 0;
  if (!webpush) {
    webpush = (await import("web-push")).default;
    webpush.setVapidDetails(process.env.VAPID_SUBJECT || "mailto:support@supportflow.work", process.env.VAPID_PUBLIC_KEY, process.env.VAPID_PRIVATE_KEY);
  }
  const subs = (await supa(`tracker_push_subs?google_sub=eq.${q(sub)}&select=device_id,sub_enc`)) || [];
  let n = 0;
  for (const s of subs) {
    try {
      // No invoice or participant detail in the push payload: it passes
      // through Apple/Google/Mozilla push services and can show on a lock screen.
      await webpush.sendNotification(open(s.sub_enc), JSON.stringify({ title, body, url: "/app?open=tracker" }), { TTL: 86400 });
      n++;
    } catch (e) {
      if (e.statusCode === 404 || e.statusCode === 410) {
        await supa(`tracker_push_subs?google_sub=eq.${q(sub)}&device_id=eq.${q(s.device_id)}`, { method: "DELETE", prefer: "return=minimal" });
      }
    }
  }
  return n;
}

// <= 160 GSM-7 chars incl. the " Reply STOP to opt out." suffix added by sendWorkerSms.
export function smsText(payerType, stage, invoiceNo, toWorkerOnly, status) {
  const inv = `Invoice ${String(invoiceNo || "").slice(0, 12)}`;
  if (stage === 3) return `SupportFlow: ${inv} is unpaid. Your NDIA ${payerType === "agency" ? "enquiry" : "complaint"} draft is ready in the app. Nothing has been filed.`;
  if (payerType === "agency") return `SupportFlow: ${inv} is still unpaid. Check the myplace portal.`;
  const d = stage === 1 ? "7" : "12";
  return `SupportFlow: ${inv} is ${d} business days unpaid.${status === "sent" ? " Reminder emailed to the payer." : " Open the app to review."}`;
}
// Once per billing period: tell the worker texts ran out and alerts continue as push.
async function creditsGoneNotice(sub, dry) {
  const prof = (await supa(`tracker_sms_profiles?google_sub=eq.${q(sub)}&select=low_notice_at`))?.[0];
  if (!prof || prof.low_notice_at) return;
  await supa(`tracker_sms_profiles?google_sub=eq.${q(sub)}`, { method: "PATCH", prefer: "return=minimal", body: { low_notice_at: new Date().toISOString() } });
  const n = dry ? 0 : await pushTo(sub, "SMS alerts used up", "You've used this month's 50 texts. Alerts continue as notifications until your pack renews.");
  await log({ google_sub: sub, stage: 0, channel: "push", recipient_masked: n ? `${n} device(s)` : null, subject: "SMS credits used up", status: dry ? "dry_run" : n ? "sent" : "skipped", detail: "Fell back to push" });
}

function footer(sub, rhash, worker) {
  const site = process.env.SITE_URL || "https://supportflow.work";
  return `\n\n--\nSent on behalf of ${worker.name || "your support worker"} by SupportFlow, an invoicing app for NDIS support workers. ` +
    `Replies go straight to ${worker.name || "them"}.\n` +
    `To stop automatic payment reminders from this sender: ${site}/.netlify/functions/tracker-unsubscribe?t=${unsubToken(sub, rhash)}`;
}

async function runWorker(prefs) {
  const sub = prefs.google_sub;
  if (!(await trackerUnlock(sub))) return { skipped: "locked" };
  const now = localNow(prefs.state);
  if (!isBusinessDay(now.date, prefs.state) || now.hour < 9 || now.hour >= 16) return { skipped: "outside hours" };
  const worker = open(prefs.worker_enc);
  const recs = (await supa(`tracker_records?google_sub=eq.${q(sub)}&closed=eq.false&paused=eq.false&stop_reason=is.null&select=*`)) || [];
  const supp = new Set(((await supa(`tracker_suppressions?google_sub=eq.${q(sub)}&select=recipient_hash`)) || []).map((r) => r.recipient_hash));
  const dry = autosendDryRun();
  let sent = 0;
  for (const r of recs) {
    const st = trackerStage({ sentAt: r.sent_at, due: r.due, payerType: r.payer_type, thresholds: r.thresholds ? { [r.payer_type]: r.thresholds } : null, state: prefs.state, asOf: now.date });
    if (st.stage < 1 || st.stage <= (r.last_stage_sent || 0)) continue;
    const p = open(r.payload_enc);
    const stage = st.stage;
    const dyn = (t) => trackerFillDynamic(t, { sentAt: r.sent_at, state: prefs.state, asOf: now.date });
    const toWorkerOnly = r.payer_type === "agency" || stage === 3;
    const msg = p[`m${stage}`];
    const base = { google_sub: sub, record_id: r.id, stage, invoice_no: p.invoiceNo || null };
    let status = "sent", detail = null, channel = "email", recipient = toWorkerOnly ? worker.replyTo : p.to;

    if (!toWorkerOnly && r.recipient_hash && supp.has(r.recipient_hash)) {
      status = "suppressed"; detail = "Recipient unsubscribed from automatic reminders";
      await supa(`tracker_records?id=eq.${q(r.id)}`, { method: "PATCH", prefer: "return=minimal", body: { stop_reason: "unsubscribed", updated_at: new Date().toISOString() } });
    } else if (!recipient || !msg?.subject || !msg?.body) {
      status = "skipped"; detail = !recipient ? "No email address" : "No message text";
    } else if (dry) {
      status = "dry_run";
    } else {
      try {
        const isThirdParty = !toWorkerOnly;
        const text = dyn(msg.body) + (isThirdParty ? footer(sub, r.recipient_hash, worker) : "\n\n--\nSupportFlow Payment tracker. Nothing has been filed for you. Turn automatic emails off in Settings > Payment tracker.");
        const site = process.env.SITE_URL || "https://supportflow.work";
        const headers = isThirdParty ? {
          "List-Unsubscribe": `<${site}/.netlify/functions/tracker-unsubscribe?t=${unsubToken(sub, r.recipient_hash)}>`,
          "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
        } : {};
        detail = await resendSend({
          to: recipient, subject: dyn(msg.subject), text, replyTo: isThirdParty ? worker.replyTo : undefined,
          fromName: isThirdParty ? worker.name : "SupportFlow", headers, idempotencyKey: `${r.id}-s${stage}`,
        });
      } catch (e) { status = "failed"; detail = String(e.message).slice(0, 300); }
    }
    await log({ ...base, channel, recipient_masked: recipient ? maskEmail(recipient) : null, subject: msg?.subject ? dyn(msg.subject).slice(0, 200) : null, status, detail });
    if (status === "sent" || status === "dry_run" || status === "suppressed" || status === "skipped") {
      // Move on even when skipped, so a missing address can't retry every hour.
      await supa(`tracker_records?id=eq.${q(r.id)}`, { method: "PATCH", prefer: "return=minimal", body: { last_stage_sent: stage, last_sent_at: new Date().toISOString(), updated_at: new Date().toISOString() } });
    }
    if (status === "sent" || status === "dry_run" || status === "skipped") {
      const label = TRACKER_STAGE_LABEL[r.payer_type]?.[stage] || "Payment update";
      const what = toWorkerOnly ? "A draft is ready in SupportFlow." : status === "sent" ? "A reminder email was sent for you." : "Open SupportFlow to review.";
      // Optional paid SMS to the worker's own verified mobile (never the payer).
      // Short, no participant or payer names. Falls back to push when out of credits.
      let smsDone = false;
      if (smsEnabled()) {
        const sms = await sendWorkerSms(sub, smsText(r.payer_type, stage, p.invoiceNo, toWorkerOnly, status));
        if (sms.status !== "off" && sms.status !== "not_set_up") {
          await log({ ...base, channel: "sms", recipient_masked: sms.to || null, subject: `${label} (${sms.segments || 0} credit${sms.segments === 1 ? "" : "s"})`, status: sms.status === "sent" || sms.status === "dry_run" ? sms.status : sms.status === "no_credits" ? "no_credits" : "failed", detail: sms.detail || (sms.balance != null ? `${sms.balance} left` : null) });
        }
        smsDone = sms.status === "sent" || sms.status === "dry_run";
        if (sms.status === "no_credits") await creditsGoneNotice(sub, dry);
      }
      // Free email alert to the worker's own address (the payer never sees this). Skipped for the
      // NDIA draft stage, which already emails the worker.
      if (prefs.notify_email !== false && !toWorkerOnly && worker.replyTo && !dry) {
        try {
          await resendSend({
            to: worker.replyTo, subject: `Unpaid invoice${p.invoiceNo ? " #" + p.invoiceNo : ""}: ${label}`,
            text: `${what}\n\nOpen SupportFlow > Money > Payment tracker to see it.\n\n--\nSupportFlow Payment tracker. Turn these emails off in Payment tracker > Settings.`,
            fromName: "SupportFlow", idempotencyKey: `${r.id}-w${stage}`,
          });
          await log({ ...base, channel: "email_worker", recipient_masked: maskEmail(worker.replyTo), subject: label, status: "sent" });
        } catch (e) { console.error("tracker-sender: worker email failed", String(e.message).slice(0, 120)); }
      }
      if (prefs.notify_push && !smsDone) {
        const n = dry ? 0 : await pushTo(sub, `Unpaid invoice: ${label}`, what);
        if (n) await log({ ...base, channel: "push", recipient_masked: `${n} device(s)`, subject: label, status: "sent" });
      }
    }
    if (++sent >= MAX_PER_RUN) break;
  }
  return { sent };
}

export default async () => {
  if (!autosendEnabled()) { console.log("tracker-sender: TRACKER_AUTOSEND_ENABLED is off; nothing to do"); return new Response("off"); }
  const workers = (await supa("tracker_prefs?enabled=eq.true&select=*")) || [];
  const out = [];
  for (const w of workers) {
    try { out.push(await runWorker(w)); } catch (e) { console.error("tracker-sender:", w.google_sub.slice(0, 6), e.message); }
  }
  // Retention: closed records are deleted after 30 days; the log after 13 months.
  const cut = new Date(Date.now() - 30 * 86400000).toISOString();
  await supa(`tracker_records?closed=eq.true&closed_at=lt.${q(cut)}`, { method: "DELETE", prefer: "return=minimal" }).catch(() => {});
  const logCut = new Date(Date.now() - 396 * 86400000).toISOString();
  await supa(`tracker_send_log?created_at=lt.${q(logCut)}`, { method: "DELETE", prefer: "return=minimal" }).catch(() => {});
  console.log("tracker-sender:", JSON.stringify({ workers: workers.length, dry: autosendDryRun() }));
  return new Response("ok");
};
