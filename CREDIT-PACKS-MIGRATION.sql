-- SupportFlow credit packs: run once in Supabase → SQL Editor.
-- Safe to re-run. accounts.id is uuid (device refs come from crypto.randomUUID()). Needed by stripe-webhook.mjs, check-status.mjs, restore-purchase.mjs.

alter table public.accounts
  add column if not exists credit_balance integer not null default 0,
  add column if not exists free_credits_remaining integer not null default 5,
  add column if not exists last_seen_at timestamptz,
  add column if not exists credits_expire_at timestamptz,
  -- Written by stripe-webhook.mjs, read by restore-purchase.mjs.
  add column if not exists stripe_customer_id text;
create index if not exists accounts_stripe_customer_idx on public.accounts (stripe_customer_id);

-- Credits (purchased and the 5 free starter credits) are valid for 30 days.
-- New accounts get their 30-day window from creation; existing rows that
-- have no window yet are given one from today rather than expiring instantly.
alter table public.accounts alter column credits_expire_at set default (now() + interval '30 days');
update public.accounts set credits_expire_at = now() + interval '30 days' where credits_expire_at is null;

create table if not exists public.credit_purchases (
  id bigint generated always as identity primary key,
  account_id uuid not null,
  pack text not null check (pack in ('casual','popular','value')),
  credits integer not null check (credits > 0),
  amount_aud numeric(10,2) not null default 0,
  stripe_session_id text not null unique,
  purchased_at timestamptz not null default now()
);
-- In case an earlier partial run created this column as text.
alter table public.credit_purchases alter column account_id type uuid using account_id::uuid;
create index if not exists credit_purchases_account_idx on public.credit_purchases (account_id);
alter table public.credit_purchases enable row level security; -- service key only

-- Atomic credit top-up with the 30-day expiry + compounding rule, so two
-- webhooks landing together can't lose credits:
--   * window still open  -> new credits ADD to the balance, window resets to now + 30 days
--   * expired / no window -> balance starts fresh with only the new credits
--                            (expired free credits are cleared too), new 30-day window
drop function if exists public.add_credits(text, integer);
create or replace function public.add_credits(p_account_id uuid, p_credits integer)
returns integer
language sql
security definer
set search_path = public
as $$
  insert into accounts (id, credit_balance, credits_expire_at, last_seen_at)
  values (p_account_id, p_credits, now() + interval '30 days', now())
  on conflict (id) do update set
    credit_balance = case
      when accounts.credits_expire_at is null or accounts.credits_expire_at < now()
        then excluded.credit_balance
      else accounts.credit_balance + excluded.credit_balance
    end,
    free_credits_remaining = case
      when accounts.credits_expire_at is null or accounts.credits_expire_at < now()
        then 0
      else accounts.free_credits_remaining
    end,
    credits_expire_at = now() + interval '30 days',
    last_seen_at = now()
  returning credit_balance;
$$;
revoke all on function public.add_credits(uuid, integer) from public, anon, authenticated;


-- ---------------------------------------------------------------------------
-- Per-invoice-number charging (needed by charge-invoice.mjs).
-- Rule: 1 credit on the FIRST preview of a new invoice number. Re-previews
-- and edits of the same invoice number are free.
-- ---------------------------------------------------------------------------
create table if not exists public.charged_invoices (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts(id),
  invoice_number text not null,
  charged_at timestamptz not null default now(),
  unique (account_id, invoice_number)
);
create index if not exists idx_charged_invoices_account on public.charged_invoices (account_id);
alter table public.charged_invoices enable row level security; -- service key only

-- Atomic: runs as one transaction; the account row is locked FOR UPDATE so two
-- simultaneous previews can't double-spend, and the unique constraint stops the
-- same invoice number being charged twice.
-- Spends free starter credits first, then purchased credit_balance.
-- A device with no account row yet is created with the 5 free starter credits
-- and a fresh 30-day window (matches check-status.mjs reporting 5 for new users).
drop function if exists public.charge_invoice_credit(text, text);
create or replace function public.charge_invoice_credit(p_account_id uuid, p_invoice_number text)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  acc accounts%rowtype;
  remaining integer;
begin
  if exists (select 1 from charged_invoices
             where account_id = p_account_id and invoice_number = p_invoice_number) then
    return json_build_object('charged', false, 'reason', 'already_charged');
  end if;

  insert into accounts (id, last_seen_at) values (p_account_id, now())
  on conflict (id) do nothing;

  select * into acc from accounts where id = p_account_id for update;

  -- Re-check under the lock in case a concurrent call just charged it.
  if exists (select 1 from charged_invoices
             where account_id = p_account_id and invoice_number = p_invoice_number) then
    return json_build_object('charged', false, 'reason', 'already_charged');
  end if;

  if acc.credits_expire_at is null or acc.credits_expire_at <= now()
     or (coalesce(acc.credit_balance, 0) + coalesce(acc.free_credits_remaining, 0)) <= 0 then
    return json_build_object('charged', false, 'reason', 'no_credits', 'credits_remaining', 0);
  end if;

  insert into charged_invoices (account_id, invoice_number) values (p_account_id, p_invoice_number);

  if coalesce(acc.free_credits_remaining, 0) > 0 then
    update accounts set free_credits_remaining = free_credits_remaining - 1, last_seen_at = now()
      where id = p_account_id;
  else
    update accounts set credit_balance = credit_balance - 1, last_seen_at = now()
      where id = p_account_id;
  end if;

  select coalesce(credit_balance, 0) + coalesce(free_credits_remaining, 0) into remaining
    from accounts where id = p_account_id;

  return json_build_object('charged', true, 'credits_remaining', remaining);
end;
$$;
revoke all on function public.charge_invoice_credit(uuid, text) from public, anon, authenticated;
