// Drives the server's submission interface with a controlled clock, against the real database.
import { expect, test } from "@playwright/test";
import content from "../content/quiz.json";
import type { PlayerRole, Role, Snapshot } from "../src/lib/protocol";
import { checkContent, startMatch, submitAnswer } from "../src/lib/quiz";
import { authenticate, createSession, joinSession, snapshotFor, type Device } from "../src/lib/sessions";
import { newToken } from "./station";

// The default scoring numbers, pinned so that tuning the content file cannot fail these tests.
Object.assign(content.scoring, { start: 1000, lostPerSecond: 50, floor: 100 });

const start = Date.parse("2026-01-01T12:00:00Z");
const pause = content.pauseSeconds * 1000;
const names = { player1: "Amira", player2: "Bilal" };

async function station(gameType: "quiz" | "budget" = "quiz") {
  const { code, token } = await createSession(gameType);
  const device = async (deviceToken: string) =>
    (await authenticate(new Request("http://test", { headers: { authorization: `Bearer ${deviceToken}` } }))) as Device;
  const seat = async (role: Exclude<Role, "operator">) => {
    const seatToken = newToken();
    await joinSession(code, role, seatToken);
    return device(seatToken);
  };
  return { operator: await device(token), display: await seat("display"), seat };
}

/** A running match, started at `start`. */
async function running() {
  const { operator, display, seat } = await station();
  const player1 = await seat("player1");
  const player2 = await seat("player2");
  expect(await startMatch(operator, names, start)).toBeNull();
  const view = async (now: number, device: Device = display) => (await snapshotFor(device, now)).match!;
  const { id } = await view(start);
  const answer = (device: Device, question: number, choice: number, at: number, matchId = id) =>
    submitAnswer(device, { matchId, question, choice }, at);
  return { operator, display, player1, player2, view, answer };
}

const rightChoice = (match: NonNullable<Snapshot["match"]>) =>
  content.questions.find((question) => question.prompt === match.question.prompt)!.answer;
const wrongChoice = (match: NonNullable<Snapshot["match"]>) => (rightChoice(match) + 1) % match.question.choices.length;
const score = (match: NonNullable<Snapshot["match"]>, role: PlayerRole) => match.players[role].score;

for (const [elapsed, points] of [
  [0, 1000],
  [3_500, 825],
  [18_000, 100],
  [3_600_000, 100],
]) {
  test(`a correct answer after ${elapsed}ms earns ${points} points`, async () => {
    const { player2, view, answer } = await running();

    expect(await answer(player2, 1, rightChoice(await view(start)), start + elapsed)).toBeNull();

    const closed = await view(start + elapsed);
    expect(closed).toMatchObject({ phase: "closed", result: { scorer: "player2", points } });
    expect([score(closed, "player1"), score(closed, "player2")]).toEqual([0, points]);
  });
}

test("a question has no timeout", async () => {
  const { player1, view } = await running();

  expect(await view(start + 24 * 3_600_000, player1)).toMatchObject({
    phase: "open",
    question: { number: 1 },
    canAnswer: true,
  });
});

test("no device is told which choice is correct", async () => {
  const { operator, display, player1, view, answer } = await running();
  const expectNoAnswer = async (now: number) => {
    for (const device of [operator, display, player1]) {
      const sent = await view(now, device);
      expect(Object.keys(sent.question).sort()).toEqual(["choices", "number", "prompt"]);
      expect(JSON.stringify(sent)).not.toMatch(/"(answer|correct\w*)":/i);
    }
  };
  await expectNoAnswer(start);

  await answer(player1, 1, rightChoice(await view(start)), start + 1000);

  await expectNoAnswer(start + 1000);
  expect(Object.keys(((await view(start + 1000)) as { result: object }).result).sort()).toEqual(["points", "scorer"]);
});

test("simultaneous correct taps give the question to one player only", async () => {
  const { player1, player2, view, answer } = await running();
  const choice = rightChoice(await view(start));

  const outcomes = await Promise.all(
    [player1, player2, player1, player2].map((player) => answer(player, 1, choice, start + 2000)),
  );

  expect(outcomes.filter((outcome) => outcome === null)).toHaveLength(1);
  const closed = await view(start + 2000);
  expect(score(closed, "player1") + score(closed, "player2")).toBe(900);
});

test("simultaneous taps from one player count once", async () => {
  const { player1, view, answer } = await running();
  const choice = wrongChoice(await view(start));

  const outcomes = await Promise.all(Array.from({ length: 4 }, () => answer(player1, 1, choice, start + 1000)));

  expect(outcomes.filter((outcome) => outcome === null)).toHaveLength(1);
});

test("a wrong answer locks out only the player who gave it", async () => {
  const { player1, player2, view, answer } = await running();
  const open = await view(start);

  expect(await answer(player1, 1, wrongChoice(open), start + 1000)).toBeNull();

  expect(await view(start + 1000, player1)).toMatchObject({ phase: "open", canAnswer: false });
  expect(await view(start + 1000, player2)).toMatchObject({ phase: "open", canAnswer: true });
  expect(await answer(player1, 1, rightChoice(open), start + 2000)).toMatchObject({ status: 409 });
  expect(await answer(player2, 1, rightChoice(open), start + 4000)).toBeNull();
  expect(await view(start + 4000)).toMatchObject({ result: { scorer: "player2", points: 800 } });
});

