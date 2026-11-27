-- Idempotent: db/migrate.mjs runs this file on every deploy.
create table if not exists sessions (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  game_type text not null check (game_type in ('quiz', 'budget')),
  created_at timestamptz not null default now()
);

create table if not exists devices (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references sessions (id) on delete cascade,
  role text not null check (role in ('operator', 'display', 'player1', 'player2')),
  token_hash text not null unique,
  created_at timestamptz not null default now()
);

create index if not exists devices_session on devices (session_id);

-- One device per player slot, enforced here so simultaneous joins cannot both win.
create unique index if not exists devices_player_slot on devices (session_id, role)
  where role in ('player1', 'player2');

create table if not exists matches (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references sessions (id) on delete cascade,
  player1_name text not null,
  player2_name text not null,
  player1_score integer not null default 0,
  player2_score integer not null default 0,
  created_at timestamptz not null default now(),
  completed_at timestamptz
);

create index if not exists matches_session on matches (session_id, created_at);

-- One running match per station, enforced here so simultaneous starts cannot both win.
create unique index if not exists matches_running on matches (session_id) where completed_at is null;

alter table matches
  add column if not exists player1_connected_until timestamptz,
  add column if not exists player2_connected_until timestamptz;

alter table sessions
  add column if not exists quiz_stopped_at timestamptz,
  add column if not exists quiz_stop_reason text check (quiz_stop_reason in ('operator', 'disconnect'));

-- The questions drawn for a match, copied so that editing the content cannot change a match in progress.
create table if not exists match_questions (
  match_id uuid not null references matches (id) on delete cascade,
  position integer not null,
  prompt text not null,
  choices text[] not null,
  correct_choice integer not null,
  -- Null until the question before it closes. May lie in the future: the pause between questions.
  opens_at timestamptz,
  closed_at timestamptz,
  locked_out text[] not null default '{}',
  scorer text check (scorer in ('player1', 'player2')),
  points integer not null default 0,
  primary key (match_id, position)
);
