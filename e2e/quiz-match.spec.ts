import type { Page } from "@playwright/test";
import content from "../content/quiz.json";
import { createSession, createSessionByApi, expect, join, newToken, test } from "./station";

const startButton = (operator: Page) => operator.getByRole("button", { name: "Start match" });
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

async function startMatch(operator: Page) {
  await operator.getByLabel("Player 1 name").fill("Amira");
  await operator.getByLabel("Player 2 name").fill("Bilal");
  await startButton(operator).click();
}

test("two players race through a whole match", async ({ newDevice }, testInfo) => {
  const operator = await newDevice();
  const code = await createSession(operator, "quiz");
  const display = await newDevice();
  await join(display, code, "Display");
  const player1 = await newDevice();
  await join(player1, code, "Player 1");
  await expect(startButton(operator)).toBeDisabled();
  const player2 = await newDevice();
  await join(player2, code, "Player 2");

  const idleOperator = await newDevice();
  const idleCode = await createSession(idleOperator, "quiz");
  const idleDisplay = await newDevice();
  await join(idleDisplay, idleCode, "Display");
  const idleLeaderboard = idleDisplay.getByRole("table", { name: "Event leaderboard" });
  await expect(idleDisplay.getByRole("heading", { name: "Event leaderboard" })).toBeVisible();

  await startMatch(operator);

  let question = await shownQuestion(display, 1);
  const displayChoices = display.getByRole("list", { name: "Choices" }).getByRole("listitem");
  for (const text of [question.right, question.wrong]) {
    await expect(display.getByRole("list", { name: "Choices" }).getByText(text, { exact: true })).toBeVisible();
    await expect(choice(player1, text)).toBeEnabled();
    await expect(choice(player2, text)).toBeEnabled();
  }
  await expect(display.getByRole("button")).toHaveCount(0);

  // A wrong tap locks out only the player who made it.
  await choice(player1, question.wrong).click();
  await expect(player1.getByText("Wrong answer. Wait for the next question.")).toBeVisible();
  await expect(choice(player1, question.right)).toBeDisabled();
  await expect(displayChoices).toHaveText(question.choices);

  // A reload mid-question recovers the question and who may answer it.
  await player1.reload();
  await expect(player1.getByRole("heading", { level: 2 })).toHaveText(question.prompt);
  await expect(choice(player1, question.right)).toBeDisabled();
  await player2.reload();
  for (const text of question.choices) {
    await expect(choice(player2, text)).toBeEnabled();
  }

  await choice(player2, question.right).click();
  await expect(display.getByText(/^Bilal takes \d+ points$/)).toBeVisible();
  await expect(choice(player2, question.right)).toBeDisabled();

  // The rest of the match advances without the operator.
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

  for (const page of [display, operator, player1, player2]) {
    await expect(page.getByRole("heading", { name: "Match over" })).toBeVisible();
    await expect(scores(page).filter({ hasText: "Amira" })).toContainText(/Amira\s*[1-9]/);
    await expect(scores(page).filter({ hasText: "Bilal" })).toContainText(/Bilal\s*[1-9]/);
  }
  const finalLeaderboard = display.getByRole("table", { name: "Event leaderboard" });
  await expect(finalLeaderboard).toBeVisible();
  await expect(idleLeaderboard.getByRole("row")).toHaveText(await finalLeaderboard.getByRole("row").allTextContents());
  await expect(startButton(operator)).toBeEnabled();
  for (const [name, page] of Object.entries({ display, operator, player1 })) {
    await testInfo.attach(`${name} match over`, { body: await page.screenshot({ fullPage: true }), contentType: "image/png" });
  }
});

