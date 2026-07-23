alter table rooms
  add column if not exists is_test boolean not null default false;
