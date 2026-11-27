import type { APIRequestContext } from "@playwright/test";
import content from "../content/budget.json";
import { checkContent } from "../src/lib/budget";
import { db } from "../src/lib/db";
import type { BudgetConfig } from "../src/lib/budget-state";
import { tokenKey } from "../src/lib/protocol/device";
import {
  bearer, createSession, createSessionByApi, expect, join, joinByApi, readyButton, readyByApi, seatStatus, snapshotByApi, test,
} from "./station";

/** A guest joins by API and presses Ready; resolves once the countdown is over and the round is open. */
async function startRound(request: APIRequestContext, code: string, name: string) {
  const player = await joinByApi(request, code, name);
  expect(player.status).toBe(201);
  expect((await readyByApi(request, player.token)).status()).toBe(201);
  await expect.poll(async () => (await snapshotByApi(request, player.token)).budgetRound?.phase).toBe("editing");
  const { budgetRound } = await snapshotByApi(request, player.token);
  return { token: player.token, roundId: budgetRound.id as string };
}

const submit = (request: APIRequestContext, token: string, roundId: string, allocations: number[], action = "confirm", draftVersion = 1) =>
  request.post("/api/budget", { headers: bearer(token), data: { action, roundId, allocations, draftVersion } });

// Confirmations in this file all contribute to the same event.
test.describe.configure({ mode: "default" });

test("a displayed result compares all confirmed rounds live and excludes an abandoned draft", async ({
  newDevice, request,
}) => {
  // Local runs can reuse a database. Treat any previously confirmed rounds as part of the fixture.
  const { rows: baseline } = await db.query<{ config: BudgetConfig; allocations: number[] }>(
    "select config, allocations from budget_rounds where confirmed_at is not null",
  );

  const display = await newDevice();
  const code = await createSession(display, "budget");

  async function startOtherRound(name: string) {
    const { code } = await createSessionByApi(request, "budget");
    const { token, roundId } = await startRound(request, code, name);
    return async (allocations: number[], action = "confirm") => {
      expect((await submit(request, token, roundId, allocations, action)).ok()).toBeTruthy();
    };
  }

  const player = await newDevice();
  await join(player, code, "Alex");
  await readyButton(player).click();
  await player.getByRole("slider", { name: "Headphones" }).press("End");
  await player.getByRole("button", { name: "Confirm allocation" }).click();

  const result = display.getByRole("list", { name: "Confirmed allocation" });
  const productRow = (name: string) => result.getByRole("listitem").filter({ hasText: name });
  const headphones = productRow("Headphones");
  const format = new Intl.NumberFormat("en", { style: "percent", maximumFractionDigits: 2 });
  async function expectAverage(product: string, addedShares: number, addedRounds: number) {
    const previousShares = baseline.reduce((total, { config, allocations }) =>
      total + (allocations[config.products.indexOf(product)] ?? 0) / config.amount, 0);
    const average = format.format((previousShares + addedShares) / (baseline.length + addedRounds));
    await expect(productRow(product).getByText(`Event average ${average}`, { exact: true })).toBeVisible();
  }
  await expect(headphones.getByText("1000 (100%)", { exact: true })).toBeVisible();
  await expectAverage("Headphones", 1, 1);

  const draft = await startOtherRound("Abandoned");
  await draft([1000, 0, 0], "draft");
  const second = await startOtherRound("Sam");
  await second([0, 1000, 0]);
  await expectAverage("Headphones", 1, 2);

  const third = await startOtherRound("Taylor");
  await third([500, 0, 500]);
  await expectAverage("Headphones", 1.5, 3);
  await expectAverage("Portable speaker", 1, 3);
  await expectAverage("Power bank", 0.5, 3);
  await expect(headphones.getByText("1000 (100%)", { exact: true })).toBeVisible();
  await expect(display.getByRole("heading", { name: "Alex’s allocation" })).toBeVisible();
});


