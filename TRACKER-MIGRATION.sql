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
  check (product in ('one', 'two', 'upgrade', 'tracker_base', 'tracker_addon', 'tracker_full'));

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

-- Belt and braces: make sure the client roles hold no grants.
revoke all on public.tracker_prefs, public.tracker_records, public.tracker_suppressions,
  public.tracker_send_log, public.tracker_push_subs, public.tracker_devices from anon, authenticated;