test("the server refuses a start or answer it should not accept", async ({ request }) => {
  const { code, token } = await createSessionByApi(request);
  const player = newToken();
  for (const [role, deviceToken] of [
    ["player1", player],
    ["player2", newToken()],
  ]) {
    await request.post("/api/join", { data: { code, role, token: deviceToken } });
  }
  const post = (path: string, bearer: string, data: unknown) =>
    request.post(path, { data, headers: { authorization: `Bearer ${bearer}` } });
  const names = { player1: "Amira", player2: "Bilal" };

  // Both seats are taken, but neither device is connected.
  const offline = await post("/api/match", token, names);
  expect([offline.status(), await offline.json()]).toEqual([409, { error: "Both player devices must be connected." }]);

  for (const data of [{}, { ...names, player2: "   " }, { ...names, player1: "x".repeat(31) }, "not json"]) {
    expect((await post("/api/match", token, data)).status()).toBe(400);
  }
  expect((await post("/api/match", player, names)).status()).toBe(403);
  expect((await post("/api/match", "forged", names)).status()).toBe(401);

  for (const data of [{}, { matchId: "x", question: 1.5, choice: 0 }, { matchId: "x", question: 1, choice: "0" }]) {
    expect((await post("/api/answer", player, data)).status()).toBe(400);
  }
  expect((await post("/api/answer", player, { matchId: "x", question: 1, choice: 0 })).status()).toBe(409);
  expect((await post("/api/answer", "forged", {})).status()).toBe(401);
});

test("the operator stops the match on every device and the display returns to idle", async ({ newDevice }) => {
  const operator = await newDevice();
  const code = await createSession(operator, "quiz");
  const display = await newDevice();
  const player1 = await newDevice();
  const player2 = await newDevice();
  await join(display, code, "Display");
  await join(player1, code, "Player 1");
  await join(player2, code, "Player 2");
  await startMatch(operator);
  await shownQuestion(display, 1);
  await shownQuestion(player1, 1);
  await shownQuestion(player2, 1);

  await operator.getByRole("button", { name: "Stop match" }).click();

  await expect(display.getByRole("heading", { name: "Match stopped" })).toBeVisible();
  await expect(display.getByText("The operator ended the match.")).toBeVisible();
  await expect(startButton(operator)).toBeEnabled();
  await expect(player1.getByRole("group", { name: "Choices" })).toHaveCount(0);
  await expect(player2.getByRole("group", { name: "Choices" })).toHaveCount(0);
  await expect(display.getByRole("heading", { name: "Display" })).toBeVisible();
});

const viewports = {
  "small phone": { width: 320, height: 568 },
  "phone landscape": { width: 844, height: 390 },
  "tablet landscape": { width: 1180, height: 820 },
  display: { width: 1920, height: 1080 },
};

test("the match screens fit phones, tablets and the display", async ({ newDevice }, testInfo) => {
  const operator = await newDevice();
  const code = await createSession(operator, "quiz");
  const display = await newDevice();
  await display.setViewportSize(viewports.display);
  await join(display, code, "Display");
  const player1 = await newDevice();
  await join(player1, code, "Player 1");
  await join(await newDevice(), code, "Player 2");

  const expectFits = async (page: Page, view: string, size: keyof typeof viewports) => {
    await page.setViewportSize(viewports[size]);
    const [needed, available] = await page.evaluate(() => [document.documentElement.scrollWidth, innerWidth]);
    expect(needed).toBeLessThanOrEqual(available);
    await testInfo.attach(`${view} - ${size}`, { body: await page.screenshot({ fullPage: true }), contentType: "image/png" });
  };

  await expectFits(operator, "operator idle", "small phone");
  // The longest name the operator can type, with nowhere to wrap.
  await operator.getByLabel("Player 1 name").fill("W".repeat(30));
  await operator.getByLabel("Player 2 name").fill("Bilal");
  await startButton(operator).click();

  const { right } = await shownQuestion(display, 1);
  await expectFits(display, "display open", "display");
  // A shared display shows the whole question without scrolling.
  expect(await display.evaluate(() => document.documentElement.scrollHeight <= innerHeight)).toBe(true);
  for (const size of ["small phone", "phone landscape", "tablet landscape"] as const) {
    await shownQuestion(player1, 1);
    await expectFits(player1, "player open", size);
  }
  await expectFits(operator, "operator running", "small phone");

  await choice(player1, right).click();
  await expect(display.getByText(/takes \d+ points$/)).toBeVisible();
  await expectFits(display, "display closed", "display");
  expect(await display.evaluate(() => document.documentElement.scrollHeight <= innerHeight)).toBe(true);
  await expectFits(player1, "player closed", "small phone");
});
