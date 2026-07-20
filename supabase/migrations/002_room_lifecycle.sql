-- Locked — migration 002: waiting-room lifecycle, imported exam file, submissions
-- Run this in the Supabase SQL editor on a project that already has the
-- original schema.sql applied (the one with screenshot_interval_mode /
-- screenshot_interval_seconds / screenshot_jitter_seconds). Safe to re-run —
-- every statement is idempotent.

alter table rooms
  add column if not exists scheduled_start_at timestamptz,
  add column if not exists started_at timestamptz,
  add column if not exists ended_at timestamptz,
  add column if not exists exam_file_path text;

-- Replace the old fixed/random + jitter screenshot config with a single
-- "captures per minute, randomized within the minute" model.
alter table rooms
  add column if not exists screenshot_per_minute int not null default 10;

alter table rooms
  drop constraint if exists rooms_screenshot_per_minute_check;

alter table rooms
  add constraint rooms_screenshot_per_minute_check
    check (screenshot_per_minute between 1 and 60);

alter table rooms
  drop column if exists screenshot_interval_mode,
  drop column if exists screenshot_interval_seconds,
  drop column if exists screenshot_jitter_seconds;

alter table sessions
  add column if not exists submission_path text;

-- The dashboard now also needs to react live to a room's own status changes
-- (waiting -> started -> ended), not just its sessions/violations.
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and tablename = 'rooms'
  ) then
    alter publication supabase_realtime add table rooms;
  end if;
end $$;

insert into storage.buckets (id, name, public)
values ('exam-files', 'exam-files', false)
on conflict (id) do nothing;

insert into storage.buckets (id, name, public)
values ('submissions', 'submissions', false)
on conflict (id) do nothing;
