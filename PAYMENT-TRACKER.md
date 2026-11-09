# Payment tracker add-on: build notes, setup and launch blockers

> **SMS add-on shelved (9 Nov 2026).** Not sold or advertised: `tracker_sms` is marked retired in `netlify/lib/tracker.mjs`, and `TRACKER_SMS_ENABLED` stays unset. The SMS code and tables remain dormant. Workers are alerted by free push notifications and a free email to their own address (`notify_email`, sent by `tracker-sender.mjs`). The SMS sections below are kept for reference only.

Tests: `node payment-tracker-rules.test.mjs`, `node netlify/tracker-sender.test.mjs`, `node netlify/tracker-checkout.test.mjs`, `node netlify/tracker-sms.test.mjs` (need `web-push` installed), `node netlify/tracker-migration.test.mjs` (needs `@electric-sql/pglite`).

Status: built on the local branch `feature/payment-tracker` only. It has not been pushed or deployed. The five live Stripe Prices exist (IDs below and in `.env.example`), but no migration has been applied and no Netlify env vars have been changed.
Supersedes these decisions in payment-tracker-brief.md: D1 (price) and D2 (one-tap send).

## Pricing (current; homepage is the customer-facing structure)

| Product id | Price | Env var | What it gives |
|---|---|---|---|
| `tracker` | A$29 one-off | `STRIPE_PRICE_TRACKER` | Payment tracker, on top of Basic. Does not include a second device. |
| (licence `upgrade`) | A$29 one-off | `STRIPE_PRICE_UPGRADE` | Second device. Separate from the tracker. Not a tracker SKU. |
| `tracker_full` | A$129 one-off | `STRIPE_PRICE_TRACKER_FULL` | Premium: everything in Basic, two-device licence, Payment tracker. SMS is not included. |
| `tracker_sms` | **A$4.99 / month** | `STRIPE_PRICE_TRACKER_SMS` | Optional SMS, 50 texts, only after the tracker is unlocked. Not included in any package, including Premium. |

Retired and refused at checkout (older paid rows still unlock): `tracker_base`, `tracker_two`, `tracker_addon`.

Copy rule: never call an option lifetime, unlimited or forever. Do not call anything a sale, and do not use a founding or first-200 cap. There are no discounts or percentages shown anywhere.
The entitlement is per Google account, recorded in `licence_payments` (the same ledger as licences). **Only** the Stripe webhook writes it, and refunds and disputes reverse it through `handleLicenceReversal`. Device seats work like the main licence: the first N devices hold seats, and a seat frees after 21 days unseen.

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

## SMS alerts add-on (optional, paid)
- **Who gets texts:** only the worker, at their own verified AU mobile. They need to tick the opt-in and enter a 6-digit code (10-minute expiry, 5 tries, a 60 s gap between codes, max 5 a day). `sendWorkerSms()` takes no recipient, so it cannot text the NDIA, a plan manager or a payer.
- **When:** at each automatic stage: day 7 and 12 (with "reminder emailed to the payer" when it was sent), day 20 / NDIA-managed day 15 ("your NDIA draft is ready, nothing has been filed"), and NDIA-managed portal checks. Texts are short, single segment, contain no participant or payer names, and end with "Reply STOP to opt out." If the sender is one-way, set `TRACKER_SMS_ONE_WAY=true` and the ending becomes "Opt out in SupportFlow settings."
- **Credits:** 1 credit = 1 SMS segment (GSM-7 160/153, Unicode 70/67). `invoice.paid` **resets** the balance to 50; unused texts expire and are written to the ledger. Spending is atomic (`tracker_sms_consume`). A provider failure refunds the segments. Cancellation, `unpaid` status, a refund or a dispute zeroes the balance. `past_due` keeps the balance but stops sending, because only active and trialing packs send.
- **Out of credits:** no text is sent. The alert goes out as a web push instead, and once per period the worker gets a push saying "SMS alerts used up... alerts continue as notifications". It is logged in the send log.
- **STOP:** replying STOP/STOPALL/UNSUBSCRIBE/CANCEL/END/QUIT to the number opts out (`tracker-sms-inbound.mjs`, Twilio-signature verified). START turns texts back on. Settings has "Stop texts" too.
- **Provider:** adapter interface `{ name, send({to, from, body}) }` with **Twilio** (built) and **Telnyx** (send built; inbound STOP not wired yet, because it needs an Ed25519 webhook signature check). Choose with `TRACKER_SMS_PROVIDER`. It is **off unless `TRACKER_SMS_ENABLED=true`** and in **dry run unless `TRACKER_SMS_DRY_RUN=false`**. Dry run spends no credits and sends no codes. Tests use a mock provider.
- **Cancel/manage:** the "Manage or cancel the SMS pack" button opens the Stripe customer portal. The portal needs to be configured in Stripe.
- **Margin:** A$4.99 incl. GST → A$4.54 ex GST, less Stripe ~A$0.25 (1.7% + A$0.30 domestic card), leaves ~A$4.29. 50 texts at A$0.06–0.08 cost A$3.00–4.00 if all are used. That is a margin of about **A$0.30–1.30 at full use** and far more at typical use (~25 texts ≈ A$1.75). A dedicated reply-capable number (~US$8.25/month on Twilio) is a fixed cost shared across all workers.

