import { createSession, expect, join, seatStatus, test } from "./station";

test("a reloaded device shows the current state without joining again", async ({ newDevice }) => {
  const code = await createSession(await newDevice(), "quiz");
  const display = await newDevice();
  await join(display, code, "Display");
  const player = await newDevice();
  await join(player, code, "Player 1");

  await display.reload();
  await expect(display.getByRole("status")).toHaveText("Connected");
  await expect(seatStatus(display, "Player 1")).toHaveText("Connected");

  await player.reload();
  await expect(player.getByRole("heading", { name: "Player 1" })).toBeVisible();
  await expect(player.getByRole("status")).toHaveText("Connected");
});

test("a device that lost its connection catches up when it returns", async ({ newDevice }) => {
  const code = await createSession(await newDevice(), "quiz");
  const display = await newDevice();
  await join(display, code, "Display");

  await display.context().setOffline(true);
  await expect(display.getByRole("status")).toHaveText("Reconnecting…");
  // Offline, it cannot know who else is still there.
  await expect(seatStatus(display, "Operator")).toHaveText("Checking…");

  await join(await newDevice(), code, "Player 2");
  await expect(seatStatus(display, "Player 2")).toHaveText("Waiting to join");

  const snapshot = display.waitForResponse((response) => response.url().endsWith("/api/snapshot") && response.ok());
  await display.context().setOffline(false);
  await snapshot;
  await expect(display.getByRole("status")).toHaveText("Connected");
  await expect(seatStatus(display, "Operator")).toHaveText("Connected");
  await expect(seatStatus(display, "Player 2")).toHaveText("Connected");
});

test("the display marks a player whose connection drops, and again when it returns", async ({ newDevice }) => {
  const code = await createSession(await newDevice(), "quiz");
  const display = await newDevice();
  await join(display, code, "Display");
  const player = await newDevice();
  await join(player, code, "Player 1");

  await player.context().setOffline(true);
  // Ably may keep a silently dropped device present for about 15s before reporting it gone.
  await expect(seatStatus(display, "Player 1")).toHaveText("Not connected", { timeout: 45_000 });

  await player.context().setOffline(false);
  await expect(seatStatus(display, "Player 1")).toHaveText("Connected");
});
