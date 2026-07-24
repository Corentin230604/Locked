-- Locked — Supabase schema
-- Run this once in the Supabase SQL editor (or via `supabase db push`) for a
-- fresh project. Tables are written to and read from exclusively through the
-- backend's service-role key (see backend/src/lib/supabaseAdmin.ts) except
-- for a few narrow `select` policies below, which let the dashboard read
-- some data directly with the public anon key (Realtime, and each logged-in
-- user's own membership row).
--
-- If your project already ran an earlier version of this file, don't re-run
-- it — apply the supabase/migrations/*.sql files you haven't run yet instead.

create extension if not exists "pgcrypto";

create table schools (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  -- domaines email autorisés à s'inscrire dans cette école (ex. {"ecole.fr"})
  email_domains text[] not null default '{}',
  default_validity_years int not null default 1 check (default_validity_years between 1 and 5),
  default_grace_period_days int not null default 60 check (default_grace_period_days >= 0),
  created_at timestamptz not null default now()
);

-- Arbre : école (racine, parent_id null) -> campus -> département -> classe/promo.
-- Une "classe" est une feuille avec un join_code que les élèves utilisent pour
-- s'y rattacher ; un admin sans admin_perimeter_id précis (voir
-- school_memberships) voit tout depuis la racine de son école.
create table perimeters (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references schools(id) on delete cascade,
  parent_id uuid references perimeters(id) on delete cascade,
  name text not null,
  kind text not null default 'group' check (kind in ('campus', 'departement', 'classe', 'group')),
  join_code text unique,
  created_at timestamptz not null default now()
);

create index perimeters_school_id_idx on perimeters(school_id);
create index perimeters_parent_id_idx on perimeters(parent_id);

-- Une ligne par (utilisateur, école) : un même compte auth.users peut avoir
-- plusieurs adhésions (un prof dans plusieurs écoles).
create table school_memberships (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  school_id uuid not null references schools(id) on delete cascade,
  role text not null check (role in ('school_admin', 'intervenant', 'etudiant')),
  -- school_admin : périmètre géré (null = toute l'école, racine).
  admin_perimeter_id uuid references perimeters(id) on delete set null,
  -- etudiant : classe de rattachement (renseignée une fois, non modifiable
  -- par l'élève - voir api/memberships.ts).
  class_perimeter_id uuid references perimeters(id) on delete set null,
  valid_from date not null default current_date,
  valid_until date not null,
  status text not null default 'active' check (status in ('active', 'pending_renewal')),
  created_at timestamptz not null default now(),
  unique (user_id, school_id)
);

create index school_memberships_school_id_idx on school_memberships(school_id);
create index school_memberships_user_id_idx on school_memberships(user_id);

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
  -- All restrictions apply exactly as in a real exam, but the Windows agent
  -- shows a floating "Quitter le test" button so testers aren't locked out
  -- of their own PC — see ExamSession.cs's LockDown().
  is_test boolean not null default false,
  status text not null default 'open' check (status in ('open', 'closed')),
  school_id uuid references schools(id) on delete cascade,
  created_by_membership_id uuid references school_memberships(id) on delete set null,
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
  submission_path text,
  membership_id uuid references school_memberships(id) on delete set null
);

create table violations (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references sessions(id) on delete cascade,
  room_id uuid not null references rooms(id) on delete cascade,
  type text not null,
  payload jsonb,
  created_at timestamptz not null default now()
);

-- Classes qu'un intervenant est autorisé à gérer (ajout/retrait par l'admin
-- de son périmètre) - distinct de admin_perimeter_id/class_perimeter_id
-- car un intervenant peut gérer plusieurs classes sans être admin.
create table intervenant_classes (
  membership_id uuid not null references school_memberships(id) on delete cascade,
  perimeter_id uuid not null references perimeters(id) on delete cascade,
  primary key (membership_id, perimeter_id)
);

-- Toi : accès cross-écoles complet. Une seule ligne pour l'instant.
create table platform_admins (
  user_id uuid primary key references auth.users(id) on delete cascade
);

-- Classes ciblées par une room (vide = pas de restriction de classe).
create table room_target_classes (
  room_id uuid not null references rooms(id) on delete cascade,
  perimeter_id uuid not null references perimeters(id) on delete cascade,
  primary key (room_id, perimeter_id)
);

-- Intervenants ajoutés ponctuellement comme surveillants d'une room précise
-- (partiels multi-classes), sans changer leurs classes gérées habituelles.
create table room_co_organizers (
  room_id uuid not null references rooms(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  primary key (room_id, user_id)
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
alter table schools enable row level security;
alter table perimeters enable row level security;
alter table school_memberships enable row level security;
alter table intervenant_classes enable row level security;
alter table platform_admins enable row level security;
alter table room_target_classes enable row level security;
alter table room_co_organizers enable row level security;

create policy "anon can read rooms" on rooms for select to anon using (true);
create policy "anon can read sessions" on sessions for select to anon using (true);
create policy "anon can read violations" on violations for select to anon using (true);

-- Écoles/périmètres/adhésions ne sont pas lisibles avec la clé anon (ça
-- exposerait la structure et les emails de toutes les écoles) : un
-- utilisateur connecté ne peut lire que sa propre adhésion, tout le reste
-- transite par des endpoints backend qui vérifient le rôle de l'appelant.
create policy "user reads own memberships" on school_memberships
  for select to authenticated using (auth.uid() = user_id);

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
