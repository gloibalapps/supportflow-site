# Device licensing (owner guide)

SupportFlow can sell a one-off licence that belongs to a **Google account**:

| Plan | Price (AUD, once) | Devices signed in at the same time |
|---|---|---|
| One device | A$49 | 1 |
| Phone and computer | A$69 | 2 |
| Upgrade One device → Phone and computer | A$20 | 2 |

There are no licence keys, redeem codes, share links, subscriptions or trials.
Everything sits behind an **owner switch**. While the switch is off, every
existing user carries on exactly as before: no sign-in screen, no paywall, and
the existing credit packs / Lifetime flow keep working.

---

## 1. One-time setup (switch stays off)

1. **Supabase** → SQL Editor → paste and run `LICENSING-MIGRATION.sql`. It only
   adds new tables (`app_config`, `licences`, `licence_payments`,
   `licence_devices`) and one function. Safe to re-run. It does not change any
   existing table.
2. **Stripe** (AUD, *one-time* prices, not recurring). Create three prices and
   copy each Price ID (`price_...`):
   * "SupportFlow: One device" A$49
   * "SupportFlow: Phone and computer" A$69
   * "SupportFlow: Upgrade to Phone and computer" A$20
3. **Stripe webhook**: on the existing endpoint
   `https://<your-site>/.netlify/functions/stripe-webhook`, make sure these
   events are selected (the first two are already there):
   `checkout.session.completed`, `checkout.session.async_payment_succeeded`,
   `charge.refunded`, `charge.dispute.created`, `charge.dispute.closed`.
4. **Netlify** → Site configuration → Environment variables. Add:

   | Variable | Value |
   |---|---|
   | `LICENCE_SECRET` | A long random string (at least 24 characters, e.g. the output of `openssl rand -base64 48`). Signs sign-in sessions and the 7-day offline leases. Changing it signs everyone out once and makes old leases invalid. |
   | `STRIPE_PRICE_49` | Price ID of the A$49 price. (Fallbacks: `STRIPE_PRICE_LICENCE_ONE`, then the existing `STRIPE_PRICE_LIFETIME`.) |
   | `STRIPE_PRICE_69` | Price ID of the A$69 price (fallback name `STRIPE_PRICE_LICENCE_TWO`) |
   | `STRIPE_PRICE_UPGRADE` | Price ID of the A$20 price (fallback name `STRIPE_PRICE_LICENCE_UPGRADE`) |
   | `LICENCE_EMAIL_FROM` | Optional. Sender for the "licence moved" email, e.g. `SupportFlow <no-reply@supportflow.work>` (must be a Resend-verified domain). |
   | `LICENSING_TEST_EMAILS` | Optional. Comma-separated Google addresses that get the licensing experience while the switch is still off, for testing. |

   Already set for the existing features and reused: `GOOGLE_CLIENT_ID`
   (Google Drive backup; also used to verify Google sign-in), `SUPABASE_URL`,
   `SUPABASE_SERVICE_KEY`, `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`,
   `SITE_URL`, `RESEND_API_KEY`.

   `STRIPE_WEBHOOK_SECRET` must be the **signing secret of this exact
   endpoint** (Stripe → Developers → Webhooks → the
   `supportflow.work/.netlify/functions/stripe-webhook` endpoint → Signing
   secret → Reveal, starts `whsec_`), from the same mode (live/test) as
   `STRIPE_SECRET_KEY`. It is *not* the `sk_`/`rk_` API key. To accept both a
   live and a test endpoint, put both values in it separated by a comma. If
   deliveries fail, the Netlify function log for `stripe-webhook` now says
   why (e.g. "signature mismatch" or "doesn't look like a webhook signing
   secret").
5. **Google Cloud console** → APIs & Services → Credentials → the OAuth client
   used by `GOOGLE_CLIENT_ID`:
   * Authorised JavaScript origins: your site origin (e.g. `https://supportflow.work`).
   * Authorised redirect URIs: `https://<your-site>/.netlify/functions/licence?action=google-redirect`
     (used by the iPhone Home Screen app, which can't open Google's popup).
6. Redeploy.

## 2. Test before turning it on

Either:

* add your Google address to `LICENSING_TEST_EMAILS` and redeploy, then open
  `https://<your-site>/app?licence-preview=1` on a device. That device now
  shows the sign-in / buy / devices screens for you only. Open
  `/app?licence-preview=0` to leave preview; or
* use Stripe test mode keys on a deploy preview.

Everyone else is unaffected while you test.

## 3. Turning licensing on

Pick **one** of these:

**A. Supabase (instant, no redeploy).** SQL Editor:

```sql
update public.app_config set value = 'true', updated_at = now() where key = 'licensing_enabled';
```

**B. Netlify env var.** Set `LICENSING_ENABLED` = `true` and redeploy. The env
var overrides the Supabase row while it is set (`true` or `false`); delete it
to go back to the row.

Enforcement starts on each device's next check (app launch, coming back
online, or the 30-minute heartbeat). The server caches the Supabase row for up
to 30 seconds.

