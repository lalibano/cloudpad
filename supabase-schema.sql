-- CloudPad schema — run once in Supabase Dashboard → SQL Editor → New query
-- Creates `notes` table + RLS so each user only sees their own notes.

create table if not exists public.notes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  title text default '',
  content text default '',
  tags text[] default '{}',
  pinned boolean default false,
  archived boolean default false,
  deleted_at timestamptz,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create index if not exists notes_user_updated_idx on public.notes (user_id, updated_at desc);
create index if not exists notes_user_pinned_idx on public.notes (user_id, pinned) where pinned = true;

-- updated_at auto-touch
create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end $$;

drop trigger if exists trg_notes_touch on public.notes;
create trigger trg_notes_touch before update on public.notes
for each row execute function public.touch_updated_at();

-- Row Level Security: users can only CRUD their own rows
alter table public.notes enable row level security;

drop policy if exists "notes_select_own" on public.notes;
create policy "notes_select_own" on public.notes for select using (auth.uid() = user_id);

drop policy if exists "notes_insert_own" on public.notes;
create policy "notes_insert_own" on public.notes for insert with check (auth.uid() = user_id);

drop policy if exists "notes_update_own" on public.notes;
create policy "notes_update_own" on public.notes for update using (auth.uid() = user_id);

drop policy if exists "notes_delete_own" on public.notes;
create policy "notes_delete_own" on public.notes for delete using (auth.uid() = user_id);

-- Realtime (for live multi-tab sync): run in SQL editor, then enable in Dashboard → Database → Replication
-- alter publication supabase_realtime add table public.notes;
