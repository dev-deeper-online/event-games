import type { Page } from "@playwright/test";
import content from "../content/quiz.json";
import { db } from "../src/lib/db";
import { bearer, createSession, createSessionByApi, expect, join, joinByApi, readyButton, readyByApi, test } from "./station";

const choice = (page: Page, name: string) => page.getByRole("group", { name: "Choices" }).getByRole("button", { name, exact: true });
const scores = (page: Page) => page.getByRole("list", { name: "Scores" }).getByRole("listitem");

/** The question the page is showing, with its answers looked up in the content file. */
async function shownQuestion(page: Page, number: number) {
  await expect(page.getByText(`Question ${number} of ${content.questionsPerMatch}`)).toBeVisible();
  const prompt = await page.getByRole("heading", { level: 2 }).innerText();
  const question = content.questions.find((candidate) => candidate.prompt === prompt)!;
  return {
    prompt,
    choices: question.choices,
    right: question.choices[question.answer],
    wrong: question.choices[(question.answer + 1) % question.choices.length],
  };
}

/** Two guests scan the code, enter their names and join; the first to join is Player 1. */
async function seatPlayers(newDevice: () => Promise<Page>, code: string, names: [string, string] = ["Amira", "Bilal"]) {
  const player1 = await newDevice();
  await join(player1, code, names[0]);
  const player2 = await newDevice();
  await join(player2, code, names[1]);
  return { player1, player2 };
}

const answers = (page: Page) => page.getByRole("list", { name: "Answers" }).getByRole("listitem");

