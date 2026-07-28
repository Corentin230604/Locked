-- Historique enrichi par participant : heure de sortie, motif de sortie,
-- adresse IP au moment de la connexion (pour la restriction reseau).
alter table sessions
  add column if not exists left_at timestamptz,
  add column if not exists exit_reason text,
  add column if not exists join_ip text;

alter table sessions drop constraint if exists sessions_exit_reason_check;
alter table sessions add constraint sessions_exit_reason_check
  check (exit_reason is null or exit_reason in (
    'completed', 'manual_exclusion', 'focus_timeout', 'heartbeat_timeout', 'test_exit'
  ));

-- Plages IP (CIDR, ex. "203.0.113.0/24") autorisees a rejoindre une room de
-- cette ecole. Vide = pas de restriction (comportement actuel, inchange).
alter table schools
  add column if not exists allowed_ip_ranges text[] not null default '{}';
