/** The quiz state machine. The server owns it; `now` is always the server's clock, passed in so tests can set it. */
import { randomInt, randomUUID } from "node:crypto";
import content from "../../content/quiz.json";
import { db, isUniqueViolation, transaction } from "./db";
import { isPlayer, playerSlots, type Match, type PlayerRole, type Role } from "./protocol";
import type { Refusal } from "./refusal";
import type { Device } from "./sessions";

/** Throws when the content file would produce a broken match. Runs on import, so a mistake fails the build. */
export function checkContent({ questionsPerMatch, pauseSeconds, scoring, questions }: typeof content) {
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

const pointsAfter = (elapsedMs: number) => {
  const { start, lostPerSecond, floor } = content.scoring;
  return Math.max(floor, Math.round(start - (lostPerSecond * elapsedMs) / 1000));
};

function draw<T>(items: readonly T[], count: number) {
  const pool = [...items];
  return Array.from({ length: count }, () => pool.splice(randomInt(pool.length), 1)[0]);
}

export async function startMatch(
  { sessionId, role, gameType }: Device,
  names: Record<PlayerRole, string>,
  now: number,
): Promise<Refusal | null> {
  if (role !== "operator") return { error: "Only the operator can start a match.", status: 403 };
  if (gameType !== "quiz") return { error: "This is not a quiz session.", status: 409 };

  try {
    await transaction(async (client) => {
      const {
        rows: [match],
      } = await client.query<{ id: string }>(
        "insert into matches (session_id, player1_name, player2_name) values ($1, $2, $3) returning id",
        [sessionId, names.player1, names.player2],
      );
      for (const [index, question] of draw(content.questions, content.questionsPerMatch).entries()) {
        await client.query(
          `insert into match_questions (match_id, position, prompt, choices, correct_choice, opens_at)
           values ($1, $2, $3, $4, $5, $6)`,
          [match.id, index + 1, question.prompt, question.choices, question.answer, index ? null : new Date(now)],
        );
      }
    });
  } catch (error) {
    // Here only the one-running-match index can be violated.
    if (!isUniqueViolation(error)) throw error;
    return { error: "A match is already running.", status: 409 };
  }
  return null;
}

export type Submission = { matchId: string; question: number; choice: number; retryId?: string };

const notOpen: Refusal = { error: "That question is not open.", status: 409 };

/** Accepts or refuses one tap. `receivedAt` is when it reached the server, which is what it is scored on. */
export async function submitAnswer(
  { sessionId, role }: Device,
  { matchId, question, choice, retryId }: Submission,
  receivedAt: number,
): Promise<Refusal | null> {
  if (!isPlayer(role)) return { error: "Only players can answer.", status: 403 };

  return transaction(async (client) => {
    // Locking the match makes competing taps take turns.
    // shortcut: taps a few ms apart are taken in lock order, not arrival order; hold and compare them if that matters.
    const {
      rows: [match],
    } = await client.query<{ id: string }>(
      "select id from matches where session_id = $1 and completed_at is null for update",
      [sessionId],
    );
    if (match?.id !== matchId) return notOpen;

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
    if (!closes) return null;

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
    return null;
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
export async function matchFor(sessionId: string, role: Role, now: number): Promise<Match | null> {
  // One statement, so the match and its questions are read as of the same moment.
  const {
    rows: [latest, previous],
  } = await db.query<MatchRow>(
    `select m.id, m.player1_name, m.player2_name, m.player1_score, m.player2_score, m.completed_at,
       (select count(*)::int from match_questions where match_id = m.id) as question_count,
       q.position, q.prompt, q.choices, q.opens_at, q.closed_at, q.locked_out, q.scorer, q.points, q.retry_id
     from (select * from matches where session_id = $1 order by created_at desc limit 1) m
     join match_questions q on q.match_id = m.id and q.opens_at is not null
     order by q.position desc limit 2`,
    [sessionId],
  );
  if (!latest) return null;

  // Between questions the newest one is scheduled but not open yet, so the closed one before it still shows.
  const waitMs = latest.opens_at.getTime() - now;
  const shown = previous && waitMs > 0 ? previous : latest;
  const match = {
    id: shown.id,
    players: {
      player1: { name: shown.player1_name, score: shown.player1_score },
      player2: { name: shown.player2_name, score: shown.player2_score },
    },
    questionCount: shown.question_count,
    question: { number: shown.position, prompt: shown.prompt, choices: shown.choices },
  };
  const result = { scorer: shown.scorer, points: shown.points };
  if (shown.completed_at) return { ...match, phase: "complete", result };
  if (shown.closed_at) return { ...match, phase: "closed", result, nextInMs: waitMs };
  const canAnswer = isPlayer(role) && !shown.locked_out.includes(role);
  return {
    ...match,
    phase: "open",
    canAnswer,
    ...(canAnswer && shown.retry_id ? { retryId: shown.retry_id } : {}),
  };
}
