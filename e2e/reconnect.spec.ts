import { createSession, expect, join, readyButton, seatStatus, test } from "./station";

test("a reloaded device shows the current state without joining again", async ({ newDevice }) => {
  const display = await newDevice();
  const code = await createSession(display, "quiz");
  const player = await newDevice();
  await join(player, code, "Amira");
  await readyButton(player).click();

  await display.reload();
  await expect(display.getByRole("status")).toHaveText("Connected");
  await expect(seatStatus(display, "Player 1")).toHaveText("Connected");
  await expect(display.getByTestId("seat-ready")).toHaveCount(1);

  await player.reload();
  await expect(player.getByRole("heading", { name: "Player 1" })).toBeVisible();
  await expect(player.getByRole("status")).toHaveText("Connected");
  await expect(player.getByText("Waiting for the other player.")).toBeVisible();
});

test("a device that lost its connection catches up when it returns", async ({ newDevice }) => {
  const display = await newDevice();
  const code = await createSession(display, "quiz");

  await display.context().setOffline(true);
  await expect(display.getByRole("status")).toHaveText("Reconnecting…");
  // Offline, it cannot know who else is still there.
  await expect(seatStatus(display, "Display")).toHaveText("Checking…");

  await join(await newDevice(), code, "Bilal");
  await expect(seatStatus(display, "Player 1")).toHaveText("Waiting to join");

  const snapshot = display.waitForResponse((response) => response.url().endsWith("/api/snapshot") && response.ok());
  await display.context().setOffline(false);
  await snapshot;
  await expect(display.getByRole("status")).toHaveText("Connected");
  await expect(seatStatus(display, "Display")).toHaveText("Connected");
  await expect(seatStatus(display, "Player 1")).toHaveText("Connected");
});

test("the display marks a player whose connection drops, and again when it returns", async ({ newDevice }) => {
  const display = await newDevice();
  const code = await createSession(display, "quiz");
  const player = await newDevice();
  await join(player, code, "Amira");

  await player.context().setOffline(true);
  // Ably may keep a silently dropped device present for about 15s before reporting it gone.
  await expect(seatStatus(display, "Player 1")).toHaveText("Not connected", { timeout: 45_000 });

  await player.context().setOffline(false);
  await expect(seatStatus(display, "Player 1")).toHaveText("Connected");
});
