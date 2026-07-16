-- Locked — Supabase schema
-- Run this once in the Supabase SQL editor (or via `supabase db push`) for a
-- fresh project. Tables are written to and read from exclusively through the
-- backend's service-role key (see backend/src/lib/supabaseAdmin.ts) except
-- for the two `select` policies below, which let the teacher dashboard read
-- live data directly with the public anon key over Supabase Realtime.

create extension if not exists "pgcrypto";

create table rooms (
  id uuid primary key default gen_random_uuid(),
  code text unique not null,
  teacher_name text not null,
  exam_title text not null default 'Examen',
  countdown_seconds int not null default 15,
  screenshot_enabled boolean not null default true,
  screenshot_interval_mode text not null default 'random'
    check (screenshot_interval_mode in ('fixed', 'random')),
  screenshot_interval_seconds int not null default 20,
  screenshot_jitter_seconds int not null default 5,
  status text not null default 'open' check (status in ('open', 'closed')),
  created_at timestamptz not null default now()
);

create table sessions (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references rooms(id) on delete cascade,
  student_name text not null,
  status text not null default 'active'
    check (status in ('active', 'excluded', 'disconnected', 'left')),
  joined_at timestamptz not null default now(),
  last_seen timestamptz not null default now()
);

create table violations (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references sessions(id) on delete cascade,
  room_id uuid not null references rooms(id) on delete cascade,
  type text not null,
  payload jsonb,
  created_at timestamptz not null default now()
);

create index sessions_room_id_idx on sessions(room_id);
create index violations_room_id_idx on violations(room_id);
create index violations_session_id_idx on violations(session_id);

-- Realtime: the dashboard subscribes to these via Postgres Changes.
alter publication supabase_realtime add table sessions;
alter publication supabase_realtime add table violations;

-- RLS: writes only ever happen server-side with the service-role key, which
-- bypasses RLS entirely — these policies only govern the anon key used by
-- the browser dashboard, and only grant it read access.
alter table rooms enable row level security;
alter table sessions enable row level security;
alter table violations enable row level security;

create policy "anon can read rooms" on rooms for select to anon using (true);
create policy "anon can read sessions" on sessions for select to anon using (true);
create policy "anon can read violations" on violations for select to anon using (true);

-- Screenshots are uploaded and read only by the backend's service-role key;
-- no anon access is needed, so no storage policy is required for the bucket.
insert into storage.buckets (id, name, public)
values ('screenshots', 'screenshots', false)
on conflict (id) do nothing;
