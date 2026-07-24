-- Cohort-1 beta hardening. Apply after 001_receipts_beta.sql.
alter table public.clients add column if not exists approval_locked_until timestamptz;
alter table public.clients add column if not exists room_token_expires_at timestamptz;
update public.clients set room_token_expires_at=now()+interval '30 days' where room_token_expires_at is null;
alter table public.clients alter column room_token_expires_at set default (now()+interval '30 days');
create index if not exists attempts_client_failures_idx on public.approval_attempts(client_id,created_at desc) where success=false;
-- Run periodically (for example, as a scheduled Supabase/Netlify job) to retain IP data for 30 days.
create or replace function public.purge_receipts_ip_data() returns void language sql security definer as $$
  delete from public.approval_attempts where created_at < now()-interval '30 days';
$$;
alter table public.profiles add column if not exists buffer_organization_id text;
