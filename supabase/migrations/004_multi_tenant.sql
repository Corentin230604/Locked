-- Multi-établissement : écoles, périmètres (arbre), adhésions, rôles.
-- Idempotent, à exécuter sur le projet Supabase live existant.

create table if not exists schools (
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
create table if not exists perimeters (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references schools(id) on delete cascade,
  parent_id uuid references perimeters(id) on delete cascade,
  name text not null,
  kind text not null default 'group' check (kind in ('campus', 'departement', 'classe', 'group')),
  join_code text unique,
  created_at timestamptz not null default now()
);

create index if not exists perimeters_school_id_idx on perimeters(school_id);
create index if not exists perimeters_parent_id_idx on perimeters(parent_id);

-- Une ligne par (utilisateur, école) : un même compte auth.users peut avoir
-- plusieurs adhésions (un prof dans plusieurs écoles).
create table if not exists school_memberships (
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

create index if not exists school_memberships_school_id_idx on school_memberships(school_id);
create index if not exists school_memberships_user_id_idx on school_memberships(user_id);

-- Classes qu'un intervenant est autorisé à gérer (ajout/retrait par l'admin
-- de son périmètre) - distinct de admin_perimeter_id/class_perimeter_id
-- car un intervenant peut gérer plusieurs classes sans être admin.
create table if not exists intervenant_classes (
  membership_id uuid not null references school_memberships(id) on delete cascade,
  perimeter_id uuid not null references perimeters(id) on delete cascade,
  primary key (membership_id, perimeter_id)
);

-- Toi : accès cross-écoles complet. Une seule ligne pour l'instant.
create table if not exists platform_admins (
  user_id uuid primary key references auth.users(id) on delete cascade
);

alter table rooms
  add column if not exists school_id uuid references schools(id) on delete cascade,
  add column if not exists created_by_membership_id uuid references school_memberships(id) on delete set null;

-- Classes ciblées par une room (vide = pas de restriction de classe).
create table if not exists room_target_classes (
  room_id uuid not null references rooms(id) on delete cascade,
  perimeter_id uuid not null references perimeters(id) on delete cascade,
  primary key (room_id, perimeter_id)
);

-- Intervenants ajoutés ponctuellement comme surveillants d'une room précise
-- (partiels multi-classes), sans changer leurs classes gérées habituelles.
create table if not exists room_co_organizers (
  room_id uuid not null references rooms(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  primary key (room_id, user_id)
);

alter table sessions
  add column if not exists membership_id uuid references school_memberships(id) on delete set null;

alter table schools enable row level security;
alter table perimeters enable row level security;
alter table school_memberships enable row level security;
alter table intervenant_classes enable row level security;
alter table platform_admins enable row level security;
alter table room_target_classes enable row level security;
alter table room_co_organizers enable row level security;

-- Les écritures passent exclusivement par le backend (service_role, contourne
-- RLS). Ces politiques ne gouvernent que la clé anon utilisée par le
-- dashboard : un utilisateur connecté ne peut lire que sa propre adhésion,
-- tout le reste (listes d'écoles, de membres, de classes...) transite par des
-- endpoints backend qui vérifient le rôle de l'appelant eux-mêmes.
create policy "user reads own memberships" on school_memberships
  for select to authenticated using (auth.uid() = user_id);
