-- Sas d'attente : une fois la room lancee, un nouveau join n'entre plus
-- directement - il attend l'autorisation de l'intervenant.
alter table sessions drop constraint if exists sessions_status_check;
alter table sessions add constraint sessions_status_check
  check (status in ('active', 'excluded', 'disconnected', 'left', 'pending_approval'));

alter table sessions drop constraint if exists sessions_exit_reason_check;
alter table sessions add constraint sessions_exit_reason_check
  check (exit_reason is null or exit_reason in (
    'completed', 'manual_exclusion', 'focus_timeout', 'heartbeat_timeout', 'test_exit',
    'denied_entry', 'environment_violation'
  ));
