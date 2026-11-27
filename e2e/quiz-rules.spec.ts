// Drives the server's submission interface with a controlled clock, against the real database.
import { expect, test } from "@playwright/test";
import content from "../content/quiz.json";
import { db } from "../src/lib/db";
import type { PlayerRole } from "../src/lib/protocol/roles";
import type { ShownMatch } from "../src/lib/protocol/snapshot";
import { checkContent, countdownMs, stopMatch, submitAnswer, type Submission } from "../src/lib/quiz";
import {
  authenticate, createSession, joinSession, liveSnapshotFor, markReady, snapshotFor, type Device,
} from "../src/lib/sessions";
import { newToken } from "./station";

// The default scoring numbers, pinned so that tuning the content file cannot fail these tests.
Object.assign(content.scoring, { start: 1000, lostPerSecond: 50, floor: 100 });

const start = Date.parse("2026-01-01T12:00:00Z");
const pause = content.pauseSeconds * 1000;
const countdown = countdownMs();
const grace = content.disconnectGraceSeconds * 1000;
const names = { player1: "Amira", player2: "Bilal" };

type Seated = Device & { token: string };

async function station(gameType: "quiz" | "budget" = "quiz") {
  const { code, token } = await createSession(gameType);
  const device = async (deviceToken: string) =>
    ({ ...(await authenticate(new Request("http://test", { headers: { authorization: `Bearer ${deviceToken}` } }))), token: deviceToken }) as Seated;
  /** A guest scans the code and takes the next free slot. */
  const seat = async (name = "Guest") => {
    const seatToken = newToken();
    expect(await joinSession(code, name, seatToken)).toBeNull();
    return device(seatToken);
  };
  return { code, display: await device(token), seat, device };
}

/** A running match: both players pressed Ready at `start - countdown`, so the first question opens at `start`. */
async function running() {
  const { code, display, seat, device } = await station();
  const player1 = await seat(names.player1);
  const player2 = await seat(names.player2);
  const matchStart = start - countdown;
  expect(await markReady(player1, matchStart)).toBeNull();
  expect(await markReady(player2, matchStart)).toBeNull();
  const view = async (now: number, viewer: Device = display) => (await snapshotFor(viewer, now)).match as ShownMatch;
  const { id } = await view(start);
  const refreshInMs = (await snapshotFor(display, start)).refreshInMs!;
  const firstDeadline = matchStart + refreshInMs + grace;
  let lastCheckIn = matchStart;
  const stayConnected = async (until: number) => {
    for (let now = lastCheckIn + refreshInMs; now <= until; now += refreshInMs) {
      await liveSnapshotFor(player1, now);
      await liveSnapshotFor(player2, now);
      lastCheckIn = now;
    }
  };
  const answer = (device: Device, question: number, choice: number, at: number, attempt?: Pick<Submission, "matchId" | "retryId">) =>
    submitAnswer(device, { matchId: id, question, choice, ...attempt }, at);
  return { code, display, player1, player2, seat, device, id, view, answer, firstDeadline, stayConnected, retryOf: retryAttempt };
}

/** The same device as it is now: a role changes when its round ends. */
const current = async (device: Seated) =>
  (await authenticate(new Request("http://test", { headers: { authorization: `Bearer ${device.token}` } }))) as Device;

const rightChoice = (match: ShownMatch) =>
  content.questions.find((question) => question.prompt === match.question.prompt)!.answer;
const wrongChoice = (match: ShownMatch) => (rightChoice(match) + 1) % match.question.choices.length;
const score = (match: ShownMatch, role: PlayerRole) => match.players[role].score;

function retryAttempt(match: ShownMatch) {
  if (match.phase !== "open" || !match.retryId) throw new Error("Expected an open retry");
  return { matchId: match.id, retryId: match.retryId };
}

