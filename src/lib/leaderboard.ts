import { db } from "./db";
import type { LeaderboardEntry } from "./protocol";

/** Each completed quiz match already holds the two durable leaderboard entries. */
export async function eventLeaderboard() {
  const { rows } = await db.query<LeaderboardEntry>(
    `with entries as (
       select m.id, player.slot, player.name, player.score
       from matches m
       join sessions s on s.id = m.session_id
       cross join lateral (values
         (1, m.player1_name, m.player1_score),
         (2, m.player2_name, m.player2_score)
       ) as player(slot, name, score)
       where m.completed_at is not null and s.game_type = 'quiz'
     ), ranked as (
       select *, rank() over (order by score desc)::int as rank from entries
     )
     select id::text || '/' || slot as id, name, score, rank
     from ranked where rank <= 10
     order by rank, ranked.id, slot`,
  );
  return rows;
}
