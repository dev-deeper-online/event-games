import { db } from "../src/lib/db";
import { authenticate, createSession, joinSession, snapshotFor } from "../src/lib/sessions";
import { submitAnswer } from "../src/lib/quiz";
import { expect, newToken, test } from "./station";

test("the event ranks both players from each completed match and includes all ties at tenth", async () => {
  const { code, token } = await createSession("quiz");
  const device = await authenticate(new Request("http://test", { headers: { authorization: `Bearer ${token}` } }));
  if (!device) throw new Error("Could not authenticate the fixture session");

  try {
    // Keep these fixtures above scores from real matches, including earlier test runs.
    const scores = [
      ["Repeat", 1_000_000_010, "Third", 1_000_000_009],
      ["Fourth", 1_000_000_008, "Fifth", 1_000_000_007],
      ["Sixth", 1_000_000_006, "Seventh", 1_000_000_005],
      ["Ninth", 1_000_000_003, "Tenth A", 1_000_000_002],
      ["Tenth B", 1_000_000_002, "Below cutoff", 1_000_000_001],
    ] as const;
    for (const players of scores) {
      await db.query(
        `insert into matches (session_id, player1_name, player1_score, player2_name, player2_score, completed_at)
         values ($1, $2, $3, $4, $5, now())`,
        [device.sessionId, ...players],
      );
    }
    // Set up a match on its last question with both scores already earned.
    const { rows: [running] } = await db.query<{ id: string }>(
      `insert into matches (session_id, player1_name, player1_score, player2_name, player2_score)
       values ($1, 'Repeat', 1000000010, 'First loser', 1000000004) returning id`,
      [device.sessionId],
    );
    await db.query(
      `insert into match_questions (match_id, position, prompt, choices, correct_choice, opens_at)
       values ($1, 1, 'Final question', array['Right', 'Wrong'], 0, now())`,
      [running.id],
    );

    const viewer = await createSession("quiz");
    try {
      const displayToken = newToken();
      expect(await joinSession(viewer.code, "display", displayToken)).toBeNull();
      const viewerDevice = await authenticate(
        new Request("http://test", { headers: { authorization: `Bearer ${displayToken}` } }),
      );
      if (!viewerDevice) throw new Error("Could not authenticate the viewer session");
      const before = await snapshotFor(viewerDevice);
      expect(before.leaderboard?.filter(({ name }) => name === "Repeat")).toHaveLength(1);
      expect(before.leaderboard?.some(({ name }) => name === "First loser")).toBe(false);

      for (const role of ["player1", "player2"] as const) {
        const playerToken = newToken();
        expect(await joinSession(code, role, playerToken)).toBeNull();
        const player = await authenticate(
          new Request("http://test", { headers: { authorization: `Bearer ${playerToken}` } }),
        );
        if (!player) throw new Error("Could not authenticate the player");
        expect(await submitAnswer(player, { matchId: running.id, question: 1, choice: 1 }, Date.now()))
          .toEqual({ completed: role === "player2" });
      }

      const { leaderboard } = await snapshotFor(viewerDevice);

      const entries = leaderboard?.map(({ name, rank, score }) => [name, rank, score]);
      expect(entries?.slice(0, 9)).toEqual([
        ["Repeat", 1, 1_000_000_010],
        ["Repeat", 1, 1_000_000_010],
        ["Third", 3, 1_000_000_009],
        ["Fourth", 4, 1_000_000_008],
        ["Fifth", 5, 1_000_000_007],
        ["Sixth", 6, 1_000_000_006],
        ["Seventh", 7, 1_000_000_005],
        ["First loser", 8, 1_000_000_004],
        ["Ninth", 9, 1_000_000_003],
      ]);
      expect(entries?.slice(9).sort()).toEqual([
        ["Tenth A", 10, 1_000_000_002],
        ["Tenth B", 10, 1_000_000_002],
      ]);
    } finally {
      await db.query("delete from sessions where code = $1", [viewer.code]);
    }
  } finally {
    await db.query("delete from sessions where id = $1", [device.sessionId]);
  }
});