for (const viewport of [{ width: 375, height: 667 }, { width: 768, height: 1024 }]) {
  test(`a player can allocate and confirm on a ${viewport.width}px viewport`, async ({ newDevice }) => {
    const display = await newDevice();
    const code = await createSession(display, "budget");
    const player = await newDevice();
    await player.setViewportSize(viewport);
    await join(player, code, "Alex");
    await readyButton(player).click();
    await expect(display.getByText("Headphones", { exact: true })).toBeVisible();
    await expect(display.getByText("Portable speaker", { exact: true })).toBeVisible();
    await expect(display.getByText("Power bank", { exact: true })).toBeVisible();
    await expect(player.getByRole("slider")).toHaveCount(3);

    const confirm = player.getByRole("button", { name: "Confirm allocation" });
    const headphones = player.getByRole("slider", { name: "Headphones" });
    const speaker = player.getByRole("slider", { name: "Portable speaker" });
    await expect(confirm).toBeDisabled();
    const savedDraft = player.waitForResponse((response) =>
      response.url().endsWith("/api/budget") && response.ok() && response.request().postDataJSON()?.action === "draft",
    );
    await headphones.press("ArrowRight");
    await expect(headphones).toHaveValue("100");
    await expect(player.getByText("Allocated: 100", { exact: true })).toBeVisible();
    await expect(player.getByText("Remaining: 900", { exact: true })).toBeVisible();
    await savedDraft;

    await player.reload();
    await expect(headphones).toHaveValue("100");
    await expect(confirm).toBeDisabled();

    await player.route("**/api/budget", (route) => route.fulfill({ status: 503, json: { error: "Unavailable" } }));
    await headphones.press("ArrowRight");
    await expect(player.getByRole("alert").filter({ hasText: "Draft could not be saved" })).toBeVisible();
    await player.unroute("**/api/budget");
    await player.reload();
    await expect(headphones).toHaveValue("200");

    await speaker.press("End");
    await speaker.press("ArrowRight");
    await expect(speaker).toHaveValue("800");
    await expect(player.getByText("Remaining: 0", { exact: true })).toBeVisible();
    await expect(confirm).toBeEnabled();
    await confirm.click();

    await expect(display.getByRole("heading", { name: "Alex’s allocation" })).toBeVisible();
    await display.reload();
    await expect(display.getByText("200 (20%)", { exact: true })).toBeVisible();
    await expect(display.getByText("800 (80%)", { exact: true })).toBeVisible();
    await player.reload();
    await expect(player.getByRole("heading", { name: "Alex’s allocation" })).toBeVisible();
  });
}

test("the server rejects invalid distributions and keeps the confirmed result", async ({ request }) => {
  const { code } = await createSessionByApi(request, "budget");
  const { token, roundId } = await startRound(request, code, "Sam");
  const snapshot = async () => (await snapshotByApi(request, token)).budgetRound;

  for (const allocations of [[-100, 1100, 0], [150, 850, 0], [300, 600, 0], [500, 600, 0]]) {
    const response = await submit(request, token, roundId, allocations);
    expect(response.status(), JSON.stringify(allocations)).toBe(400);
  }
  expect(await snapshot()).toMatchObject({ phase: "editing", allocations: [0, 0, 0] });

  expect((await submit(request, token, roundId, [400, 0, 0], "draft", 2)).status()).toBe(200);
  expect((await submit(request, token, roundId, [0, 100, 0], "draft", 1)).status()).toBe(409);
  expect(await snapshot()).toMatchObject({ phase: "editing", allocations: [400, 0, 0] });

  expect((await submit(request, token, roundId, [400, 600, 0])).status()).toBe(200);
  // A retried confirmation is accepted even though the slot is already free.
  expect((await submit(request, token, roundId, [400, 600, 0])).status()).toBe(200);
  expect((await submit(request, token, roundId, [0, 600, 400])).status()).toBe(409);
  expect((await submit(request, token, roundId, [0, 0, 100], "draft")).status()).toBe(409);
  expect(await snapshot()).toMatchObject({ phase: "confirmed", playerName: "Sam", allocations: [400, 600, 0] });
});

