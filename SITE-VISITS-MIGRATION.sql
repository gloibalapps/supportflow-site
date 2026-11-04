-- Privacy-safe website visit counter (netlify/functions/track-visit.mjs).
-- No IP, no user agent, no cookies. visitor_hash rotates daily (salted SHA-256),
-- so it only de-duplicates within one Adelaide (Australia/Adelaide) day.
create table if not exists public.site_visits (
  id bigint generated always as identity primary key,
  created_at timestamptz not null default now(),
  day date not null,
  path text not null,
  visitor_hash text not null,
  referrer_host text,
  utm_source text,
  utm_medium text,
  utm_campaign text,
  country text,
  region text
);
create index if not exists site_visits_day_idx on public.site_visits (day);
create index if not exists site_visits_created_idx on public.site_visits (created_at);
-- Server-only (service key). No anon/authenticated access.
alter table public.site_visits enable row level security;
revoke all on public.site_visits from public, anon, authenticated;
-- Retention: delete visits older than 13 months, daily at 03:17 UTC via pg_cron.
create extension if not exists pg_cron;
select cron.schedule('site_visits_retention', '17 3 * * *',
  $$delete from public.site_visits where created_at < now() - interval '13 months'$$);