## How auto-send works with the phone closed
1. When the worker turns on "Send automatically", the app shows a consent prompt. It then syncs a **minimised record** for each open invoice to `tracker.mjs`. The record holds sent date, due date, payer type, thresholds and the paused flag in the clear. The invoice no., amount, recipient email and name, and the rendered message text (including any edits) are sealed with AES-256-GCM under `TRACKER_DATA_KEY` before they reach Supabase. The id is an HMAC of (account, local invoice id). Paid, deleted or no-longer-open invoices are closed on the next sync and deleted after 30 days. Turning auto-send off deletes everything synced.
2. `tracker-sender` runs hourly. For each enabled, unlocked worker, it only acts on that worker's state business days, between 9am and 4pm their time. It sends the **latest** stage reached and never a backlog. The server owns `last_stage_sent`, and Resend idempotency keys stop double sends.
   - Plan-managed: day 7 and day 12 → plan manager. Day 20 → **the worker only**, with the ready-to-file NDIA complaint draft. Nothing is ever filed.
   - Self-managed: day 7 and day 12 → participant/nominee (gentle wording). Day 20 → worker only, with the NDIA contact draft.
   - NDIA-managed: day 3, 10 and 15 (brief s5.1) → worker only. These are portal checks plus an NDIA enquiry draft.
   - Each stage also sends a push to the worker's subscribed devices. The payload has no personal details.
3. RLS is enabled on every new table with no policies, so only the service key used by the functions can access them. This is the same model as the licensing tables. The app has no Supabase auth: workers are identified by the server-signed Google session.

## Sending identity
Mail goes `From: "Jane Smith via SupportFlow" <invoices@supportflow.work>`, `Reply-To: <worker's email>`. **Sending as the worker's own address isn't feasible.** Resend only sends from domains SupportFlow has verified with SPF/DKIM. Putting a worker's gmail.com/outlook.com address in From fails DMARC (Gmail and Yahoo reject or spam it). The alternative, Gmail/Microsoft send-on-behalf OAuth, needs the restricted `gmail.send` scope, which means a Google CASA security assessment, plus a Microsoft publisher verification. That is weeks of work and an annual cost, so it isn't worth it for v1. Replies still go straight to the worker.

## Stripe setup
1. One-off Price **A$29.00 AUD** for the Payment tracker → `STRIPE_PRICE_TRACKER`. Do not reuse any retired Price.
2. One-off Price **A$129.00 AUD** for Premium → `STRIPE_PRICE_TRACKER_FULL`. No coupon, discount or second Price is used.
4. Basic stays the existing A$79 one-off (`STRIPE_PRICE_79`). Do not change it. The second device stays the existing A$29 licence upgrade (`STRIPE_PRICE_UPGRADE`).
4. Webhook: reuse the existing `/.netlify/functions/stripe-webhook` endpoint and `STRIPE_WEBHOOK_SECRET`. Make sure it listens for `checkout.session.completed`, `checkout.session.async_payment_succeeded`, `charge.refunded`, `charge.dispute.created` and `charge.dispute.closed` (the same events as licences). Checkout sessions carry `metadata.kind=tracker`, `product`, `google_sub` and `device_id`. The `?tracker=success` return never unlocks anything: the app polls `status` until the webhook lands.
4b. **SMS pack:** Product "Payment tracker SMS alerts", **recurring monthly Price A$4.99 AUD** → `STRIPE_PRICE_TRACKER_SMS` (live: `price_1UYEAyKJKDCaYKVvPWR5MQ3R`; `TRACKER_SMS_LABEL` / `TRACKER_SMS_AUD` for display). Checkout uses `mode=subscription`, with metadata on both the session and `subscription_data`. **Add these webhook events:** `invoice.paid`, `customer.subscription.updated`, `customer.subscription.deleted` (in addition to `charge.refunded` and `charge.dispute.created`, which already cover SMS refunds and disputes). Configure the **Customer portal** (Settings → Billing → Customer portal: allow cancel). Test: subscribe → `invoice.paid` → 50 credits; test-clock renewal → reset to 50; cancel → 0; refund → 0.
5. Existing env vars that are reused: `STRIPE_SECRET_KEY`, `SITE_URL`, `SUPABASE_URL`, `SUPABASE_SERVICE_KEY`, `LICENCE_SECRET`, `GOOGLE_CLIENT_ID`, `RESEND_API_KEY`.
6. New env vars: `TRACKER_DATA_KEY` (`openssl rand -base64 32`; losing it makes the synced records unreadable), `TRACKER_EMAIL_FROM`, `VAPID_PUBLIC_KEY`/`VAPID_PRIVATE_KEY`/`VAPID_SUBJECT` (`npx web-push generate-vapid-keys`), `TRACKER_AUTOSEND_ENABLED` (leave unset), `TRACKER_AUTOSEND_DRY_RUN` (default true).
   SMS: `STRIPE_PRICE_TRACKER_SMS`, `TRACKER_SMS_LABEL`, `TRACKER_SMS_AUD`, `TRACKER_SMS_ENABLED` (leave unset = off), `TRACKER_SMS_DRY_RUN` (default true), `TRACKER_SMS_PROVIDER` (twilio | telnyx), `TRACKER_SMS_CREDITS` (default 50), `TRACKER_SMS_ONE_WAY`, `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_FROM` (registered sender ID or AU number), `TELNYX_API_KEY`, `TELNYX_FROM`. Point the Twilio number's inbound webhook at `/.netlify/functions/tracker-sms-inbound`.