**Turning it off again:** set the row back to `'false'` (or
`LICENSING_ENABLED=false`). Every device goes back to the old behaviour on its
next check. No data is touched either way.

---

## How it works

**Identity.** Google Sign-In only. The licence is keyed to the Google subject
id (`sub`) from a verified ID token, never the email.

**Devices.** On first launch the app makes a random UUID and keeps it in
IndexedDB (`supportflow-licence`). It is not a fingerprint. The server keeps
`{deviceId, label, firstSeen, lastSeen}` per Google account. A device that
hasn't checked in for **21 days** stops counting. Clearing site data creates a
new id; signing in again with the same Google account brings the licence back
(and the user's records come back from their Google Drive backup, as now).
On Android and desktop Chrome the browser tab and installed app share storage,
so they're one device. On iPhone, Safari and the Home Screen app keep separate
storage and count separately; the devices screen points this out and makes
removing the extra one one tap.

**Heartbeat and lease.** On every online launch and every 30 minutes the app
calls `/.netlify/functions/licence` (`heartbeat`). The server checks the
account is paid, this device is active, and the cap isn't exceeded, then
returns a lease signed with ECDSA P-256 (private key derived from
`LICENCE_SECRET`, never sent to the browser). The lease is tied to the device
id and lasts **7 days**, so a worker on a shift with no signal is not locked
out. If the server is unreachable or errors (5xx), the app falls back to the
lease. A copied, edited or expired lease fails the signature/date check. The
server stays the source of truth: AI features (`assist`,
`supportflow-assistant`) return 402 without an active licensed device once the
switch is on, and `charge-invoice` only waives credits for a licensed device.

**One device (A$49).** A second device sees the current device (label, last
used) and "Move the licence here?". Confirming revokes the old device and
activates this one in one atomic database call; the old device locks on its
next check (or when its lease expires, at most 7 days). An email goes to the
Google account's address each time the licence moves.

**Phone and computer (A$69).** Up to two at once. A third device lists both
and the user taps the one to replace.

**Payments.** The app asks the server for a Stripe Checkout session
(`metadata.kind = "licence"`, Google `sub`, product). Only the Stripe webhook
records a payment (`licence_payments`) and sets the licence
(`licences: google_sub, plan 1|2, status active, purchased_at,
stripe_payment_intent_id`). The `?licence=success` return only makes the app
poll until the webhook has landed. Unpaid / expired sessions write nothing.
A full refund or a dispute marks that payment and recomputes the licence: a
refunded A$49/A$69 → `revoked` (locks on next check); a refunded A$20 upgrade
→ back to One device. A dispute that is won restores it.

**Earlier Lifetime buyers.** People who bought the old A$49 Lifetime (keyed to
the browser's `ndis:deviceRef`) are carried over automatically as **One
device** the first time they sign in with Google on a device that holds that
purchase. If they've lost it, "Restore licence" (existing, by checkout email)
puts it back on the device, then signing in claims it. Each old purchase can be
claimed by one Google account only.

**Never locked out with no way forward.** The locked screen always offers the
next step: sign in, buy, move the licence here / replace a device, use a
different Google account, or try again when offline.

## Owner support tasks (Supabase SQL)

```sql
-- See an account
select * from licences where email = 'someone@example.com';
select * from licence_devices where google_sub = '<sub>' order by last_seen desc;

-- Free all of an account's devices (they sign in again on the device they want)
update licence_devices set revoked_at = now(), revoked_reason = 'owner'
  where google_sub = '<sub>' and revoked_at is null;
```

## Files

| File | Purpose |
|---|---|
| `LICENSING-MIGRATION.sql` | Tables + atomic activation function |
| `netlify/lib/licence.mjs` | Shared server logic (switch, Google token check, leases, device rules) |
| `netlify/functions/licence.mjs` | Licence API: config, sign-in, heartbeat, move/replace, remove, sign-out, checkout |
| `netlify/functions/stripe-webhook.mjs` | Adds licence purchases, refunds and disputes |
| `netlify/functions/charge-invoice.mjs`, `assist.mjs`, `supportflow-assistant.mjs` | Server-side licence checks |
| `app.jsx` / `app.html` | Client: device id, heartbeat, lease check, locked/buy/move screens, Settings → Licence & devices |
