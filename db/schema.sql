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
