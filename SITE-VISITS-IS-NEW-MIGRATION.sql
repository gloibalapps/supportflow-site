-- New vs returning visitor flag, sent by visit.js from the on-device sf_seen marker.
-- null = unknown (rows before this change, or localStorage blocked).
alter table public.site_visits add column if not exists is_new boolean;
