/** The quiz state machine. The server owns it; `now` is always the server's clock, passed in so tests can set it. */
import { randomInt, randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import content from "../../content/quiz.json";
import { db, lockSession, releaseSeats, transaction } from "./db";
import { isPlayer, playerSlots, type PlayerRole, type Outcome, type Role, type Snapshot, type StopReason } from "./protocol";
import type { Refusal } from "./refusal";
import type { Device } from "./sessions";

/** Throws when the content file would produce a broken match. Runs on import, so a mistake fails the build. */
export function checkContent({
  questionsPerMatch, pauseSeconds, disconnectGraceSeconds, countdownSeconds = 3, abandonSeconds = 60, leaderboardSize = 10, scoring, questions,
}: typeof content) {
  const check = (valid: boolean, problem: string) => {
    if (!valid) throw new Error(`content/quiz.json: ${problem}`);
  };
  const amount = (value: unknown) => typeof value === "number" && value >= 0;
  const text = (value: unknown) => typeof value === "string" && value.trim() !== "";

  check(
    Number.isInteger(questionsPerMatch) && questionsPerMatch >= 1 && questionsPerMatch <= questions.length,
    "questionsPerMatch must be a whole number from 1 to the number of questions",
  );
  check(amount(pauseSeconds), "pauseSeconds must be zero or more");
  check(Number.isInteger(disconnectGraceSeconds) && disconnectGraceSeconds > 0, "disconnectGraceSeconds must be a positive whole number");
  check(amount(countdownSeconds), "countdownSeconds must be zero or more");
  check(amount(abandonSeconds), "abandonSeconds must be zero or more");
  check(Number.isInteger(leaderboardSize) && leaderboardSize > 0, "leaderboardSize must be a positive whole number");
  check(
    [scoring.start, scoring.lostPerSecond, scoring.floor].every(amount) &&
      Number.isInteger(scoring.start) &&
      Number.isInteger(scoring.floor) &&
      scoring.floor <= scoring.start,
    "scoring needs whole numbers for start and floor, with floor no higher than start, and lostPerSecond of zero or more",
  );
  check(new Set(questions.map((question) => question.prompt)).size === questions.length, "every prompt must be different");
  for (const { prompt, choices, answer } of questions) {
    check(text(prompt), "every question needs a prompt");
    check(choices.length >= 2 && choices.every(text), `"${prompt}" needs at least two choices, none of them blank`);
    check(
      Number.isInteger(answer) && answer >= 0 && answer < choices.length,
      `"${prompt}" needs an answer between 0 and ${choices.length - 1}`,
    );
  }
}
checkContent(content);

export const countdownMs = () => (content.countdownSeconds ?? 3) * 1000;
export const abandonMs = () => (content.abandonSeconds ?? 60) * 1000;

export const matchRefreshInMs = () => Math.min(2000, Math.floor(content.disconnectGraceSeconds * 1000 / 3));
// The grace period starts when the next check-in is due.
const connectedUntil = (now: number) => new Date(now + matchRefreshInMs() + content.disconnectGraceSeconds * 1000);
const stopNoticeMs = 5000;

const pointsAfter = (elapsedMs: number) => {
  const { start, lostPerSecond, floor } = content.scoring;
  return Math.max(floor, Math.round(start - (lostPerSecond * elapsedMs) / 1000));
};

function draw<T>(items: readonly T[], count: number) {
  const pool = [...items];
  return Array.from({ length: count }, () => pool.splice(randomInt(pool.length), 1)[0]);
}

/** Runs in the caller's transaction, which already holds the session lock. The first question opens after the countdown. */
export async function startMatchWith(
  client: PoolClient,
  sessionId: string,
  players: Record<PlayerRole, { id: string; name: string }>,
  now: number,
) {
  const {
    rows: [match],
  } = await client.query<{ id: string }>(
    `insert into matches (session_id, player1_name, player2_name, player1_device_id, player2_device_id,
       player1_connected_until, player2_connected_until)
     values ($1, $2, $3, $4, $5, $6, $6) returning id`,
    [sessionId, players.player1.name, players.player2.name, players.player1.id, players.player2.id, connectedUntil(now)],
  );
  await client.query(
    "update sessions set quiz_stop_reason = null, quiz_stopped_at = null where id = $1 and quiz_stopped_at is not null",
    [sessionId],
  );
  for (const [index, question] of draw(content.questions, content.questionsPerMatch).entries()) {
    await client.query(
      `insert into match_questions (match_id, position, prompt, choices, correct_choice, opens_at)
       values ($1, $2, $3, $4, $5, $6)`,
      [match.id, index + 1, question.prompt, question.choices, question.answer, index ? null : new Date(now + countdownMs())],
    );
  }
}

export type Submission = { matchId: string; question: number; choice: number; retryId?: string };

const notOpen: Refusal = { error: "That question is not open.", status: 409 };

async function discardMatch(client: PoolClient, sessionId: string, matchId: string, reason: StopReason, now: number) {
  await client.query("delete from matches where id = $1", [matchId]);
  await client.query(
    "update sessions set quiz_stop_reason = $2, quiz_stopped_at = $3 where id = $1",
    [sessionId, reason, new Date(now)],
  );
  await releaseSeats(client, sessionId);
}

async function lockRunningMatch(client: PoolClient, sessionId: string) {
  // Session first, then match, in every transaction that ends a match.
  await lockSession(client, sessionId);
  const { rows: [match] } = await client.query<{
    id: string;
    player1_device_id: string | null;
    player2_device_id: string | null;
    player1_connected_until: Date | null;
    player2_connected_until: Date | null;
  }>(
    `select id, player1_device_id, player2_device_id, player1_connected_until, player2_connected_until from matches
     where session_id = $1 and completed_at is null for update`,
    [sessionId],
  );
  return match;
}

type RunningMatch = NonNullable<Awaited<ReturnType<typeof lockRunningMatch>>>;

function connectionExpired(match: RunningMatch, now: number) {
  return [match.player1_connected_until, match.player2_connected_until]
    .some((deadline) => deadline !== null && deadline.getTime() <= now);
}

export async function stopMatch({ sessionId, role }: Device, matchId: string, now: number): Promise<Refusal | null> {
  if (role !== "display") return { error: "Only the display can stop a match.", status: 403 };

  return transaction(async (client) => {
    const match = await lockRunningMatch(client, sessionId);
    if (match?.id !== matchId) return { error: "That match is no longer running.", status: 409 };
    await discardMatch(client, sessionId, match.id, "display", now);
    return null;
  });
}

/** An authenticated station refresh checks expiry before renewing its own player deadline. */
export async function refreshMatchConnection(sessionId: string, now: number, player?: PlayerRole) {
  return transaction(async (client) => {
    const match = await lockRunningMatch(client, sessionId);
    if (!match) return false;
    if (connectionExpired(match, now)) {
      await discardMatch(client, sessionId, match.id, "disconnect", now);
      return true;
    }

    // A running match carried over from before this feature gets an initial grace period.
    if (player || !match.player1_connected_until || !match.player2_connected_until) {
      await client.query(
        `update matches set
           player1_connected_until = case when $3 = 'player1' then greatest(player1_connected_until, $2)
             else coalesce(player1_connected_until, $2) end,
           player2_connected_until = case when $3 = 'player2' then greatest(player2_connected_until, $2)
             else coalesce(player2_connected_until, $2) end
         where id = $1`,
        [match.id, connectedUntil(now), player ?? null],
      );
    }
    return false;
  });
}

/** Accepts or refuses one tap. `receivedAt` is when it reached the server, which is what it is scored on. */
export async function submitAnswer(
  { sessionId, role, deviceId }: Device,
  { matchId, question, choice, retryId }: Submission,
  receivedAt: number,
): Promise<(Refusal & { stopped?: true }) | { completed: boolean }> {
  // A guest's round is over, so whatever it answers is stale.
  if (role === "guest") return notOpen;
  if (!isPlayer(role)) return { error: "Only players can answer.", status: 403 };

  return transaction(async (client) => {
    // Locking the match makes competing taps take turns.
    // shortcut: taps a few ms apart are taken in lock order, not arrival order; hold and compare them if that matters.
    const match = await lockRunningMatch(client, sessionId);
    if (match?.id !== matchId || match[`${role}_device_id`] !== deviceId) return notOpen;
    if (connectionExpired(match, receivedAt)) {
      await discardMatch(client, sessionId, match.id, "disconnect", receivedAt);
      return { ...notOpen, stopped: true };
    }

    const {
      rows: [open],
    } = await client.query<{
      position: number;
      choice_count: number;
      correct_choice: number;
      opens_at: Date;
      retry_id: string | null;
      locked_out: PlayerRole[];
    }>(
      `select position, cardinality(choices) as choice_count, correct_choice, opens_at, retry_id, locked_out
       from match_questions where match_id = $1 and closed_at is null order by position limit 1`,
      [matchId],
    );
    if (open?.position !== question || open.opens_at.getTime() > receivedAt) return notOpen;
    if (open.locked_out.includes(role)) return { error: "You have already answered this question.", status: 409 };
    // Only the committed retry snapshot can supply this ID to the opponent.
    if ((open.retry_id ?? undefined) !== retryId) {
      return { error: "Tap again to use your retry.", status: 409 };
    }
    if (choice < 0 || choice >= open.choice_count) return { error: "That choice does not exist.", status: 400 };

    const correct = choice === open.correct_choice;
    const lockedOut = correct ? open.locked_out : [...open.locked_out, role];
    const closes = correct || playerSlots.quiz.every((player) => lockedOut.includes(player));
    const points = correct ? pointsAfter(receivedAt - open.opens_at.getTime()) : 0;
    await client.query(
      `update match_questions set locked_out = $3, closed_at = $4, scorer = $5, points = $6, retry_id = $7
       where match_id = $1 and position = $2`,
      [matchId, question, lockedOut, closes ? new Date(receivedAt) : null, correct ? role : null, points, closes ? null : randomUUID()],
    );
    if (!closes) return { completed: false };

    const { rowCount: hasNext } = await client.query(
      "update match_questions set opens_at = $3 where match_id = $1 and position = $2",
      [matchId, question + 1, new Date(receivedAt + content.pauseSeconds * 1000)],
    );
    await client.query(
      `update matches set player1_score = player1_score + $2, player2_score = player2_score + $3, completed_at = $4
       where id = $1`,
      [
        matchId,
        role === "player1" ? points : 0,
        role === "player2" ? points : 0,
        hasNext ? null : new Date(receivedAt),
      ],
    );
    if (!hasNext) await releaseSeats(client, sessionId);
    return { completed: !hasNext };
  });
}

type MatchRow = {
  id: string;
  player1_name: string;
  player2_name: string;
  player1_score: number;
  player2_score: number;
  completed_at: Date | null;
  question_count: number;
  position: number;
  prompt: string;
  choices: string[];
  opens_at: Date;
  retry_id: string | null;
  locked_out: PlayerRole[];
  scorer: PlayerRole | null;
  points: number;
  closed_at: Date | null;
};

/** What a device may see of its station's latest match at `now`. Never includes a correct choice. */
export async function quizFor(sessionId: string, role: Role, deviceId: string, now: number): Promise<Pick<Snapshot, "match" | "stopNotice">> {
  // One statement, so the match and its questions are read as of the same moment.
  const {
    rows: [latest, previous],
  } = await db.query<MatchRow | { id: null; quiz_stopped_at: Date | null; quiz_stop_reason: StopReason | null }>(
    `select s.quiz_stopped_at, s.quiz_stop_reason,
       m.id, m.player1_name, m.player2_name, m.player1_score, m.player2_score, m.completed_at,
       (select count(*)::int from match_questions where match_id = m.id) as question_count,
       q.position, q.prompt, q.choices, q.opens_at, q.closed_at, q.locked_out, q.scorer, q.points, q.retry_id
     from sessions s
     left join lateral (
       select * from matches where session_id = s.id and (
         case when $2::uuid is null then s.quiz_stop_reason is null
           else (player1_device_id = $2 or player2_device_id = $2) and ($3 or completed_at is null) end
       ) order by created_at desc limit 1
     ) m on true
     left join match_questions q on q.match_id = m.id and q.opens_at is not null
     where s.id = $1 order by q.position desc limit 2`,
    // The display shows the station's latest match; a device only ever sees its own. Only a guest sees a finished
    // one: a seated player has played again, so an older match is not its current one.
    [sessionId, role === "display" ? null : deviceId, role === "guest"],
  );
  if (!latest) return { match: null, stopNotice: null };
  if (latest.id === null) {
    const remainingMs = latest.quiz_stopped_at ? latest.quiz_stopped_at.getTime() + stopNoticeMs - now : 0;
    const stopNotice = latest.quiz_stop_reason && remainingMs > 0 ? { reason: latest.quiz_stop_reason, remainingMs } : null;
    return { match: null, stopNotice };
  }

  // Between questions the newest one is scheduled but not open yet, so the closed one before it still shows.
  const waitMs = latest.opens_at.getTime() - now;
  const shown = previous?.id && waitMs > 0 ? previous : latest;
  const match = {
    id: shown.id,
    players: {
      player1: { name: shown.player1_name, score: shown.player1_score },
      player2: { name: shown.player2_name, score: shown.player2_score },
    },
    questionCount: shown.question_count,
  };
  // Nothing before the first question has opened: the countdown. The question itself stays hidden until then.
  if (!previous?.id && waitMs > 0) return { match: { ...match, phase: "countdown", startsInMs: waitMs }, stopNotice: null };

  const outcomes: Outcome[] = shown.locked_out.map((player, index) => ({
    id: `${shown.position}-${index}`, player, kind: "wrong",
  }));
  if (shown.scorer) {
    outcomes.push({ id: `${shown.position}-${outcomes.length}`, player: shown.scorer, kind: "scored", points: shown.points });
  }
  const view = { ...match, question: { number: shown.position, prompt: shown.prompt, choices: shown.choices }, outcomes };
  const result = { scorer: shown.scorer, points: shown.points };
  if (shown.completed_at) return { match: { ...view, phase: "complete", result }, stopNotice: null };
  if (shown.closed_at) return { match: { ...view, phase: "closed", result, nextInMs: waitMs }, stopNotice: null };
  const canAnswer = isPlayer(role) && !shown.locked_out.includes(role);
  return {
    match: {
      ...view,
      phase: "open",
      canAnswer,
      ...(canAnswer && shown.retry_id ? { retryId: shown.retry_id } : {}),
    },
    stopNotice: null,
  };
}
