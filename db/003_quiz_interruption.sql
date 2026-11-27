alter table matches
  add column if not exists player1_connected_until timestamptz,
  add column if not exists player2_connected_until timestamptz;

alter table sessions
  add column if not exists quiz_stopped_at timestamptz,
  add column if not exists quiz_stop_reason text check (quiz_stop_reason in ('operator', 'disconnect'));
