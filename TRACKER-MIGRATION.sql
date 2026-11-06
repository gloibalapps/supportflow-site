-- SupportFlow Payment tracker add-on. NOT APPLIED. Review, then run once in
-- Supabase -> SQL Editor when the owner approves. Safe to re-run.
-- Needs LICENSING-MIGRATION.sql first (licence_payments).
--
-- Access model: same as the licensing tables. RLS is ENABLED with NO
-- policies, so the anon and authenticated roles can read or write nothing;
-- only Netlify functions holding SUPABASE_SERVICE_KEY can. The app never
-- talks to these tables directly (it has no Supabase auth; workers are
-- identified by the server-signed Google session).

-- 1) Paid unlocks ride on the licence ledger, exactly like licences.
alter table public.licence_payments drop constraint if exists licence_payments_product_check;
alter table public.licence_payments add constraint licence_payments_product_check
  check (product in ('one', 'two', 'upgrade', 'tracker', 'tracker_base', 'tracker_two', 'tracker_addon', 'tracker_full'));

-- 2) Per-worker auto-send preferences. worker_enc = AES-GCM sealed
--    { replyTo, name } (TRACKER_DATA_KEY, server-side).
create table if not exists public.tracker_prefs (
  google_sub text primary key,
  enabled boolean not null default false,          -- worker's "Send automatically" switch
  state text not null default 'SA' check (state in ('SA','NSW','VIC','QLD','WA','TAS','ACT','NT')),
  notify_push boolean not null default true,
  notify_email boolean not null default true,
  worker_enc text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.tracker_prefs enable row level security;

-- 3) Minimised invoice tracking records. Only scheduling fields are in the
--    clear; invoice no., amount, recipient and message text are sealed in
--    payload_enc. id = HMAC(google_sub|device invoice id), not the invoice no.
create table if not exists public.tracker_records (
  id text primary key,
  google_sub text not null,
  sent_at date not null,
  due date,
  payer_type text not null check (payer_type in ('plan','self','agency')),
  thresholds jsonb,                                 -- null = defaults 7/12/20 (agency 3/10/15)
  paused boolean not null default false,
  closed boolean not null default false,            -- paid / deleted / no longer open on the device
  closed_at timestamptz,
  stop_reason text,                                 -- e.g. 'unsubscribed'
  last_stage_sent smallint not null default 0 check (last_stage_sent between 0 and 3),
  last_sent_at timestamptz,
  recipient_hash text,                              -- HMAC of recipient email, for suppression
  payload_enc text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists tracker_records_due_idx on public.tracker_records (google_sub) where closed = false;
create index if not exists tracker_records_closed_idx on public.tracker_records (closed_at) where closed = true;
alter table public.tracker_records enable row level security;

-- 4) Recipients who used the unsubscribe link (per worker).
create table if not exists public.tracker_suppressions (
  google_sub text not null,
  recipient_hash text not null,
  created_at timestamptz not null default now(),
  primary key (google_sub, recipient_hash)
);
alter table public.tracker_suppressions enable row level security;

-- 5) Per-worker send log (shown in the app). Masked address only, no body.
create table if not exists public.tracker_send_log (
  id bigint generated always as identity primary key,
  google_sub text not null,
  record_id text,
  stage smallint not null default 0,
  channel text not null check (channel in ('email','push','sms','unsubscribe')),
  recipient_masked text,
  invoice_no text,
  subject text,
  status text not null check (status in ('sent','dry_run','failed','skipped','suppressed','unsubscribed')),
  detail text,
  created_at timestamptz not null default now()
);
create index if not exists tracker_send_log_sub_idx on public.tracker_send_log (google_sub, created_at desc);
alter table public.tracker_send_log enable row level security;

