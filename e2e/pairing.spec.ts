import { createSession, expect, join, readyButton, seatStatus, test } from "./station";

test("creating a session opens its display with a QR code to the join page and the short code", async ({ newDevice, baseURL }) => {
  const display = await newDevice();
  const code = await createSession(display, "quiz");

  await expect(display.getByRole("heading", { name: "Display" })).toBeVisible();
  const qr = display.getByRole("img", { name: "QR code to join" });
  await expect(qr).toBeVisible();
  await expect(qr.locator("svg path")).not.toHaveCount(0);
  await expect(qr).toHaveAttribute("data-url", `${baseURL}/join/${code}`);
  await expect(display.getByTestId("join-code")).toHaveText(code);

  // Scanning the code opens this address on a guest's phone.
  const guest = await newDevice();
  await guest.goto(await qr.getAttribute("data-url") as string);
  await expect(guest.getByLabel("Your name")).toBeVisible();
});

test("the display shows players, their names and Ready as they join and leave", async ({ newDevice }) => {
  const display = await newDevice();
  const code = await createSession(display, "quiz");
  await expect(seatStatus(display, "Display")).toHaveText("Connected");
  await expect(seatStatus(display, "Player 1")).toHaveText("Waiting to join");
  await expect(seatStatus(display, "Player 2")).toHaveText("Waiting to join");

  const player = await newDevice();
  await join(player, code, "Amira");
  await expect(seatStatus(display, "Player 1")).toHaveText("Connected");
  await expect(display.getByRole("list", { name: "Devices" }).getByText("Amira")).toBeVisible();

  await readyButton(player).click();
  await expect(player.getByText("Waiting for the other player.")).toBeVisible();
  await expect(display.getByTestId("seat-ready")).toHaveCount(1);

  await player.goto("about:blank");
  await expect(seatStatus(display, "Player 1")).toHaveText("Not connected");
});

test("a budget session has a single player slot", async ({ newDevice }) => {
  const display = await newDevice();
  await createSession(display, "budget");

  await expect(seatStatus(display, "Player 1")).toHaveText("Waiting to join");
  await expect(seatStatus(display, "Player 2")).toHaveCount(0);
  await expect(display.getByRole("img", { name: "QR code to join" })).toBeVisible();
  await expect(display.getByRole("table", { name: "Event leaderboard" })).toHaveCount(0);
});

test("a join code can be typed in lower case with spaces", async ({ newDevice }) => {
  const code = await createSession(await newDevice(), "quiz");

  const player = await newDevice();
  await player.goto("/");
  await player.getByLabel("Join code").fill(` ${code.slice(0, 3).toLowerCase()} ${code.slice(3).toLowerCase()} `);
  await player.getByRole("button", { name: "Continue" }).click();
  await player.getByLabel("Your name").fill("Amira");
  await player.getByRole("button", { name: "Join" }).click();

  await expect(player.getByText("You are in as Amira.")).toBeVisible();
  await expect(player.getByRole("heading", { name: "Player 1" })).toBeVisible();
});
