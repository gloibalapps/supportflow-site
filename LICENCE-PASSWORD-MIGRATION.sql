-- Email-and-password licence accounts. Run once in Supabase -> SQL Editor.
-- Safe to re-run. Service role only (RLS on, no policies for anon/authenticated).
-- Stores a scrypt hash, never a readable password.

create table if not exists public.licence_passwords (
  id text primary key,
  email text not null unique,
  password_hash text not null,
  fail_count integer not null default 0,
  locked_until timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.licence_passwords enable row level security;
revoke all on table public.licence_passwords from public, anon, authenticated;
