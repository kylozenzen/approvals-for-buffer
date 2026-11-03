-- Buffer OAuth connections + Buffer Notes sync. Apply after 002_beta_hardening.sql.
-- Safe to run more than once.

-- 1. Buffer OAuth connections ------------------------------------------------
-- One Buffer connection per creator. Tokens are AES-256-GCM encrypted with
-- RECEIPTS_ENCRYPTION_SECRET before they reach this table, and the table has no
-- anon/authenticated policies, so only the service-role Netlify Functions read it.
create table if not exists public.buffer_connections (
  user_id uuid primary key references auth.users(id) on delete cascade,
  access_token_ciphertext text not null,
  refresh_token_ciphertext text,
  expires_at timestamptz,
  scope text not null default '',
  needs_reconnect boolean not null default false,
  connected_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.buffer_connections enable row level security;

drop trigger if exists buffer_connections_updated_at on public.buffer_connections;
create trigger buffer_connections_updated_at before update on public.buffer_connections
  for each row execute function public.set_updated_at();

-- 2. Buffer Notes as comments ------------------------------------------------
-- Notes written on a post inside Buffer are mirrored into the comment thread.
-- They are internal by default (client_visible = false) until the creator shares one.
alter table public.comments add column if not exists source text not null default 'receipts';
alter table public.comments add column if not exists buffer_note_id text;
alter table public.comments add column if not exists client_visible boolean not null default true;
alter table public.comments add column if not exists external_updated_at timestamptz;

alter table public.comments drop constraint if exists comments_author_type_check;
alter table public.comments add constraint comments_author_type_check
  check (author_type in ('creator','client','system','buffer'));

alter table public.comments drop constraint if exists comments_kind_check;
alter table public.comments add constraint comments_kind_check
  check (kind in ('comment','change','approval','system','note'));

alter table public.comments drop constraint if exists comments_source_check;
alter table public.comments add constraint comments_source_check
  check (source in ('receipts','buffer'));

create unique index if not exists comments_buffer_note_idx
  on public.comments(content_item_id, buffer_note_id)
  where buffer_note_id is not null;

create index if not exists comments_user_source_idx
  on public.comments(user_id, source);