7. Apply `TRACKER-MIGRATION.sql` after `LICENSING-MIGRATION.sql`. It widens the `licence_payments.product` check. The sold product id `tracker` must be allowed on `licence_payments.product` (same check as the other tracker ids).
8. Test: an A$29 `tracker` purchase unlocks one device; a licence plan of 2 (the separate A$29 second-device add-on, or Premium) allows a second tracker seat; `tracker_base` and `tracker_two` checkout returns 410; Premium checkout uses the A$129 Price; SMS checkout is subscription mode and is refused until the tracker is unlocked.

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
2. **Resend domain:** `supportflow.work` is verified in Resend (done 9 Nov 2026) (SPF, DKIM, DMARC with p=none→quarantine), warm it up, and monitor bounces and complaints. Use a separate subdomain so tracker mail can't hurt licence and tester mail.
3. **Pricing:** Payment tracker A$29 once on top of Basic; second device a separate A$29 add-on; Premium A$129 once; SMS A$4.99 a month for 50 texts after the tracker is unlocked, not included in any package. Netlify still needs `STRIPE_PRICE_TRACKER` (A$29), `STRIPE_PRICE_TRACKER_FULL` (the A$129 Premium Price), plus `STRIPE_PRICE_TRACKER_SMS`, before those checkouts can charge.
4. **iOS push limits** (above). **Public holiday table:** the computed rules need checking against data.gov.au. WA's King's Birthday is approximated as the last Monday in September; part-day/regional holidays are ignored.
5. **Testing:** Stripe test-mode purchase/refund/second device; a dry-run sender week with `TRACKER_AUTOSEND_DRY_RUN=true`; real devices (Android Chrome, iPhone Home Screen); a deliverability check (mail-tester, Gmail/Outlook inboxes); the migration on a Supabase branch first.
6. **SMS (only if the add-on ships):** (a) **ACMA SMS Sender ID Register**: from 1 Jul 2026, an alphanumeric sender (e.g. "SupportFlw") must be registered by SupportFlow's ABN through the provider, or texts show "Unverified". Alphanumeric senders are one-way, so to receive STOP replies use a dedicated AU number (Twilio ~US$8.25/month) or set `TRACKER_SMS_ONE_WAY=true`. (b) **Spam Act:** alerts to the worker about their own invoices are factual service messages, not marketing. They still identify SupportFlow, keep STOP/in-app opt-out working at once, and must never carry promotion. Record express opt-in (`opt_in_at`). (c) Privacy: the worker's mobile is stored sealed; add it to the privacy policy. (d) Provider account and spend caps (Twilio balance alerts), plus SMS pumping protection for the code endpoint (rate limits are in place).
7. The owner decides on open brief questions 2, 10 and 11 (Commission option, NDIA-managed eligibility, self-managed BD-20).

## Not built (design only / remaining)
- PDF report (CSV only now; reuse the jsPDF incident code).
- SMS add-on: built behind flags (above). Not built: Telnyx inbound STOP, an admin view of SMS usage.
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
| SMS add-on remaining (built locally): provider account, sender ID / number registration, Stripe price + portal, test-mode subscription lifecycle, real-device SMS test | 1.5–2 (+ ACMA registration elapsed time) |
| **Total** | **~8–10 dev days without SMS; ~10–12 with SMS** |