test("two wrong answers close the question with no points", async () => {
  const { player1, player2, view, answer } = await running();
  const choice = wrongChoice(await view(start));

  await answer(player1, 1, choice, start + 1000);
  await answer(player2, 1, choice, start + 2000);

  const closed = await view(start + 2000);
  expect(closed).toMatchObject({ phase: "closed", result: { scorer: null, points: 0 } });
  expect([score(closed, "player1"), score(closed, "player2")]).toEqual([0, 0]);
});

test("the next question opens by itself after the pause", async () => {
  const { player1, player2, view, answer } = await running();
  const first = await view(start);
  await answer(player1, 1, rightChoice(first), start + 1000);
  const opens = start + 1000 + pause;

  expect(await view(opens - 1, player2)).toMatchObject({ phase: "closed", question: { number: 1 }, nextInMs: 1 });
  // A tap that arrives before the question opens cannot count, whatever it picked.
  expect(await answer(player2, 2, 0, opens - 1)).toMatchObject({ status: 409 });

  const second = await view(opens, player2);
  expect(second).toMatchObject({ phase: "open", question: { number: 2 }, canAnswer: true });
  expect(second.question.prompt).not.toBe(first.question.prompt);
  // Timed from this question's opening, not the match's.
  await answer(player2, 2, rightChoice(second), opens + 2000);
  expect(await view(opens + 2000)).toMatchObject({ result: { scorer: "player2", points: 900 } });
});

test("stale and malformed submissions are rejected", async () => {
  const { operator, display, player1, view, answer } = await running();
  const open = await view(start);
  const right = rightChoice(open);

  expect(await answer(player1, 2, right, start)).toMatchObject({ status: 409 });
  expect(await answer(player1, 1, right, start - 1)).toMatchObject({ status: 409 });
  expect(await answer(player1, 1, right, start, "another-match")).toMatchObject({ status: 409 });
  expect(await answer(player1, 1, open.question.choices.length, start)).toMatchObject({ status: 400 });
  expect(await answer(display, 1, right, start)).toMatchObject({ status: 403 });
  expect(await answer(operator, 1, right, start)).toMatchObject({ status: 403 });
  expect(await view(start, player1)).toMatchObject({ phase: "open", canAnswer: true });

  await answer(player1, 1, right, start);
  expect(await answer(player1, 1, right, start + 1)).toMatchObject({ status: 409 });
});

test("the match ends after the configured number of distinct questions, keeping both scores", async () => {
  const { operator, player1, player2, view, answer } = await running();
  const prompts: string[] = [];
  let now = start;

  for (let number = 1; number <= content.questionsPerMatch; number++) {
    const open = await view(now);
    expect(open).toMatchObject({ phase: "open", question: { number }, questionCount: content.questionsPerMatch });
    prompts.push(open.question.prompt);
    expect(await answer(number % 2 ? player1 : player2, number, rightChoice(open), now)).toBeNull();
    now += pause;
  }

  expect(new Set(prompts).size).toBe(content.questionsPerMatch);
  const done = await view(now);
  expect(done).toMatchObject({
    phase: "complete",
    players: {
      player1: { name: "Amira", score: Math.ceil(content.questionsPerMatch / 2) * 1000 },
      player2: { name: "Bilal", score: Math.floor(content.questionsPerMatch / 2) * 1000 },
    },
  });
  expect(await answer(player1, content.questionsPerMatch, 0, now)).toMatchObject({ status: 409 });

  // The station is free for the next pair.
  expect(await startMatch(operator, { player1: "Chidi", player2: "Dana" }, now)).toBeNull();
  expect(await view(now)).toMatchObject({ phase: "open", players: { player1: { name: "Chidi", score: 0 } } });
});

test("only the quiz operator can start a match, and only one at a time", async () => {
  const { operator, display } = await running();
  expect(await startMatch(operator, names, start)).toMatchObject({ status: 409 });
  expect(await startMatch(display, names, start)).toMatchObject({ status: 403 });

  const budget = await station("budget");
  expect(await startMatch(budget.operator, names, start)).toMatchObject({ status: 409 });
});

test("simultaneous starts create one match", async () => {
  const { operator } = await station();

  const outcomes = await Promise.all(Array.from({ length: 4 }, () => startMatch(operator, names, start)));

  expect(outcomes.filter((outcome) => outcome === null)).toHaveLength(1);
});

test("content mistakes are reported", () => {
  const [question] = content.questions;
  for (const broken of [
    { ...content, questionsPerMatch: content.questions.length + 1 },
    { ...content, questionsPerMatch: 0 },
    { ...content, pauseSeconds: -1 },
    { ...content, scoring: { ...content.scoring, floor: content.scoring.start + 1 } },
    { ...content, questions: [...content.questions, question] },
    { ...content, questions: [{ ...question, answer: question.choices.length }] , questionsPerMatch: 1 },
    { ...content, questions: [{ ...question, choices: ["Only one"], answer: 0 }], questionsPerMatch: 1 },
  ]) {
    expect(() => checkContent(broken)).toThrow(/content\/quiz\.json/);
  }
});
