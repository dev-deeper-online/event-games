-- Self-service stations: no operator, players register themselves and press Ready.
-- Old-flow seats and unfinished rounds have no names or device ids and cannot run under the new flow.
delete from devices where role in ('operator', 'player1', 'player2');
delete from matches where completed_at is null;
delete from budget_rounds where confirmed_at is null;
alter table devices drop constraint if exists devices_role_check;
alter table devices add constraint devices_role_check check (role in ('display', 'player1', 'player2', 'guest'));

-- A guest is a player device whose round ended: it keeps its token and its own last result.
alter table devices
  add column name text,
  add column ready_at timestamptz,
  add column seated_at timestamptz;
update devices set seated_at = created_at;

-- Durable round membership, with no foreign key so it outlives role changes.
alter table matches
  add column player1_device_id uuid,
  add column player2_device_id uuid;

alter table budget_rounds
  add column starts_at timestamptz,
  add column player_device_id uuid;

alter table sessions drop constraint if exists sessions_quiz_stop_reason_check;
update sessions set quiz_stop_reason = 'display' where quiz_stop_reason = 'operator';
alter table sessions add constraint sessions_quiz_stop_reason_check check (quiz_stop_reason in ('display', 'disconnect'));
