import { createSession, expect, join, newToken, test } from "./station";

for (const viewport of [{ width: 375, height: 667 }, { width: 768, height: 1024 }]) {
  test(`a player can allocate and confirm on a ${viewport.width}px viewport`, async ({ page: operator, newDevice }) => {
    const code = await createSession(operator, "budget");
    const [display, player] = await Promise.all([newDevice(), newDevice()]);
    await player.setViewportSize(viewport);
    await Promise.all([join(display, code, "Display"), join(player, code, "Player 1")]);

    await operator.getByLabel("Player name").fill("Alex");
    await operator.getByRole("button", { name: "Start budget round" }).click();
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
  const created = await request.post("/api/sessions", { data: { gameType: "budget" } });
  expect(created.ok()).toBeTruthy();
  const { code, token: operatorToken } = await created.json();
  const playerToken = newToken();
  const joined = await request.post("/api/join", { data: { code, role: "player1", token: playerToken } });
  expect(joined.ok()).toBeTruthy();
  const operator = { authorization: `Bearer ${operatorToken}` };
  const player = { authorization: `Bearer ${playerToken}` };

  const start = () => request.post("/api/budget", {
    headers: operator, data: { action: "start", playerName: "Sam" },
  });
  const starts = await Promise.all([start(), start()]);
  expect(starts.map((response) => response.status()).sort()).toEqual([201, 409]);

  const snapshot = async () => {
    const response = await request.get("/api/snapshot", { headers: player });
    expect(response.ok()).toBeTruthy();
    return (await response.json()).budgetRound;
  };
  const { id: roundId } = await snapshot();
  const submit = (allocations: number[], action = "confirm", draftVersion = 1) => request.post("/api/budget", {
    headers: player, data: { action, roundId, allocations, draftVersion },
  });

  for (const allocations of [[-100, 1100, 0], [150, 850, 0], [300, 600, 0], [500, 600, 0]]) {
    const response = await submit(allocations);
    expect(response.status(), JSON.stringify(allocations)).toBe(400);
  }
  expect(await snapshot()).toMatchObject({ phase: "editing", allocations: [0, 0, 0] });

  expect((await submit([400, 0, 0], "draft", 2)).status()).toBe(200);
  expect((await submit([0, 100, 0], "draft", 1)).status()).toBe(409);
  expect(await snapshot()).toMatchObject({ phase: "editing", allocations: [400, 0, 0] });

  expect((await submit([400, 600, 0])).status()).toBe(200);
  expect((await submit([400, 600, 0])).status()).toBe(200);
  expect((await submit([0, 600, 400])).status()).toBe(409);
  expect((await submit([0, 0, 100], "draft")).status()).toBe(409);
  expect(await snapshot()).toMatchObject({ phase: "confirmed", playerName: "Sam", allocations: [400, 600, 0] });
});
