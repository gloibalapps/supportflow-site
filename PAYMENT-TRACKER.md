# Payment tracker add-on: build notes, setup and launch blockers

Status: built on the local branch `feature/payment-tracker` only. It has not been pushed or deployed. No Stripe objects exist, no migration has been applied, and no Netlify env vars have been changed.
Supersedes these decisions in payment-tracker-brief.md: D1 (price) and D2 (one-tap send).

## Pricing (owner-confirmed 5 Nov 2026)
- **A$99 one-off** unlocks the tracker for one device (`tracker`).
- **A$29 one-off** adds a second device, for example a PC and a phone (`tracker_second_device`). It is only sold after the A$99 unlock. Seats work like the main licence: the first N devices to open the tracker hold the seats, and a device that hasn't been seen for 21 days frees its seat.
- The entitlement is per Google account. It is recorded in `licence_payments`, the same ledger as licences, and **only** the Stripe webhook writes it. Refunds and disputes reverse it through the existing `handleLicenceReversal`.

## What is built
| Area | Where |
|---|---|
| One overdue rule (sent + unpaid + past due). Drafts are never "owed" | `isOverdue()` in app.jsx; used by the list, the Awaiting panel, the shift calendar and flags |
| `sentAt` (stamped on share or status→sent, editable, old invoices back-filled as "estimated"), `paidAt` and `amountPaid` (Mark paid sheet). Income counts the amount actually received | app.jsx Editor, SendPanel, MarkPaidSheet, load migration |
| Status labels a person would say (Not sent yet / Waiting / Overdue / Paid / Part paid); stage badges | `INV_STATUS_LABEL`, `STAGE_TONE` |
| Badges: red dot on the Money tab, "N overdue" on the Invoices card | flags, ShortcutCard `badge` |
| Filters: All / Not sent / Waiting / Overdue / Paid, with counts | InvoiceList |
| Home "Money owed to you" dashboard card | Home hub |
| Tracker screens: list (Needs action / Waiting / Paid), invoice detail + timeline + log a call/reply + pause, message view/edit per stage, NDIA draft with Copy fields, patterns P1–P4/P6, CSV report (accountant / complaint mode), settings (state, thresholds, auto-send, NDIS-number consent, push, send log) | `PaymentTracker`, `TrackerReport` |
| Business days with national and state public holidays, and the stage/due-date rule. One source shared by the app and the server | `payment-tracker-rules.js` (inlined into app.jsx by `build-app.mjs`), tests in `payment-tracker-rules.test.mjs` |
| Paywall: locked/upsell state, Google sign-in (works while licensing is off), Stripe checkout, device seats | `useTrackerAccess`, `TrackerUpsell`; `netlify/functions/tracker.mjs`; `netlify/lib/tracker.mjs` |
| Webhook: `metadata.kind = "tracker"` → `licence_payments` | `stripe-webhook.mjs` |
| Server auto-send: hourly scheduled function. **OFF unless `TRACKER_AUTOSEND_ENABLED=true`**, and dry-run unless `TRACKER_AUTOSEND_DRY_RUN=false` | `netlify/functions/tracker-sender.mjs` (mock test: `netlify/tracker-sender.test.mjs`) |
| Unsubscribe page and RFC 8058 one-click; suppression list; per-worker send log | `tracker-unsubscribe.mjs`, `tracker_send_log` |
| Web push (VAPID) to the worker's devices | sw.js `push`/`notificationclick`, `web-push` dependency |
| Migration (NOT APPLIED) | `TRACKER-MIGRATION.sql` |

## How auto-send works with the phone closed
1. When the worker turns on "Send automatically", the app shows a consent prompt. It then syncs a **minimised record** for each open invoice to `tracker.mjs`. The record holds sent date, due date, payer type, thresholds and the paused flag in the clear. The invoice no., amount, recipient email and name, and the rendered message text (including any edits) are sealed with AES-256-GCM under `TRACKER_DATA_KEY` before they reach Supabase. The id is an HMAC of (account, local invoice id). Paid, deleted or no-longer-open invoices are closed on the next sync and deleted after 30 days. Turning auto-send off deletes everything synced.
2. `tracker-sender` runs hourly. For each enabled, unlocked worker, it only acts on that worker's state business days, between 9am and 4pm their time. It sends the **latest** stage reached and never a backlog. The server owns `last_stage_sent`, and Resend idempotency keys stop double sends.
   - Plan-managed: day 7 and day 12 → plan manager. Day 20 → **the worker only**, with the ready-to-file NDIA complaint draft. Nothing is ever filed.
   - Self-managed: day 7 and day 12 → participant/nominee (gentle wording). Day 20 → worker only, with the NDIA contact draft.
   - NDIA-managed: day 3, 10 and 15 (brief s5.1) → worker only. These are portal checks plus an NDIA enquiry draft.
   - Each stage also sends a push to the worker's subscribed devices. The payload has no personal details.
