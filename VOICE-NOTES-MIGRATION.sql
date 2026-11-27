-- Voice notes add-on. NOT APPLIED. Review, then run once in
-- Supabase -> SQL Editor when the owner approves. Safe to re-run.
-- Needs LICENSING-MIGRATION.sql first (licence_payments, for Premium).
--
-- This does not change licence_payments_product_check.
-- voice_notes is a subscription, like tracker_sms, so it is not a one-off
-- licence_payments product. voice_topup is a minutes ledger, not a licence
-- plan: writing it into licence_payments would make a refund recompute the
-- licence and could mark an account revoked.
--
-- Access model: RLS is ENABLED with NO policies, so anon and authenticated
-- can read or write nothing. Only Netlify functions holding
-- SUPABASE_SERVICE_KEY can. The app never talks to these tables directly.

-- Monthly Voice notes (A$5/month). status active or trialing unlocks the mic.
-- Premium does not need a row here: a paid licence_payments product
-- tracker_full already includes Voice notes.
create table if not exists public.voice_subscriptions (
  stripe_subscription_id text primary key,
  google_sub text not null,
  stripe_customer_id text,
  status text not null,
  current_period_end timestamptz,
  cancel_at_period_end boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists voice_subscriptions_sub_idx on public.voice_subscriptions (google_sub);
alter table public.voice_subscriptions enable row level security;

-- One-off top-up (A$5, 120 minutes). The minutes themselves live in the
-- Netlify Blobs usage record. This row stops a retried webhook from granting
-- them twice and lets a refund or dispute take them back.
create table if not exists public.voice_topups (
  stripe_session_id text primary key,
  stripe_payment_intent_id text,
  google_sub text not null,
  seconds integer not null,
  status text not null default 'paid' check (status in ('paid', 'refunded', 'disputed')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists voice_topups_pi_idx on public.voice_topups (stripe_payment_intent_id);
alter table public.voice_topups enable row level security;

revoke all on public.voice_subscriptions, public.voice_topups from anon, authenticated;