-- 5b) Tracker device seats: 1 with base (A$49), 2 with base + add-on (A$29) or the full package (A$99).
create table if not exists public.tracker_devices (
  google_sub text not null,
  device_id uuid not null,
  first_seen timestamptz not null default now(),
  last_seen timestamptz not null default now(),
  primary key (google_sub, device_id)
);
alter table public.tracker_devices enable row level security;

-- 6) Web push subscriptions (sealed endpoint + keys), one per device.
create table if not exists public.tracker_push_subs (
  google_sub text not null,
  device_id uuid not null,
  sub_enc text not null,
  updated_at timestamptz not null default now(),
  primary key (google_sub, device_id)
);
alter table public.tracker_push_subs enable row level security;

-- 7) OPTIONAL SMS ALERTS add-on (A$4.99/month, 50 texts, worker's own mobile only).
--    Not part of any one-off package. Stripe subscription mirrored here by the webhook.
create table if not exists public.tracker_sms_subscriptions (
  stripe_subscription_id text primary key,
  google_sub text not null,
  stripe_customer_id text,
  status text not null,                       -- Stripe status: active, past_due, canceled, unpaid, ...
  current_period_end timestamptz,
  cancel_at_period_end boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists tracker_sms_subscriptions_sub_idx on public.tracker_sms_subscriptions (google_sub);
alter table public.tracker_sms_subscriptions enable row level security;

-- Worker's own mobile, sealed (AES-GCM, TRACKER_DATA_KEY), opt-in + verification.
create table if not exists public.tracker_sms_profiles (
  google_sub text primary key,
  phone_enc text not null,
  phone_hash text,                            -- HMAC of E.164 number, to match inbound STOP replies
  opted_in boolean not null default false,
  opt_in_at timestamptz,
  verified_at timestamptz,
  stopped_at timestamptz,                     -- STOP reply or opt-out in the app
  code_hash text, code_expires timestamptz, code_attempts smallint not null default 0,
  code_sent_at timestamptz, codes_today smallint not null default 0,
  low_notice_at timestamptz,                  -- last "SMS credits used up" push
  updated_at timestamptz not null default now()
);
create index if not exists tracker_sms_profiles_phone_idx on public.tracker_sms_profiles (phone_hash);
alter table public.tracker_sms_profiles enable row level security;

-- Credit ledger (append-only) and balance. 1 credit = 1 SMS segment.
create table if not exists public.tracker_sms_ledger (
  id bigint generated always as identity primary key,
  google_sub text not null,
  kind text not null check (kind in ('grant','use','refund_usage','expire','cancelled','refunded','disputed','unpaid','incomplete_expired')),
  delta integer not null,
  balance_after integer not null,
  ref text,                                    -- invoice id / usage uuid / subscription id
  stripe_invoice_id text,
  stripe_payment_intent_id text,
  stripe_charge_id text,
  created_at timestamptz not null default now()
);
create unique index if not exists tracker_sms_ledger_grant_uq on public.tracker_sms_ledger (stripe_invoice_id) where kind = 'grant';
create index if not exists tracker_sms_ledger_sub_idx on public.tracker_sms_ledger (google_sub, created_at desc);
create index if not exists tracker_sms_ledger_pi_idx on public.tracker_sms_ledger (stripe_payment_intent_id);
alter table public.tracker_sms_ledger enable row level security;

create table if not exists public.tracker_sms_balances (
  google_sub text primary key,
  balance integer not null default 0 check (balance >= 0),
  period_end timestamptz,
  updated_at timestamptz not null default now()
);
alter table public.tracker_sms_balances enable row level security;

-- invoice.paid: RESET to p_credits (unused texts don't roll over). Idempotent per invoice.
create or replace function public.tracker_sms_reset(p_sub text, p_invoice text, p_credits integer, p_period_end timestamptz,
  p_payment_intent text default null, p_charge text default null)
returns integer language plpgsql security definer set search_path = public as $$
declare old integer;
begin
  if exists (select 1 from tracker_sms_ledger where kind = 'grant' and stripe_invoice_id = p_invoice) then
    return (select balance from tracker_sms_balances where google_sub = p_sub);
  end if;
  insert into tracker_sms_balances (google_sub, balance) values (p_sub, 0) on conflict (google_sub) do nothing;
  select balance into old from tracker_sms_balances where google_sub = p_sub for update;
  if old > 0 then
    insert into tracker_sms_ledger (google_sub, kind, delta, balance_after, ref) values (p_sub, 'expire', -old, 0, p_invoice);
  end if;
  update tracker_sms_balances set balance = p_credits, period_end = p_period_end, updated_at = now() where google_sub = p_sub;
  insert into tracker_sms_ledger (google_sub, kind, delta, balance_after, ref, stripe_invoice_id, stripe_payment_intent_id, stripe_charge_id)
    values (p_sub, 'grant', p_credits, p_credits, p_invoice, p_invoice, p_payment_intent, p_charge);
  update tracker_sms_profiles set low_notice_at = null where google_sub = p_sub;
  return p_credits;
end $$;

-- Spend p_segments atomically. Returns the new balance, or -1 if it doesn't cover them.
create or replace function public.tracker_sms_consume(p_sub text, p_segments integer, p_ref text)
returns integer language plpgsql security definer set search_path = public as $$
declare nb integer;
begin
  update tracker_sms_balances set balance = balance - p_segments, updated_at = now()
    where google_sub = p_sub and balance >= p_segments returning balance into nb;
  if nb is null then return -1; end if;
  insert into tracker_sms_ledger (google_sub, kind, delta, balance_after, ref) values (p_sub, 'use', -p_segments, nb, p_ref);
  return nb;
end $$;

-- Provider failure: give the segments back.
create or replace function public.tracker_sms_refund_usage(p_sub text, p_segments integer, p_ref text)
returns integer language plpgsql security definer set search_path = public as $$
declare nb integer;
begin
  update tracker_sms_balances set balance = balance + p_segments, updated_at = now() where google_sub = p_sub returning balance into nb;
  insert into tracker_sms_ledger (google_sub, kind, delta, balance_after, ref) values (p_sub, 'refund_usage', p_segments, nb, p_ref);
  return nb;
end $$;

-- Cancellation / refund / dispute / unpaid: remove what's left.
create or replace function public.tracker_sms_zero(p_sub text, p_reason text, p_ref text)
returns integer language plpgsql security definer set search_path = public as $$
declare old integer;
begin
  select balance into old from tracker_sms_balances where google_sub = p_sub for update;
  if coalesce(old, 0) = 0 then return 0; end if;
  update tracker_sms_balances set balance = 0, updated_at = now() where google_sub = p_sub;
  insert into tracker_sms_ledger (google_sub, kind, delta, balance_after, ref) values (p_sub, p_reason, -old, 0, p_ref);
  return 0;
end $$;

revoke all on function public.tracker_sms_reset(text, text, integer, timestamptz, text, text),
  public.tracker_sms_consume(text, integer, text), public.tracker_sms_refund_usage(text, integer, text),
  public.tracker_sms_zero(text, text, text) from public, anon, authenticated;

-- tracker_send_log already allows channel 'sms'; add the no-credit fallback status.
alter table public.tracker_send_log drop constraint if exists tracker_send_log_status_check;
alter table public.tracker_send_log add constraint tracker_send_log_status_check
  check (status in ('sent','dry_run','failed','skipped','suppressed','unsubscribed','no_credits','stopped'));

-- Belt and braces: make sure the client roles hold no grants.
revoke all on public.tracker_prefs, public.tracker_records, public.tracker_suppressions,
  public.tracker_send_log, public.tracker_push_subs, public.tracker_devices,
  public.tracker_sms_subscriptions, public.tracker_sms_profiles, public.tracker_sms_ledger, public.tracker_sms_balances from anon, authenticated;
