import { createSession, expect, join, seatStatus, test } from "./station";

test("the display shows devices as they join and leave", async ({ newDevice }) => {
  const operator = await newDevice();
  const code = await createSession(operator, "quiz");

  const display = await newDevice();
  await join(display, code, "Display");
  await expect(seatStatus(display, "Operator")).toHaveText("Connected");
  await expect(seatStatus(display, "Player 1")).toHaveText("Waiting to join");
  await expect(seatStatus(display, "Player 2")).toHaveText("Waiting to join");

  const player = await newDevice();
  await join(player, code, "Player 1");
  await expect(seatStatus(display, "Player 1")).toHaveText("Connected");
  await expect(seatStatus(operator, "Player 1")).toHaveText("Connected");

  await player.goto("about:blank");
  await expect(seatStatus(display, "Player 1")).toHaveText("Not connected");
});

test("a budget session has a single player slot", async ({ newDevice }) => {
  const operator = await newDevice();
  await createSession(operator, "budget");

  await expect(seatStatus(operator, "Player 1")).toHaveText("Waiting to join");
  await expect(seatStatus(operator, "Player 2")).toHaveCount(0);
});

test("a join code can be typed in lower case with spaces", async ({ newDevice }) => {
  const code = await createSession(await newDevice(), "quiz");

  const player = await newDevice();
  await join(player, ` ${code.slice(0, 3).toLowerCase()} ${code.slice(3).toLowerCase()} `, "Player 1");
  await expect(player.getByTestId("join-code")).toHaveText(code);
});
