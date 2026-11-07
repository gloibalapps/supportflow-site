-- Anonymous feature-use counters (netlify/functions/track-usage.mjs). Counts only: no IDs, no content.
create table if not exists public.app_usage (
  day date not null,
  feature text not null,
  n integer not null default 0,
  primary key (day, feature)
);
alter table public.app_usage enable row level security;
revoke all on public.app_usage from public, anon, authenticated;
create or replace function public.bump_usage(p_day date, p_feature text, p_n integer)
returns void language sql security definer set search_path = public as $$
  insert into public.app_usage (day, feature, n) values (p_day, p_feature, p_n)
  on conflict (day, feature) do update set n = public.app_usage.n + excluded.n;
$$;
revoke all on function public.bump_usage(date, text, integer) from public, anon, authenticated;
