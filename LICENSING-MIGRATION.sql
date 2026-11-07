-- SupportFlow one-off device licensing: run once in Supabase -> SQL Editor.
-- Safe to re-run. Needed by netlify/functions/licence.mjs and stripe-webhook.mjs.
-- Nothing here changes existing tables, so running it has no effect on current
-- users. Enforcement only starts when the owner turns licensing on (see
-- LICENSING.md -> "Turning licensing on").

-- Owner switch. 'false' = every existing user passes straight through.
create table if not exists public.app_config (
  key text primary key,
  value text not null,
  updated_at timestamptz not null default now()
);
insert into public.app_config (key, value) values ('licensing_enabled', 'false')
  on conflict (key) do nothing;
alter table public.app_config enable row level security; -- service key only

-- One row per Google account (Google subject id, the `sub` claim). No keys.
create table if not exists public.licences (
  google_sub text primary key,
  email text,
  plan smallint not null default 0 check (plan in (0, 1, 2)),   -- max active devices
  status text not null default 'revoked' check (status in ('active', 'revoked')),
  purchased_at timestamptz,
  stripe_payment_intent_id text,          -- the licence purchase
  upgrade_payment_intent_id text,         -- the $20 upgrade, if any
  legacy_account_id uuid unique,          -- earlier Lifetime buyer carried over
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.licences enable row level security;

-- Every Stripe payment for a licence. Webhook-written only; idempotent on the
-- checkout session. Refunds / disputes flip status and the licence is
-- recomputed from what is still paid.
create table if not exists public.licence_payments (
  id bigint generated always as identity primary key,
  stripe_session_id text not null unique,
  stripe_payment_intent_id text,
  google_sub text not null,
  product text not null check (product in ('one', 'two', 'upgrade')),
  amount_aud numeric(10,2) not null default 0,
  status text not null default 'paid' check (status in ('paid', 'refunded', 'disputed')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists licence_payments_pi_idx on public.licence_payments (stripe_payment_intent_id);
create index if not exists licence_payments_sub_idx on public.licence_payments (google_sub);
alter table public.licence_payments enable row level security;

-- Signed-in installs. A device is an active install, not a hardware slot: it
-- stops counting after 21 days without a check-in, or when removed/replaced.
create table if not exists public.licence_devices (
  google_sub text not null,
  device_id uuid not null,
  label text not null default 'Unknown device',
  first_seen timestamptz not null default now(),
  last_seen timestamptz not null default now(),
  revoked_at timestamptz,
  revoked_reason text,
  primary key (google_sub, device_id)
);
create index if not exists licence_devices_sub_idx on public.licence_devices (google_sub);
alter table public.licence_devices enable row level security;

-- Atomic activation so two devices signing in at the same moment can't both
-- squeeze past the cap. Optionally revokes one named device first (the
-- "Move the licence here?" / "replace this device" choice).
create or replace function public.licence_activate_device(
  p_sub text, p_device uuid, p_label text, p_replace uuid default null, p_stale_days integer default 21
)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  lic licences%rowtype;
  others integer;
  replace_active boolean := false;
  replaced_label text;
begin
  select * into lic from licences where google_sub = p_sub for update;
  if not found or lic.status <> 'active' or lic.plan < 1 then
    return json_build_object('ok', false, 'reason', 'unpaid');
  end if;

  if p_replace is not null and p_replace <> p_device then
    select true, label into replace_active, replaced_label from licence_devices
      where google_sub = p_sub and device_id = p_replace and revoked_at is null
        and last_seen >= now() - make_interval(days => p_stale_days);
    replace_active := coalesce(replace_active, false);
  end if;

  select count(*) into others from licence_devices
    where google_sub = p_sub and device_id <> p_device and revoked_at is null
      and last_seen >= now() - make_interval(days => p_stale_days)
      and (not replace_active or device_id <> p_replace);

  if others >= lic.plan then
    return json_build_object('ok', false, 'reason', 'slots_full', 'cap', lic.plan);
  end if;

  if replace_active then
    update licence_devices set revoked_at = now(), revoked_reason = 'replaced'
      where google_sub = p_sub and device_id = p_replace;
  end if;

  insert into licence_devices (google_sub, device_id, label, first_seen, last_seen)
    values (p_sub, p_device, coalesce(nullif(p_label, ''), 'Unknown device'), now(), now())
  on conflict (google_sub, device_id) do update set
    label = excluded.label, last_seen = now(), revoked_at = null, revoked_reason = null;

  return json_build_object('ok', true, 'replaced', replace_active, 'replaced_label', replaced_label);
end;
$$;
revoke all on function public.licence_activate_device(text, uuid, text, uuid, integer) from public, anon, authenticated;
