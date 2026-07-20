-- Locked — Supabase schema
-- Run this once in the Supabase SQL editor (or via `supabase db push`) for a
-- fresh project. Tables are written to and read from exclusively through the
-- backend's service-role key (see backend/src/lib/supabaseAdmin.ts) except
-- for the two `select` policies below, which let the teacher dashboard read
-- live data directly with the public anon key over Supabase Realtime.
--
-- If your project already ran an earlier version of this file, don't re-run
-- it — apply supabase/migrations/002_room_lifecycle.sql instead.

create extension if not exists "pgcrypto";

create table rooms (
  id uuid primary key default gen_random_uuid(),
  code text unique not null,
  teacher_name text not null,
  exam_title text not null default 'Examen',
  countdown_seconds int not null default 15,
  screenshot_enabled boolean not null default true,
  screenshot_per_minute int not null default 10
    check (screenshot_per_minute between 1 and 60),
  -- Waiting-room lifecycle: a room is created "waiting" (Excel opens for
  -- students in the background, unlocked); it becomes live either when the
  -- teacher clicks "Démarrer l'examen" (started_at set immediately) or when
  -- scheduled_start_at is reached (computed, not written by a timer — see
  -- roomService.ts's isStarted()). ended_at marks the point where the
  -- teacher collects submissions and locks the room down.
  scheduled_start_at timestamptz,
  started_at timestamptz,
  ended_at timestamptz,
  -- Path (in the `exam-files` Storage bucket) of the workbook the teacher
  -- imported for students to work from. Null means students get a blank
  -- workbook, same as before this feature existed.
  exam_file_path text,
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
  last_seen timestamptz not null default now(),
  -- Path (in the `submissions` Storage bucket) of this student's saved
  -- workbook, uploaded automatically when the teacher ends the exam.
  submission_path text
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
alter publication supabase_realtime add table rooms;
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

-- All buckets below are written to and read from only by the backend's
-- service-role key; no anon access needed, so no storage policy is required.
insert into storage.buckets (id, name, public)
values ('screenshots', 'screenshots', false)
on conflict (id) do nothing;

insert into storage.buckets (id, name, public)
values ('exam-files', 'exam-files', false)
on conflict (id) do nothing;

insert into storage.buckets (id, name, public)
values ('submissions', 'submissions', false)
on conflict (id) do nothing;