test("only the display can discard a running match, and the freed station can start again", async () => {
  const { display, player1, player2, view, answer, seat } = await running();
  const first = await view(start);
  expect(await answer(player1, 1, rightChoice(first), start)).toEqual({ completed: content.questionsPerMatch === 1 });

  expect(await stopMatch(player1, first.id, start + 1)).toMatchObject({ status: 403 });
  expect(await stopMatch(display, first.id, start + 1)).toBeNull();
  expect(await snapshotFor(display, start + 1)).toMatchObject({ match: null, stopNotice: { reason: "display" } });
  expect(await answer(player1, 1, 0, start + 2)).toMatchObject({ status: 409 });
  expect(await snapshotFor(display, start + 60_000)).toMatchObject({ match: null, stopNotice: null });
  expect(await stopMatch(display, first.id, start + 60_001)).toMatchObject({ status: 409 });

  // Both slots are free: two new guests join, press Ready, and play a fresh match.
  const next1 = await seat("Chidi");
  const next2 = await seat("Dana");
  expect([next1.role, next2.role]).toEqual(["player1", "player2"]);
  expect(await markReady(next1, start + 60_000)).toBeNull();
  expect(await markReady(next2, start + 60_000)).toBeNull();
  const next = await view(start + 60_000 + countdown);
  expect(next.id).not.toBe(first.id);
  expect(score(next, "player1")).toBe(0);
  expect(next.players.player1.name).toBe("Chidi");
  // The stopped players keep no result of that match.
  expect((await snapshotFor((await current(player2)), start + 60_000)).match).toBeNull();
});

test("a player who returns inside the grace period resumes with their answer lockout", async () => {
  const { display, player1, player2, view, answer, firstDeadline } = await running();
  const first = await view(start);
  expect(await answer(player1, 1, wrongChoice(first), start)).toEqual({ completed: false });
  await liveSnapshotFor(player2, start + Math.floor(grace / 2));

  const returning = await liveSnapshotFor(player1, firstDeadline - 1);
  expect(returning.stopped).toBe(false);
  expect(returning.snapshot.match).toMatchObject({ id: first.id, question: first.question, canAnswer: false });
  const afterOriginalDeadline = await liveSnapshotFor(display, firstDeadline);
  expect(afterOriginalDeadline.snapshot.match).toMatchObject({ id: first.id, phase: "open" });
});

test("one expired player deadline discards the match even if that player tries to reconnect", async () => {
  const { display, player1, player2, view, firstDeadline } = await running();
  const first = await view(start);
  await liveSnapshotFor(player2, start + Math.floor(grace / 2));
  const readOnly = await liveSnapshotFor(player1, firstDeadline - 1, { checkIn: false });
  expect(readOnly.snapshot.match).toMatchObject({ id: first.id });

  const returning = await liveSnapshotFor(player1, firstDeadline);
  expect(returning).toMatchObject({ stopped: true, snapshot: { match: null } });
  expect((await liveSnapshotFor(display, firstDeadline)).snapshot).toMatchObject({
    match: null,
    stopNotice: { reason: "disconnect" },
  });
});

test("an answer arriving at an expired player deadline cannot save the match", async () => {
  const { display, player2, view, answer, firstDeadline } = await running();
  const first = await view(start);
  await liveSnapshotFor(player2, start + Math.floor(grace / 2));

  expect(await answer(player2, 1, rightChoice(first), firstDeadline)).toMatchObject({ status: 409, stopped: true });
  expect(await snapshotFor(display, firstDeadline)).toMatchObject({
    match: null,
    stopNotice: { reason: "disconnect" },
  });
});

for (const [elapsed, points] of [
  [0, 1000],
  [3_500, 825],
  [18_000, 100],
]) {
  test(`a correct answer after ${elapsed}ms earns ${points} points`, async () => {
    const { player2, view, answer, stayConnected } = await running();

    await stayConnected(start + elapsed);
    expect(await answer(player2, 1, rightChoice(await view(start)), start + elapsed)).toEqual({ completed: content.questionsPerMatch === 1 });

    const closed = await view(start + elapsed);
    expect(closed).toMatchObject({ phase: "closed", result: { scorer: "player2", points } });
    expect([score(closed, "player1"), score(closed, "player2")]).toEqual([0, points]);
  });
}

test("a question has no timeout", async () => {
  const { player1, stayConnected } = await running();
  await stayConnected(start + grace * 2);

  expect((await liveSnapshotFor(player1, start + grace * 2)).snapshot.match).toMatchObject({
    phase: "open",
    question: { number: 1 },
    canAnswer: true,
  });
});