3. RLS is enabled on every new table with no policies, so only the service key used by the functions can access them. This is the same model as the licensing tables. The app has no Supabase auth: workers are identified by the server-signed Google session.

## Sending identity
Mail goes `From: "Jane Smith via SupportFlow" <invoices@send.supportflow.work>`, `Reply-To: <worker's email>`. **Sending as the worker's own address isn't feasible.** Resend only sends from domains SupportFlow has verified with SPF/DKIM. Putting a worker's gmail.com/outlook.com address in From fails DMARC (Gmail and Yahoo reject or spam it). The alternative, Gmail/Microsoft send-on-behalf OAuth, needs the restricted `gmail.send` scope, which means a Google CASA security assessment, plus a Microsoft publisher verification. That is weeks of work and an annual cost, so it isn't worth it for v1. Replies still go straight to the worker.

## Stripe setup (do in TEST mode first; nothing has been created)
1. Product "SupportFlow Payment tracker", with a one-off Price of **A$99.00 AUD** → set `STRIPE_PRICE_TRACKER`.
2. Product "Payment tracker: second device", with a one-off Price of **A$29.00 AUD** → set `STRIPE_PRICE_TRACKER_SECOND_DEVICE`.
3. Optional display overrides: `TRACKER_LABEL`, `TRACKER_AUD`, `TRACKER_SECOND_DEVICE_LABEL`, `TRACKER_SECOND_DEVICE_AUD`.
4. Webhook: reuse the existing `/.netlify/functions/stripe-webhook` endpoint and `STRIPE_WEBHOOK_SECRET`. Make sure it listens for `checkout.session.completed`, `checkout.session.async_payment_succeeded`, `charge.refunded`, `charge.dispute.created` and `charge.dispute.closed` (the same events as licences). Checkout sessions carry `metadata.kind=tracker`, `product`, `google_sub` and `device_id`. The `?tracker=success` return never unlocks anything: the app polls `status` until the webhook lands.
5. Existing env vars that are reused: `STRIPE_SECRET_KEY`, `SITE_URL`, `SUPABASE_URL`, `SUPABASE_SERVICE_KEY`, `LICENCE_SECRET`, `GOOGLE_CLIENT_ID`, `RESEND_API_KEY`.
6. New env vars: `TRACKER_DATA_KEY` (`openssl rand -base64 32`; losing it makes the synced records unreadable), `TRACKER_EMAIL_FROM`, `VAPID_PUBLIC_KEY`/`VAPID_PRIVATE_KEY`/`VAPID_SUBJECT` (`npx web-push generate-vapid-keys`), `TRACKER_AUTOSEND_ENABLED` (leave unset), `TRACKER_AUTOSEND_DRY_RUN` (default true).
7. Apply `TRACKER-MIGRATION.sql` after `LICENSING-MIGRATION.sql`. It widens the `licence_payments.product` check.
8. Test: a test-mode purchase → webhook row → status unlocked → a second device is blocked until the A$29 purchase → refund re-locks.

Owner testing without paying: `/app?trackerpreview=1` unlocks the screens on that device only (`=0` to clear). It cannot send anything, because the server re-checks the unlock.

## SMS (researched 5 Nov 2026)
| Provider | AU outbound per SMS segment | Notes |
|---|---|---|
| Twilio | US$0.0515 (~A$0.074) | Alphanumeric sender free; +US$0.001 per failed message (twilio.com/en-us/sms/pricing/au, "current as of October 2026") |
| AWS End User Messaging (SNS) | US$0.04 (~A$0.057) + carrier fees | Long code ~US$22/mo; sender ID registration required (AWS docs; cloudlesslabs.com) |
| Telnyx | US$0.05 (~A$0.072) | No minimum (comparesmsproviders.com.au, updated 19 Oct 2026) |
| Sinch MessageMedia | A$0.079 (Basics, A$45/mo for 570) down to A$0.045; overage 5.9–8c | **12-month minimum term** (Sinch Critical Information Summary) |
| Web push (PWA) | **Free** | Android/desktop browsers; iOS/iPadOS 16.4+ only from a Home Screen web app (webkit.org/blog/13878) |

Sender ID: from **1 July 2026** every alphanumeric sender ID sent to AU mobiles must be on the ACMA **SMS Sender ID Register**, or the message is labelled "Unverified". Registration needs an ABN, an ABR authorised contact, an ID check, and an ID of 2–11 characters matching the business name, brand or domain (e.g. "SupportFlw"). It is done through the provider or ACMA. Reply-capable SMS needs a dedicated number (~A$8–30/mo).

