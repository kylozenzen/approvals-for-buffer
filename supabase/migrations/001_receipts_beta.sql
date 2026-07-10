-- Receipts for Buffer: approvals-only beta
-- Run this once in the Supabase SQL editor.

create extension if not exists pgcrypto;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null default '',
  display_name text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.clients (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  company text not null,
  contact_name text not null,
  email text not null,
  approval_owner text not null,
  approval_note text not null default '',
  room_token_hash text not null unique,
  room_token_ciphertext text not null,
  approval_code_hash text not null,
  approval_code_ciphertext text not null,
  color text not null default '#cafd00',
  color_text text not null default '#0d0f0c',
  initials text not null default '',
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.content_items (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  client_id uuid references public.clients(id) on delete set null,
  buffer_post_id text not null,
  title text not null,
  caption text not null default '',
  image_url text not null default '',
  platform text not null default 'Buffer',
  service text not null default '',
  channel_id text not null default '',
  buffer_status text not null default 'draft',
  due_at timestamptz,
  status text not null default 'draft' check (status in ('draft','review','changes','approved')),
  version integer not null default 1 check (version > 0),
  current_fingerprint text not null default '',
  latest_snapshot_id uuid,
  review_snapshot_id uuid,
  approved_snapshot_id uuid,
  changed_since_review boolean not null default false,
  feedback text,
  approved_by text,
  approved_at timestamptz,
  receipt_code text,
  source_created_at timestamptz,
  last_synced_at timestamptz,
  archived boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(user_id, buffer_post_id)
);

create table if not exists public.content_snapshots (
  id uuid primary key default gen_random_uuid(),
  content_item_id uuid not null references public.content_items(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  version integer not null,
  caption text not null default '',
  image_url text not null default '',
  platform text not null default 'Buffer',
  service text not null default '',
  channel_id text not null default '',
  buffer_status text not null default 'draft',
  due_at timestamptz,
  fingerprint text not null,
  snapshot_json jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique(content_item_id, version)
);

alter table public.content_items
  drop constraint if exists content_items_latest_snapshot_id_fkey,
  add constraint content_items_latest_snapshot_id_fkey foreign key (latest_snapshot_id) references public.content_snapshots(id) on delete set null;
alter table public.content_items
  drop constraint if exists content_items_review_snapshot_id_fkey,
  add constraint content_items_review_snapshot_id_fkey foreign key (review_snapshot_id) references public.content_snapshots(id) on delete set null;
alter table public.content_items
  drop constraint if exists content_items_approved_snapshot_id_fkey,
  add constraint content_items_approved_snapshot_id_fkey foreign key (approved_snapshot_id) references public.content_snapshots(id) on delete set null;

create table if not exists public.comments (
  id uuid primary key default gen_random_uuid(),
  content_item_id uuid not null references public.content_items(id) on delete cascade,
  snapshot_id uuid references public.content_snapshots(id) on delete set null,
  user_id uuid not null references auth.users(id) on delete cascade,
  author_type text not null check (author_type in ('creator','client','system')),
  author_name text not null,
  body text not null,
  kind text not null default 'comment' check (kind in ('comment','change','approval','system')),
  created_at timestamptz not null default now()
);

create table if not exists public.receipts (
  id uuid primary key default gen_random_uuid(),
  receipt_code text not null unique,
  user_id uuid not null references auth.users(id) on delete cascade,
  client_id uuid not null references public.clients(id) on delete cascade,
  content_item_id uuid not null references public.content_items(id) on delete cascade,
  snapshot_id uuid not null references public.content_snapshots(id) on delete restrict,
  client_company text not null,
  title text not null,
  platform text not null,
  approver_name text not null,
  approved_at timestamptz not null,
  version integer not null,
  fingerprint text not null,
  snapshot_json jsonb not null,
  created_at timestamptz not null default now()
);

create table if not exists public.approval_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  client_id uuid not null references public.clients(id) on delete cascade,
  content_item_id uuid not null references public.content_items(id) on delete cascade,
  snapshot_id uuid not null references public.content_snapshots(id) on delete restrict,
  receipt_id uuid references public.receipts(id) on delete set null,
  action text not null check (action in ('approved','changes_requested','revoked')),
  approver_name text not null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.approval_attempts (
  id bigint generated by default as identity primary key,
  client_id uuid not null references public.clients(id) on delete cascade,
  content_item_id uuid references public.content_items(id) on delete cascade,
  ip_address text not null default 'unknown',
  success boolean not null default false,
  created_at timestamptz not null default now()
);

create index if not exists clients_user_idx on public.clients(user_id);
create index if not exists items_user_status_idx on public.content_items(user_id,status);
create index if not exists items_client_idx on public.content_items(client_id);
create index if not exists snapshots_item_idx on public.content_snapshots(content_item_id,version desc);
create index if not exists comments_item_idx on public.comments(content_item_id,created_at);
create index if not exists receipts_user_idx on public.receipts(user_id,approved_at desc);
create index if not exists attempts_rate_idx on public.approval_attempts(client_id,ip_address,created_at desc);

create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists profiles_updated_at on public.profiles;
create trigger profiles_updated_at before update on public.profiles for each row execute function public.set_updated_at();
drop trigger if exists clients_updated_at on public.clients;
create trigger clients_updated_at before update on public.clients for each row execute function public.set_updated_at();
drop trigger if exists content_items_updated_at on public.content_items;
create trigger content_items_updated_at before update on public.content_items for each row execute function public.set_updated_at();

-- All product data is accessed through authenticated Netlify Functions using
-- the service-role key. RLS is still enabled so the public anon key cannot read it.
alter table public.profiles enable row level security;
alter table public.clients enable row level security;
alter table public.content_items enable row level security;
alter table public.content_snapshots enable row level security;
alter table public.comments enable row level security;
alter table public.receipts enable row level security;
alter table public.approval_events enable row level security;
alter table public.approval_attempts enable row level security;

-- Supabase Auth can read a user's own profile if needed. Other tables intentionally
-- have no anon/authenticated policies; service-role functions bypass RLS.
drop policy if exists "profiles_select_own" on public.profiles;
create policy "profiles_select_own" on public.profiles for select to authenticated using (auth.uid() = id);
drop policy if exists "profiles_update_own" on public.profiles;
create policy "profiles_update_own" on public.profiles for update to authenticated using (auth.uid() = id) with check (auth.uid() = id);