test("two players race through a whole match", async ({ newDevice }, testInfo) => {
  const display = await newDevice();
  const code = await createSession(display, "quiz");
  const { player1, player2 } = await seatPlayers(newDevice, code);

  const idleDisplay = await newDevice();
  await createSession(idleDisplay, "quiz");
  const idleLeaderboard = idleDisplay.getByRole("table", { name: "Event leaderboard" });
  await expect(idleDisplay.getByRole("heading", { name: "Event leaderboard" })).toBeVisible();
  await expect(idleDisplay.getByRole("img", { name: "QR code to join" })).toBeVisible();

  // The countdown waits for every slot to be Ready.
  await readyButton(player1).click();
  await expect(player1.getByText("Waiting for the other player.")).toBeVisible();
  await expect(display.getByTestId("countdown")).toHaveCount(0);
  await readyButton(player2).click();
  for (const page of [display, player1, player2]) {
    await expect(page.getByTestId("countdown")).toBeVisible();
  }
  // A phone that reloads mid-countdown recovers it from the server's start time.
  await player1.reload();
  await expect(player1.getByTestId("countdown")).toBeVisible();

  let question = await shownQuestion(display, 1);
  const displayChoices = display.getByRole("list", { name: "Choices" }).getByRole("listitem");
  for (const text of [question.right, question.wrong]) {
    await expect(display.getByRole("list", { name: "Choices" }).getByText(text, { exact: true })).toBeVisible();
    await expect(choice(player1, text)).toBeEnabled();
    await expect(choice(player2, text)).toBeEnabled();
  }
  // The display only reads the choices; it can stop the match.
  await expect(display.getByRole("group", { name: "Choices" })).toHaveCount(0);
  await expect(display.getByRole("button")).toHaveText("Stop match");

  // A wrong tap locks out only the player who made it.
  await choice(player1, question.wrong).click();
  await expect(player1.getByText("Wrong answer. Wait for the next question.")).toBeVisible();
  await expect(choice(player1, question.right)).toBeDisabled();
  await expect(displayChoices).toHaveText(question.choices);
  // The display and the opponent hear about it, without the choice.
  for (const page of [display, player2]) await expect(answers(page)).toHaveText(["Amira answered wrong"]);

  // A reload mid-question recovers the question and who may answer it.
  await player1.reload();
  await expect(player1.getByRole("heading", { level: 2 })).toHaveText(question.prompt);
  await expect(choice(player1, question.right)).toBeDisabled();
  await player2.reload();
  for (const text of question.choices) {
    await expect(choice(player2, text)).toBeEnabled();
  }

  await choice(player2, question.right).click();
  await expect(answers(display)).toHaveText(["Amira answered wrong", /^Bilal takes \d+ points$/]);
  await expect(choice(player2, question.right)).toBeDisabled();

  // The rest of the match advances by itself.
  const prompts = [question.prompt];
  for (let number = 2; number <= content.questionsPerMatch; number++) {
    question = await shownQuestion(display, number);
    await shownQuestion(player1, number);
    prompts.push(question.prompt);
    if (number === 2 && number < content.questionsPerMatch) {
      const scoresBefore = await scores(display).allTextContents();
      await choice(player1, question.wrong).click();
      await expect(player1.getByText("Wrong answer. Wait for the next question.")).toBeVisible();
      await player2.reload();
      await expect(player2.getByRole("heading", { level: 2 })).toHaveText(question.prompt);
      await choice(player2, question.wrong).click();
      await expect(display.getByText("No points this time")).toBeVisible();
      await expect(answers(display)).toHaveText(["Amira answered wrong", "Bilal answered wrong"]);
      await expect(displayChoices).toHaveText(question.choices);
      await expect(scores(display)).toHaveText(scoresBefore);
      continue;
    }
    if (number === 3) {
      // A display that was away catches up on the question in progress.
      await display.context().setOffline(true);
      await expect(display.getByText("Reconnecting…")).toBeVisible();
      await display.context().setOffline(false);
      await shownQuestion(display, number);
      await expect(scores(display).filter({ hasText: "Bilal" })).not.toContainText(/Bilal\s*0$/);
    }
    if (number === content.questionsPerMatch) {
      await Promise.all([
        idleDisplay.waitForResponse((response) => new URL(response.url()).pathname === "/api/snapshot" && response.ok()),
        choice(player1, question.right).click(),
      ]);
    } else {
      await choice(player1, question.right).click();
    }
  }
  expect(new Set(prompts).size).toBe(content.questionsPerMatch);

  for (const page of [display, player1, player2]) {
    await expect(page.getByRole("heading", { name: "Match over" })).toBeVisible();
    await expect(scores(page).filter({ hasText: "Amira" })).toContainText(/Amira\s*[1-9]/);
    await expect(scores(page).filter({ hasText: "Bilal" })).toContainText(/Bilal\s*[1-9]/);
  }
  const finalLeaderboard = display.getByRole("table", { name: "Event leaderboard" });
  await expect(finalLeaderboard).toBeVisible();
  await expect(idleLeaderboard.getByRole("row")).toHaveText(await finalLeaderboard.getByRole("row").allTextContents());
  for (const [name, page] of Object.entries({ display, player1 })) {
    await testInfo.attach(`${name} match over`, { body: await page.screenshot({ fullPage: true }), contentType: "image/png" });
  }

  // The slots are free again: the display still offers the QR code, and two new guests can play.
  await expect(display.getByRole("img", { name: "QR code to join" })).toBeVisible();
  await expect(player1.getByRole("button", { name: "Play again" })).toBeVisible();
  const next = await seatPlayers(newDevice, code, ["Chidi", "Dana"]);
  await readyButton(next.player1).click();
  await readyButton(next.player2).click();
  await shownQuestion(display, 1);
  await shownQuestion(next.player1, 1);

  // The old phones keep their own finished match and know nothing of the new one.
  for (const page of [player1, player2]) {
    await expect(page.getByRole("heading", { name: "Match over" })).toBeVisible();
    await expect(page.getByRole("group", { name: "Choices" })).toHaveCount(0);
  }
  await expect(scores(player1).filter({ hasText: "Amira" })).toContainText(/Amira\s*[1-9]/);
  await expect(scores(next.player1).filter({ hasText: "Chidi" })).toContainText(/Chidi\s*0/);
});

test("the server refuses an answer or stop it should not accept", async ({ request }) => {
  const { code, token: display } = await createSessionByApi(request);
  const player = (await joinByApi(request, code, "Amira")).token;
  await joinByApi(request, code, "Bilal");
  const post = (path: string, token: string, data: unknown) => request.post(path, { data, headers: bearer(token) });

  // Only one of two players is Ready, so there is nothing to answer yet.
  expect((await readyByApi(request, player)).status()).toBe(201);
  for (const data of [{}, { matchId: "x", question: 1.5, choice: 0 }, { matchId: "x", question: 1, choice: "0" }]) {
    expect((await post("/api/answer", player, data)).status()).toBe(400);
  }
  expect((await post("/api/answer", player, { matchId: "x", question: 1, choice: 0 })).status()).toBe(409);
  expect((await post("/api/answer", display, { matchId: "x", question: 1, choice: 0 })).status()).toBe(403);
  expect((await post("/api/answer", "forged", {})).status()).toBe(401);

  expect((await post("/api/match/stop", display, {})).status()).toBe(400);
  expect((await post("/api/match/stop", display, { matchId: "x" })).status()).toBe(409);
  expect((await post("/api/match/stop", player, { matchId: "x" })).status()).toBe(403);
  expect((await post("/api/match/stop", "forged", { matchId: "x" })).status()).toBe(401);
});