**Answer: SMS costs money on every message**, about A$0.06–0.08 per text plus a number or registration. It is not free, so propose it as a **separate paid add-on**. A typical worker with ~8 open invoices a month and ≤3 alerts each is about 25 texts/month, roughly A$1.90/mo of cost. Suggested price: **A$4.99/month for 50 texts**, or a one-off **A$19 pack of 200 texts** (cost ≈A$15 incl. GST and Stripe fee, so the margin is thin). The better one-off is **A$15 for 100 texts**: cost ≈A$7.5 + Stripe ≈A$0.5, so ~45% margin. The monthly plan is ~A$1.9 cost + ~A$0.4 Stripe vs A$4.99, so ~55% margin. Default to **free web push**, which covers the "tell the worker it's overdue" need on Android and on home-screen iPhones.

## Spam Act 2003
These reminders are factual messages about an existing invoice with no promotion, so they are likely "designated commercial electronic messages" (Sch 1 cl 2), exempt from consent and unsubscribe rules. They still **must** identify the sender, so footers name the worker and SupportFlow. As a safeguard, every third-party email carries a working unsubscribe link and a List-Unsubscribe header. The link is honoured immediately (the Act allows 5 business days) and logged. **Never add marketing (e.g. "made with SupportFlow, try it")**, because that would make the messages commercial. "STOP" replies go to the worker (Reply-To), not to SupportFlow. The app tells the worker to stop chasing manually; the unsubscribe link is the automated path.

## iOS push limits
Push works only on iOS/iPadOS 16.4+, only after the user adds SupportFlow to the Home Screen and opens it from there, and only after they tap the button to allow notifications. A Safari tab cannot subscribe. On iOS 16.4–18, the manifest `display: standalone` is needed (it is already set). Safari revokes permission if a push arrives without a visible notification, which is why the service worker always shows one. iPhone keeps Safari and Home Screen storage separate, so the Home Screen app needs its own sign-in. Delivery isn't guaranteed (Focus modes, Low Power). Treat push as a nudge, with email as the record.

## Launch blockers
1. **Legal/privacy:** this is the first time invoice and participant-related data leaves the device. PRIVACY-POLICY.md, privacy.html, DATA-SECURITY.md ("no central developer database") and the Terms need updating: what is stored, the purpose, encryption, 30-day deletion, the US-hosted Resend (an APP 8 cross-border disclosure) and Supabase region, and the worker's responsibility for participant consent (NDIS number off by default). Get a privacy-lawyer review.
2. **Resend domain:** verify `send.supportflow.work` (SPF, DKIM, DMARC with p=none→quarantine), warm it up, and monitor bounces and complaints. Use a separate subdomain so tracker mail can't hurt licence and tester mail.
3. **Pricing:** confirmed at A$99 + A$29. The Stripe products still need creating, and the pricing page/PRICING.md need the wording.
4. **iOS push limits** (above). **Public holiday table:** the computed rules need checking against data.gov.au. WA's King's Birthday is approximated as the last Monday in September; part-day/regional holidays are ignored.
5. **Testing:** Stripe test-mode purchase/refund/second device; a dry-run sender week with `TRACKER_AUTOSEND_DRY_RUN=true`; real devices (Android Chrome, iPhone Home Screen); a deliverability check (mail-tester, Gmail/Outlook inboxes); the migration on a Supabase branch first.
6. The owner decides on open brief questions 2, 10 and 11 (Commission option, NDIA-managed eligibility, self-managed BD-20).

## Not built (design only / remaining)
- PDF report (CSV only now; reuse the jsPDF incident code).
- SMS add-on (design and pricing above).
- An "Undo" toast after Mark paid; a separate plan-manager complaints email/URL field; P5 "getting worse" rule; the yearly holiday-data refresh.
- Admin view of the tracker send logs; a webhook for Resend bounce/complaint events into the send log.

## Build estimate for the remaining work
| Item | Days |
|---|---|
| Review + fixes from real-device testing of the built screens | 2–3 |
| Privacy policy / Terms / DATA-SECURITY updates (+ legal review time) | 1 (+ external) |
| Resend domain, DNS, warm-up, bounce webhook into the log | 1–1.5 |
| Stripe test-mode setup, end-to-end purchase/refund/second-device tests | 1 |
| Migration on a Supabase branch, dry-run week, then go live | 1 (+ a week's elapsed time) |
| PDF report, P5, Undo, complaints fields | 2 |
| SMS add-on (if approved): provider, sender ID registration, credits ledger, Stripe product | 3–4 |
| **Total** | **~8–10 dev days without SMS; ~12–14 with SMS** |
