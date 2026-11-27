import { createSession, createSessionByApi, expect, join, newToken, submitJoin, test } from "./station";

// Next.js renders its own empty alert region, so match on the message.
const message = (page: import("@playwright/test").Page, text: string) => page.getByRole("alert").filter({ hasText: text });

test("an unknown code cannot join", async ({ newDevice }) => {
  const page = await newDevice();
  // "0" is never used in a join code, so this one cannot exist.
  await submitJoin(page, "000000", "Display");

  await expect(message(page, "No session uses that code.")).toBeVisible();
  await expect(page).toHaveURL("/");
});

test("a taken player slot cannot be taken again", async ({ newDevice }) => {
  const code = await createSession(await newDevice(), "quiz");
  await join(await newDevice(), code, "Player 1");

  const late = await newDevice();
  await submitJoin(late, code, "Player 1");

  await expect(message(late, "Player 1 is already taken.")).toBeVisible();
  await expect(late).toHaveURL("/");
});

test("a budget session rejects a second player", async ({ newDevice }) => {
  const code = await createSession(await newDevice(), "budget");

  const page = await newDevice();
  await submitJoin(page, code, "Player 2");

  await expect(message(page, "This game has no Player 2.")).toBeVisible();
});

test("a join whose reply was lost can be retried for the same seat", async ({ newDevice }) => {
  const code = await createSession(await newDevice(), "quiz");
  const player = await newDevice();
  // The server takes the seat, then the connection drops before the device hears back.
  await player.route(
    "**/api/join",
    async (route) => {
      await route.fetch();
      await route.abort();
    },
    { times: 1 },
  );
  await submitJoin(player, code, "Player 1");
  await expect(message(player, "Something went wrong.")).toBeVisible();

  await player.getByRole("button", { name: "Join" }).click();

  await expect(player.getByRole("heading", { name: "Player 1" })).toBeVisible();
  await expect(player.getByRole("status")).toHaveText("Connected");
});

test("a device that never joined cannot open a station page", async ({ newDevice }) => {
  const code = await createSession(await newDevice(), "quiz");

  const stranger = await newDevice();
  await stranger.goto(`/session/${code}/player1`);

  await expect(stranger.getByRole("heading", { name: "This device has not joined" })).toBeVisible();
  await expect(stranger.getByTestId("join-code")).toHaveCount(0);
});

test("simultaneous joins give a player slot to one device only", async ({ request }) => {
  const { code } = await createSessionByApi(request);

  const attempts = await Promise.all(
    Array.from({ length: 5 }, () => request.post("/api/join", { data: { code, role: "player1", token: newToken() } })),
  );

  expect(attempts.map((response) => response.status()).sort()).toEqual([201, 409, 409, 409, 409]);
});

test("the join endpoint refuses the operator role and malformed requests", async ({ request }) => {
  const { code } = await createSessionByApi(request);
  const token = newToken();

  for (const data of [
    { code, token, role: "operator" },
    { code, token },
    { code, role: "display" },
    { code, role: "display", token: "guessable" },
    "not json",
  ]) {
    expect((await request.post("/api/join", { data })).status()).toBe(400);
  }
  expect((await request.post("/api/sessions", { data: { gameType: "chess" } })).status()).toBe(400);
});

test("state and live updates require a device token", async ({ request }) => {
  for (const path of ["/api/snapshot", "/api/ably-token"]) {
    expect((await request.get(path)).status()).toBe(401);
    expect((await request.get(path, { headers: { authorization: "Bearer forged" } })).status()).toBe(401);
  }
});

test("a device turned away from a seat can join it afterwards", async ({ newDevice }) => {
  const code = await createSession(await newDevice(), "quiz");
  const device = await newDevice();
  await device.goto(`/session/${code}/player1`);

  // Navigate inside the app, as a guest would, so the earlier page is still in memory.
  await device.getByRole("link", { name: "Join with a code" }).click();
  await device.getByLabel("Join code").fill(code);
  await device.getByRole("radio", { name: "Player 1" }).check();
  await device.getByRole("button", { name: "Join" }).click();

  await expect(device.getByRole("heading", { name: "Player 1" })).toBeVisible();
  await expect(device.getByRole("status")).toHaveText("Connected");
});