test("pressing Ready twice starts one round", async ({ request }) => {
  const { code } = await createSessionByApi(request, "budget");
  const { token } = await joinByApi(request, code, "Sam");

  const presses = await Promise.all([readyByApi(request, token), readyByApi(request, token)]);

  expect(presses.map((response) => response.status())).toEqual([201, 201]);
  const { rows: [{ count }] } = await db.query<{ count: number }>(
    "select count(*)::int from budget_rounds r join sessions s on s.id = r.session_id where s.code = $1",
    [code],
  );
  expect(count).toBe(1);
});

test("the countdown blocks early saves; confirming frees the slot for a new guest, and the old phone keeps its result", async ({
  newDevice, request,
}) => {
  const display = await newDevice();
  const code = await createSession(display, "budget");
  const phone = await newDevice();
  await join(phone, code, "Alex");
  await readyButton(phone).click();

  // The countdown is on the display and the phone at the same time, and nothing can be saved during it.
  await expect(display.getByTestId("countdown")).toBeVisible();
  await expect(phone.getByTestId("countdown")).toBeVisible();
  const token = (await phone.evaluate((key) => localStorage.getItem(key), tokenKey(code, "player")))!;
  const { budgetRound: counting } = await snapshotByApi(request, token);
  expect(counting).toMatchObject({ phase: "countdown" });
  expect(counting).not.toHaveProperty("allocations");
  expect((await submit(request, token, counting.id, [100, 0, 0], "draft")).status()).toBe(409);
  expect(await snapshotByApi(request, token)).toMatchObject({ budgetRound: { id: counting.id } });

  await phone.getByRole("slider", { name: "Headphones" }).press("End");
  await phone.getByRole("button", { name: "Confirm allocation" }).click();
  await expect(phone.getByRole("heading", { name: "Alex’s allocation" })).toBeVisible();
  await expect(display.getByRole("heading", { name: "Alex’s allocation" })).toBeVisible();
  // The slot is free again, and the display still shows how to join.
  await expect(seatStatus(display, "Player 1")).toHaveText("Waiting to join");
  await expect(display.getByRole("img", { name: "QR code to join" })).toBeVisible();

  // A new guest starts another round on the same session.
  const next = await startRound(request, code, "Sam");
  expect((await submit(request, next.token, next.roundId, [0, 1000, 0])).status()).toBe(200);
  await expect(display.getByRole("heading", { name: "Sam’s allocation" })).toBeVisible();

  // The old phone keeps its own result and offers to play again.
  await phone.reload();
  await expect(phone.getByRole("heading", { name: "Alex’s allocation" })).toBeVisible();
  await expect(phone.getByText("1000 (100%)")).toBeVisible();
  await expect(phone.getByRole("button", { name: "Play again" })).toBeVisible();

  // Stale drafts are refused: the old device on its finished round and on the new one.
  expect((await submit(request, token, counting.id, [0, 100, 0], "draft", 9)).status()).toBe(409);
  expect((await submit(request, token, next.roundId, [0, 100, 0], "draft", 9)).status()).toBe(409);
  expect((await submit(request, next.token, counting.id, [0, 100, 0], "draft", 9)).status()).toBe(409);
  expect(await snapshotByApi(request, next.token)).toMatchObject({ budgetRound: { phase: "confirmed", allocations: [0, 1000, 0] } });

  // Playing again takes the free slot with the same token, then waits for Ready.
  await phone.getByRole("button", { name: "Play again" }).click();
  await expect(phone.getByText("You are in as Alex.")).toBeVisible();
  await expect(readyButton(phone)).toBeVisible();
});

test("content mistakes are reported", () => {
  for (const broken of [
    { ...content, amount: 0 },
    { ...content, step: 0 },
    { ...content, step: content.amount + 1 },
    { ...content, products: [] },
    { ...content, products: ["Headphones", " "] },
    { ...content, products: ["Headphones", "Headphones"] },
  ]) {
    expect(() => checkContent(broken)).toThrow(/content\/budget\.json/);
  }
});