test("no device is told which choice is correct", async () => {
  const { display, player1, player2, view, answer, retryOf } = await running();
  const expectNoAnswer = async (now: number) => {
    for (const device of [display, player1, player2]) {
      const sent = await view(now, device);
      expect(Object.keys(sent.question).sort()).toEqual(["choices", "number", "prompt"]);
      for (const outcome of sent.outcomes) expect(Object.keys(outcome).sort()).toEqual(expect.arrayContaining(["id", "kind", "player"]));
      expect(JSON.stringify(sent)).not.toMatch(/"(answer|correct\w*|chosen\w*|selected\w*|choice)":/i);
    }
  };
  await expectNoAnswer(start);

  // A wrong answer is announced to the display and the opponent without its choice.
  const first = await view(start);
  await answer(player1, 1, wrongChoice(first), start + 500);
  await expectNoAnswer(start + 500);
  expect((await view(start + 500, player2)).outcomes).toEqual([{ id: "1-0", player: "player1", kind: "wrong" }]);

  await answer(player2, 1, rightChoice(first), start + 1000, retryOf(await view(start + 500, player2)));
  expect(Object.keys(((await view(start + 1000)) as { result: object }).result).sort()).toEqual(["points", "scorer"]);
});

test("simultaneous correct taps give the question to one player only", async () => {
  const { player1, player2, view, answer, stayConnected } = await running();
  const choice = rightChoice(await view(start));
  await stayConnected(start + 2000);

  const outcomes = await Promise.all(
    [player1, player2, player1, player2].map((player) => answer(player, 1, choice, start + 2000)),
  );

  expect(outcomes.filter((outcome) => "completed" in outcome)).toHaveLength(1);
  const closed = await view(start + 2000);
  expect(score(closed, "player1") + score(closed, "player2")).toBe(900);
});

test("simultaneous taps from one player count once", async () => {
  const { player1, view, answer } = await running();
  const choice = wrongChoice(await view(start));

  const outcomes = await Promise.all(Array.from({ length: 4 }, () => answer(player1, 1, choice, start + 1000)));

  expect(outcomes.filter((outcome) => "completed" in outcome)).toHaveLength(1);
});

test("a wrong answer locks out only the player who gave it", async () => {
  const { player1, player2, view, answer, stayConnected } = await running();
  const open = await view(start);

  expect(await answer(player1, 1, wrongChoice(open), start + 1000)).toEqual({ completed: false });

  expect(await view(start + 1000, player1)).toMatchObject({ phase: "open", canAnswer: false });
  expect((await view(start + 1000)).outcomes).toEqual([{ id: "1-0", player: "player1", kind: "wrong" }]);
  const retry = await view(start + 1000, player2);
  expect(retry).toMatchObject({ phase: "open", canAnswer: true, question: open.question });
  expect(await view(start + 1000)).not.toHaveProperty("retryId");
  expect(await view(start + 1000, player1)).not.toHaveProperty("retryId");
  await stayConnected(start + 2000);
  expect(await answer(player1, 1, rightChoice(open), start + 2000)).toMatchObject({ status: 409 });
  await stayConnected(start + 4000);
  expect(await answer(player2, 1, rightChoice(open), start + 4000, retryAttempt(retry))).toEqual({ completed: content.questionsPerMatch === 1 });
  expect(await view(start + 4000)).toMatchObject({ result: { scorer: "player2", points: 800 } });
  // Wrong then scoring: one list holds both, so a device that missed the state between them loses nothing.
  expect((await view(start + 4000)).outcomes).toEqual([
    { id: "1-0", player: "player1", kind: "wrong" },
    { id: "1-1", player: "player2", kind: "scored", points: 800 },
  ]);
});

test("a tap received before the retry opens cannot count as the retry", async () => {
  const { player1, player2, view, answer, stayConnected } = await running();
  const open = await view(start, player2);
  expect(open).not.toHaveProperty("retryId");

  expect(await answer(player1, 1, wrongChoice(open), start + 1000)).toEqual({ completed: false });

  // A queued tap still belongs to the original attempt, regardless of its arrival timestamp.
  for (const receivedAt of [start + 999, start + 1000, start + 1500]) {
    expect(await answer(player2, 1, rightChoice(open), receivedAt)).toMatchObject({ status: 409 });
  }

  const retry = retryAttempt(await view(start + 2000, player2));
  await stayConnected(start + 4000);
  expect(await answer(player2, 1, rightChoice(open), start + 4000, retry)).toEqual({ completed: content.questionsPerMatch === 1 });
  expect(await answer(player2, 1, rightChoice(open), start + 4001, retry)).toMatchObject({ status: 409 });
  expect(await view(start + 4000)).toMatchObject({ result: { scorer: "player2", points: 800 } });
});

