import { bearer, createSession, createSessionByApi, expect, join, joinByApi, seatStatus, test } from "./station";

test("two sessions running at once keep their own state", async ({ newDevice }) => {
  const quizDisplay = await newDevice();
  const quiz = await createSession(quizDisplay, "quiz");
  const budgetDisplay = await newDevice();
  const budget = await createSession(budgetDisplay, "budget");

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

  await join(await newDevice(), budget, "Amira");
  await expect(seatStatus(budgetDisplay, "Player 1")).toHaveText("Connected");
  expect(updates.slice(before)).toEqual([]);

  // A change in the quiz session proves its display was listening, so the silence above means something.
  await join(await newDevice(), quiz, "Bilal");
  await expect(seatStatus(quizDisplay, "Player 1")).toHaveText("Connected");
  await expect(seatStatus(quizDisplay, "Player 2")).toHaveText("Waiting to join");
  expect(updates.length).toBeGreaterThan(before);
});

test("a device's live-update credentials cover its own session only", async ({ request }) => {
  const mine = await createSessionByApi(request);
  await createSessionByApi(request);
  const player = await joinByApi(request, mine.code);

  const tokenRequest = await (await request.get("/api/ably-token", { headers: bearer(player.token) })).json();

  expect(JSON.parse(tokenRequest.capability)).toEqual({ [`session:${mine.code}`]: ["presence", "subscribe"] });
});