test("the display stops the match on every device, nothing reaches the leaderboard and the slots are free", async ({ newDevice, request }) => {
  const display = await newDevice();
  const code = await createSession(display, "quiz");
  const { player1, player2 } = await seatPlayers(newDevice, code, ["Stopper One", "Stopper Two"]);
  const idleDisplay = await newDevice();
  await createSession(idleDisplay, "quiz");
  await readyButton(player1).click();
  await readyButton(player2).click();
  await shownQuestion(display, 1);
  await shownQuestion(player1, 1);
  await shownQuestion(player2, 1);

  await display.getByRole("button", { name: "Stop match" }).click();

  await expect(display.getByRole("heading", { name: "Match stopped" })).toBeVisible();
  await expect(display.getByText("The match was stopped.")).toBeVisible();
  await expect(player1.getByRole("group", { name: "Choices" })).toHaveCount(0);
  await expect(player2.getByRole("group", { name: "Choices" })).toHaveCount(0);
  await expect(display.getByRole("heading", { name: "Display" })).toBeVisible();
  const { rows: [{ count }] } = await db.query<{ count: number }>(
    "select count(*)::int from matches m join sessions s on s.id = m.session_id where s.code = $1",
    [code],
  );
  expect(count).toBe(0);
  await expect(idleDisplay.getByRole("table", { name: "Event leaderboard" })).not.toContainText("Stopper");

  // The stopped players are guests; a new one can join the free slot.
  await expect(player1.getByRole("button", { name: "Play again" })).toBeVisible();
  expect((await joinByApi(request, code, "Chidi")).status).toBe(201);
});

const viewports = {
  "small phone": { width: 320, height: 568 },
  "phone landscape": { width: 844, height: 390 },
  "tablet landscape": { width: 1180, height: 820 },
  display: { width: 1920, height: 1080 },
};

test("the match screens fit phones, tablets and the display", async ({ newDevice }, testInfo) => {
  const display = await newDevice();
  await display.setViewportSize(viewports.display);
  const code = await createSession(display, "quiz");
  const player1 = await newDevice();
  // The longest name a guest can type, with nowhere to wrap.
  await join(player1, code, "W".repeat(30));
  const player2 = await newDevice();
  await join(player2, code, "Bilal");

  const expectFits = async (page: Page, view: string, size: keyof typeof viewports) => {
    await page.setViewportSize(viewports[size]);
    const [needed, available] = await page.evaluate(() => [document.documentElement.scrollWidth, innerWidth]);
    expect(needed).toBeLessThanOrEqual(available);
    await testInfo.attach(`${view} - ${size}`, { body: await page.screenshot({ fullPage: true }), contentType: "image/png" });
  };

  await expectFits(display, "display idle", "display");
  await expectFits(player1, "player lobby", "small phone");
  await readyButton(player1).click();
  await readyButton(player2).click();
  await expect(player1.getByTestId("countdown")).toBeVisible();
  await expectFits(player1, "player countdown", "small phone");

  const { right } = await shownQuestion(display, 1);
  await expectFits(display, "display open", "display");
  // A shared display shows the whole question without scrolling.
  expect(await display.evaluate(() => document.documentElement.scrollHeight <= innerHeight)).toBe(true);
  for (const size of ["small phone", "phone landscape", "tablet landscape"] as const) {
    await shownQuestion(player1, 1);
    await expectFits(player1, "player open", size);
  }

  await choice(player1, right).click();
  await expect(display.getByText(/takes \d+ points$/)).toBeVisible();
  await expectFits(display, "display closed", "display");
  expect(await display.evaluate(() => document.documentElement.scrollHeight <= innerHeight)).toBe(true);
  await expectFits(player1, "player closed", "small phone");
});