test("two wrong answers close the question with no points", async () => {
  const { player1, player2, view, answer, stayConnected } = await running();
  const choice = wrongChoice(await view(start));

  expect(await answer(player1, 1, choice, start + 1000)).toEqual({ completed: false });
  const retry = retryAttempt(await view(start + 1000, player2));
  await stayConnected(start + 2000);
  expect(await answer(player2, 1, choice, start + 2000, retry)).toEqual({ completed: content.questionsPerMatch === 1 });

  const closed = await view(start + 2000);
  expect(closed).toMatchObject({ phase: "closed", result: { scorer: null, points: 0 } });
  expect(closed.outcomes).toEqual([
    { id: "1-0", player: "player1", kind: "wrong" },
    { id: "1-1", player: "player2", kind: "wrong" },
  ]);
  expect([score(closed, "player1"), score(closed, "player2")]).toEqual([0, 0]);
});

test("the next question opens by itself after the pause", async () => {
  const { player1, player2, view, answer, stayConnected } = await running();
  const first = await view(start);
  await answer(player1, 1, rightChoice(first), start + 1000);
  const opens = start + 1000 + pause;

  expect(await view(opens - 1, player2)).toMatchObject({ phase: "closed", question: { number: 1 }, nextInMs: 1 });
  // A tap that arrives before the question opens cannot count, whatever it picked.
  await stayConnected(opens - 1);
  expect(await answer(player2, 2, 0, opens - 1)).toMatchObject({ status: 409 });

  const second = await view(opens, player2);
  expect(second).toMatchObject({ phase: "open", question: { number: 2 }, canAnswer: true });
  expect(second.question.prompt).not.toBe(first.question.prompt);
  // Timed from this question's opening, not the match's.
  await stayConnected(opens + 2000);
  await answer(player2, 2, rightChoice(second), opens + 2000);
  expect(await view(opens + 2000)).toMatchObject({ result: { scorer: "player2", points: 900 } });
});

test("stale and malformed submissions are rejected", async () => {
  const { display, player1, view, answer } = await running();
  const open = await view(start);
  const right = rightChoice(open);

  expect(await answer(player1, 2, right, start)).toMatchObject({ status: 409 });
  expect(await answer(player1, 1, right, start - 1)).toMatchObject({ status: 409 });
  expect(await answer(player1, 1, right, start, { matchId: "another-match" })).toMatchObject({ status: 409 });
  expect(await answer(player1, 1, open.question.choices.length, start)).toMatchObject({ status: 400 });
  expect(await answer(display, 1, right, start)).toMatchObject({ status: 403 });
  expect(await view(start, player1)).toMatchObject({ phase: "open", canAnswer: true });

  await answer(player1, 1, right, start);
  expect(await answer(player1, 1, right, start + 1)).toMatchObject({ status: 409 });
});

