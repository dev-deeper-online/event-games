import { createSession, createSessionByApi, expect, join, seatStatus, test } from "./station";

test("two sessions running at once keep their own state", async ({ newDevice }) => {
  const quiz = await createSession(await newDevice(), "quiz");
  const budget = await createSession(await newDevice(), "budget");
  const quizDisplay = await newDevice();
  await join(quizDisplay, quiz, "Display");
  const budgetDisplay = await newDevice();
  await join(budgetDisplay, budget, "Display");

  // Ably protocol actions 14 and 15 carry presence and channel messages; the rest is housekeeping.
  const updates: string[] = [];
  quizDisplay.on("websocket", (socket) =>
    socket.on("framereceived", ({ payload }) => {
      if ([14, 15].includes(JSON.parse(String(payload)).action)) updates.push(String(payload));
    }),
  );
  await quizDisplay.reload();
  await expect(seatStatus(quizDisplay, "Display")).toHaveText("Connected");
  const before = updates.length;

  await join(await newDevice(), budget, "Player 1");
  await expect(seatStatus(budgetDisplay, "Player 1")).toHaveText("Connected");
  expect(updates.slice(before)).toEqual([]);

  // A change in the quiz session proves its display was listening, so the silence above means something.
  await join(await newDevice(), quiz, "Player 2");
  await expect(seatStatus(quizDisplay, "Player 2")).toHaveText("Connected");
  await expect(seatStatus(quizDisplay, "Player 1")).toHaveText("Waiting to join");
  expect(updates.length).toBeGreaterThan(before);
});

test("a device's live-update credentials cover its own session only", async ({ request }) => {
  const mine = await createSessionByApi(request);
  await createSessionByApi(request);

  const tokenRequest = await (
    await request.get("/api/ably-token", { headers: { authorization: `Bearer ${mine.token}` } })
  ).json();

  expect(JSON.parse(tokenRequest.capability)).toEqual({ [`session:${mine.code}`]: ["presence", "subscribe"] });
});
