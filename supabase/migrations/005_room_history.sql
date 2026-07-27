-- Code distinct du code élève, permettant à un autre intervenant de
-- rejoindre une room comme co-organisateur/co-surveillant (partiels
-- multi-classes) - voir api/join-organizer.ts.
alter table rooms
  add column if not exists co_organizer_code text unique;