test("the match ends after the configured number of distinct questions, keeping both scores", async () => {
  const { code, player1, player2, view, answer, stayConnected, seat } = await running();
  const prompts: string[] = [];
  let now = start;

  for (let number = 1; number <= content.questionsPerMatch; number++) {
    await stayConnected(now);
    const open = await view(now);
    expect(open).toMatchObject({ phase: "open", question: { number }, questionCount: content.questionsPerMatch });
    prompts.push(open.question.prompt);
    expect(await answer(number % 2 ? player1 : player2, number, rightChoice(open), now)).toEqual({ completed: number === content.questionsPerMatch });
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

  // The slots are free, so old phones keep their own result and a new pair can start.
  const finished = Object.fromEntries(
    await Promise.all([player1, player2].map(async (player) => [player.token, await view(now, await current(player))])),
  );
  for (const player of [player1, player2]) {
    expect((await current(player)).role).toBe("guest");
    expect(finished[player.token]).toMatchObject({ phase: "complete", id: done.id });
  }
  const oldMatch = done.id;

  // An old phone can play again: the same token reseats the same device in a free slot.
  expect(await joinSession(code, "Amira", player1.token)).toBeNull();
  const again = await current(player1);
  expect([again.role, again.deviceId]).toEqual(["player1", player1.deviceId]);
  const third = await seat("Chidi");
  expect(third.role).toBe("player2");
  // Both slots are taken again: a further guest is refused.
  expect(await joinSession(code, "Late", newToken())).toMatchObject({ status: 409 });

  expect(await markReady(again, now)).toBeNull();
  expect(await markReady(third, now)).toBeNull();
  const next = await view(now + countdown);
  expect(next.id).not.toBe(oldMatch);
  expect(next).toMatchObject({ phase: "open", players: { player1: { name: "Amira", score: 0 }, player2: { name: "Chidi" } } });

  // The other old phone still shows its own finished match, and its answers to either match are refused.
  expect(await view(now + countdown, await current(player2))).toMatchObject({ phase: "complete", id: oldMatch });
  const stale = await current(player2);
  expect(await submitAnswer(stale, { matchId: oldMatch, question: 1, choice: 0 }, now + countdown)).toMatchObject({ status: 409 });
  expect(await submitAnswer(stale, { matchId: next.id, question: 1, choice: 0 }, now + countdown)).toMatchObject({ status: 409 });
});

test("Ready starts a match only when every slot is Ready", async () => {
  const { display, seat } = await station();
  const view = async (now: number) => (await snapshotFor(display, now)).match;
  const player1 = await seat("Amira");
  expect(await markReady(display, start)).toMatchObject({ status: 409 });

  expect(await markReady(player1, start)).toBeNull();
  // Pressing again changes nothing.
  expect(await markReady(player1, start + 100)).toBeNull();
  expect(await view(start + 100)).toBeNull();

  const player2 = await seat("Bilal");
  expect(await markReady(player2, start + 200)).toBeNull();
  // The countdown shows on every device and reveals no question.
  const counting = await view(start + 1000);
  expect(counting).toMatchObject({ phase: "countdown", startsInMs: countdown - 800 });
  expect(counting).not.toHaveProperty("question");
  expect(await view(start + 200 + countdown)).toMatchObject({ phase: "open", question: { number: 1 } });
});

test("answers during the countdown are refused", async () => {
  const { player1, display } = await running();
  const first = await snapshotFor(display, start);
  const id = (first.match as ShownMatch).id;

  expect(await submitAnswer(player1, { matchId: id, question: 1, choice: 0 }, start - 1)).toMatchObject({ status: 409 });
});

test("simultaneous Ready taps start exactly one match", async () => {
  const { code, display, seat } = await station();
  const [player1, player2] = [await seat("Amira"), await seat("Bilal")];

  const outcomes = await Promise.all([markReady(player1, start), markReady(player2, start), markReady(player1, start), markReady(player2, start)]);

  expect(outcomes).toEqual([null, null, null, null]);
  const { rows: [{ count }] } = await db.query<{ count: number }>(
    "select count(*)::int from matches m join sessions s on s.id = m.session_id where s.code = $1",
    [code],
  );
  expect(count).toBe(1);
  expect((await snapshotFor(display, start)).match).toMatchObject({ phase: "countdown" });
});

test("a budget station starts its round on one Ready", async () => {
  const { seat, display } = await station("budget");
  const player = await seat("Amira");
  expect((await snapshotFor(display, start)).budgetRound).toBeNull();

  expect(await markReady(player, start)).toBeNull();

  expect((await snapshotFor(display, start)).budgetRound).toMatchObject({ phase: "countdown", startsInMs: countdown, playerName: "Amira" });
  expect((await snapshotFor(display, start + countdown)).budgetRound).toMatchObject({ phase: "editing" });
});

test("content mistakes are reported", () => {
  const [question] = content.questions;
  for (const broken of [
    { ...content, questionsPerMatch: content.questions.length + 1 },
    { ...content, questionsPerMatch: 0 },
    { ...content, pauseSeconds: -1 },
    { ...content, disconnectGraceSeconds: 0 },
    { ...content, countdownSeconds: -1 },
    { ...content, abandonSeconds: -1 },
    { ...content, leaderboardSize: 0 },
    { ...content, scoring: { ...content.scoring, floor: content.scoring.start + 1 } },
    { ...content, questions: [...content.questions, question] },
    { ...content, questions: [{ ...question, answer: question.choices.length }] , questionsPerMatch: 1 },
    { ...content, questions: [{ ...question, choices: ["Only one"], answer: 0 }], questionsPerMatch: 1 },
  ]) {
    expect(() => checkContent(broken)).toThrow(/content\/quiz\.json/);
  }
});
