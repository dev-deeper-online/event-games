import { createHash } from "node:crypto";
import { db } from "../src/lib/db";
import { tokenKey } from "../src/lib/protocol/device";
import {
  bearer, createSession, createSessionByApi, expect, join, joinByApi, newToken, snapshotByApi, submitJoin, test,
} from "./station";

// Next.js renders its own empty alert region, so match on the message.
const message = (page: import("@playwright/test").Page, text: string) => page.getByRole("alert").filter({ hasText: text });

/** Makes a seat look like it was taken long ago. */
const ageSeat = (token: string) =>
  db.query("update devices set seated_at = now() - interval '1 hour' where token_hash = $1", [
    createHash("sha256").update(token).digest("hex"),
  ]);

const seatedRoles = async (request: import("@playwright/test").APIRequestContext, displayToken: string) =>
  (await snapshotByApi(request, displayToken)).seats
    .filter(({ role }: { role: string }) => role !== "display")
    .map(({ role, deviceIds }: { role: string; deviceIds: string[] }) => [role, deviceIds.length]);

test("there is no operator page or start endpoint", async ({ page, request }) => {
  expect((await page.goto("/operator"))?.status()).toBe(404);
  expect((await request.post("/api/match", { data: {} })).status()).toBe(404);
  const { code } = await createSessionByApi(request);
  expect((await request.post("/api/join", { data: { code, role: "operator", token: newToken() } })).status()).toBe(400);
});

test("an unknown code cannot join", async ({ newDevice }) => {
  const page = await newDevice();
  // "0" is never used in a join code, so this one cannot exist.
  await submitJoin(page, "000000", "Amira");

  await expect(message(page, "No session uses that code.")).toBeVisible();
});

test("a third quiz device is told the station is full", async ({ newDevice }) => {
  const code = await createSession(await newDevice(), "quiz");
  await join(await newDevice(), code, "Amira");
  await join(await newDevice(), code, "Bilal");

  const late = await newDevice();
  await submitJoin(late, code, "Chidi");

  await expect(message(late, "This station is full.")).toBeVisible();
  await expect(late).toHaveURL(`/join/${code}`);
});

test("a second budget device is told the station is full", async ({ newDevice }) => {
  const code = await createSession(await newDevice(), "budget");
  await join(await newDevice(), code, "Amira");

  const late = await newDevice();
  await submitJoin(late, code, "Bilal");

  await expect(message(late, "This station is full.")).toBeVisible();
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
  await submitJoin(player, code, "Amira");
  await expect(message(player, "Something went wrong.")).toBeVisible();

  await player.getByRole("button", { name: "Join" }).click();

  await expect(player.getByText("You are in as Amira.")).toBeVisible();
  await expect(player.getByRole("heading", { name: "Player 1" })).toBeVisible();
  await expect(player.getByRole("status")).toHaveText("Connected");
});

test("a device that never joined cannot open a station page", async ({ newDevice }) => {
  const code = await createSession(await newDevice(), "quiz");

  const stranger = await newDevice();
  await stranger.goto(`/session/${code}/player`);

  await expect(stranger.getByRole("heading", { name: "This device has not joined" })).toBeVisible();
  await expect(stranger.getByTestId("join-code")).toHaveCount(0);

  // An address naming no seat is turned away the same way.
  await stranger.goto(`/session/${code}/referee`);
  await expect(stranger.getByRole("heading", { name: "This device has not joined" })).toBeVisible();
});

test("simultaneous joins into an empty quiz station seat exactly two devices", async ({ request }) => {
  const { code, token } = await createSessionByApi(request);

  const attempts = await Promise.all(Array.from({ length: 3 }, () => joinByApi(request, code)));

  expect(attempts.map(({ status }) => status).sort()).toEqual([201, 201, 409]);
  expect(await seatedRoles(request, token)).toEqual([["player1", 1], ["player2", 1]]);
});

test("two devices racing for the last free slot end with one winner", async ({ request }) => {
  const { code, token } = await createSessionByApi(request);
  expect((await joinByApi(request, code)).status).toBe(201);

  const attempts = await Promise.all([joinByApi(request, code), joinByApi(request, code)]);

  expect(attempts.map(({ status }) => status).sort()).toEqual([201, 409]);
  expect(await seatedRoles(request, token)).toEqual([["player1", 1], ["player2", 1]]);
});

test("the same device joining concurrently takes one seat", async ({ request }) => {
  const { code, token } = await createSessionByApi(request);
  const device = newToken();

  const attempts = await Promise.all(Array.from({ length: 5 }, () => joinByApi(request, code, "Amira", device)));

  expect(attempts.map(({ status }) => status)).toEqual([201, 201, 201, 201, 201]);
  expect(await seatedRoles(request, token)).toEqual([["player1", 1], ["player2", 0]]);
});

test("a seat that nobody connected to is reclaimed only after the abandon period", async ({ request }) => {
  const { code, token } = await createSessionByApi(request, "budget");
  const first = await joinByApi(request, code, "Slow");

  // A fresh join whose phone has not connected yet is never evicted.
  expect((await joinByApi(request, code, "Eager")).status).toBe(409);
  expect(await seatedRoles(request, token)).toEqual([["player1", 1]]);

  await ageSeat(first.token);
  expect((await joinByApi(request, code, "Eager")).status).toBe(201);
  expect((await snapshotByApi(request, first.token)).role).toBe("guest");
});

test("an old seat is kept while its phone is connected", async ({ newDevice, request }) => {
  const display = await newDevice();
  const code = await createSession(display, "budget");
  const player = await newDevice();
  await join(player, code, "Amira");
  await expect(display.getByTestId("seat-status")).toHaveText(["Connected", "Connected"]);
  await ageSeat((await player.evaluate((key) => localStorage.getItem(key), tokenKey(code, "player")))!);

  expect((await joinByApi(request, code, "Bilal")).status).toBe(409);
});

test("the join endpoint refuses malformed requests", async ({ request }) => {
  const { code } = await createSessionByApi(request);
  const token = newToken();
  const name = "Amira";

  for (const data of [
    { code, token },
    { code, token, name: "   " },
    { code, token, name: "x".repeat(31) },
    { code, name },
    { code, name, token: "guessable" },
    { name, token },
    "not json",
  ]) {
    expect((await request.post("/api/join", { data })).status(), JSON.stringify(data)).toBe(400);
  }
  expect((await request.post("/api/sessions", { data: { gameType: "chess" } })).status()).toBe(400);
});

test("a display cannot take a player seat and ready needs a seat", async ({ request }) => {
  const { code, token } = await createSessionByApi(request);

  const response = await request.post("/api/join", { data: { code, name: "Display", token } });
  expect(response.status()).toBe(409);
  expect((await request.post("/api/ready", { headers: bearer(token) })).status()).toBe(409);
  expect((await request.post("/api/ready", { headers: bearer("forged") })).status()).toBe(401);
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
  await device.goto(`/session/${code}/player`);

  // Navigate inside the app, as a guest would, so the earlier page is still in memory.
  await device.getByRole("link", { name: "Join with a code" }).click();
  await device.getByLabel("Join code").fill(code);
  await device.getByRole("button", { name: "Continue" }).click();
  await device.getByLabel("Your name").fill("Amira");
  await device.getByRole("button", { name: "Join" }).click();

  await expect(device.getByRole("heading", { name: "Player 1" })).toBeVisible();
  await expect(device.getByRole("status")).toHaveText("Connected");
});
