-- NOT APPLIED. New-user offer: 5 free invoices valid 30 days from FIRST OPEN
-- (previously the 30-day window only started at the first invoice preview).
-- Apply in Supabase SQL editor after review. check-status.mjs falls back to the
-- old behaviour if start_free_offer() does not exist yet, so deploy order is safe.
alter table public.accounts
  add column if not exists created_at timestamptz not null default now(),
  add column if not exists created_ip_hash text;
create index if not exists accounts_ip_hash_created_idx on public.accounts (created_ip_hash, created_at);

-- Creates the account on first open with the free starter credits and a 30-day
-- window. Anti-farming: at most p_max_per_ip free grants per hashed IP per 30
-- days; extra new devices from that IP get an account with 0 free credits.
-- Idempotent: an existing account is returned unchanged.
create or replace function public.start_free_offer(p_account_id text, p_ip_hash text, p_max_per_ip int default 3)
returns table (free_credits_remaining int, credit_balance int, credits_expire_at timestamptz, created boolean)
language plpgsql security definer set search_path = public as $$
declare recent int; grant_n int;
begin
  if exists (select 1 from accounts a where a.id = p_account_id) then
    return query select a.free_credits_remaining, a.credit_balance, a.credits_expire_at, false from accounts a where a.id = p_account_id;
    return;
  end if;
  select count(*) into recent from accounts a
   where p_ip_hash is not null and a.created_ip_hash = p_ip_hash
     and a.created_at > now() - interval '30 days' and a.free_credits_remaining > 0;
  grant_n := case when recent >= p_max_per_ip then 0 else 5 end;
  insert into accounts (id, credit_balance, free_credits_remaining, credits_expire_at, created_ip_hash, last_seen_at)
  values (p_account_id, 0, grant_n, now() + interval '30 days', p_ip_hash, now())
  on conflict (id) do nothing;
  return query select a.free_credits_remaining, a.credit_balance, a.credits_expire_at, true from accounts a where a.id = p_account_id;
end $$;
revoke all on function public.start_free_offer(text, text, int) from public, anon, authenticated;
