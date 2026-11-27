import { db } from "../src/lib/db";
import content from "../content/quiz.json";
import { authenticate, createSession, joinSession, snapshotFor } from "../src/lib/sessions";
import { submitAnswer } from "../src/lib/quiz";
import { expect, newToken, test } from "./station";

test("the event ranks both players from each completed match and includes all ties at the last place", async () => {
  // The fixtures below are shaped for ten places; the size itself comes from the content file.
  Object.assign(content, { leaderboardSize: 10 });
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
    const viewer = await createSession("quiz");
    try {
      // The session's creator is its display.
      const viewerDevice = await authenticate(
        new Request("http://test", { headers: { authorization: `Bearer ${viewer.token}` } }),
      );
      if (!viewerDevice) throw new Error("Could not authenticate the viewer session");
      const before = await snapshotFor(viewerDevice);
      expect(before.leaderboard?.filter(({ name }) => name === "Repeat")).toHaveLength(1);
      expect(before.leaderboard?.some(({ name }) => name === "First loser")).toBe(false);

      // Set up a match on its last question with both scores already earned.
      const players = [];
      for (const name of ["Repeat", "First loser"]) {
        const playerToken = newToken();
        expect(await joinSession(code, name, playerToken)).toBeNull();
        const player = await authenticate(
          new Request("http://test", { headers: { authorization: `Bearer ${playerToken}` } }),
        );
        if (!player) throw new Error("Could not authenticate the player");
        players.push(player);
      }
      const { rows: [running] } = await db.query<{ id: string }>(
        `insert into matches (session_id, player1_name, player1_score, player2_name, player2_score,
           player1_device_id, player2_device_id)
         values ($1, 'Repeat', 1000000010, 'First loser', 1000000004, $2, $3) returning id`,
        [device.sessionId, players[0].deviceId, players[1].deviceId],
      );
      await db.query(
        `insert into match_questions (match_id, position, prompt, choices, correct_choice, opens_at)
         values ($1, 1, 'Final question', array['Right', 'Wrong'], 0, now())`,
        [running.id],
      );
      for (const player of players) {
        const { match } = await snapshotFor(player);
        if (match?.phase !== "open") throw new Error("Expected an open question");
        expect(await submitAnswer(player, { matchId: running.id, question: 1, choice: 1, retryId: match.retryId }, Date.now()))
          .toEqual({ completed: player === players[1] });
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

      // Fewer places when the content says so; the tie at the new cutoff still shares a rank.
      Object.assign(content, { leaderboardSize: 3 });
      expect((await snapshotFor(viewerDevice)).leaderboard?.map(({ name, rank }) => [name, rank])).toEqual([
        ["Repeat", 1],
        ["Repeat", 1],
        ["Third", 3],
      ]);
    } finally {
      await db.query("delete from sessions where code = $1", [viewer.code]);
    }
  } finally {
    Object.assign(content, { leaderboardSize: 10 });
    await db.query("delete from sessions where id = $1", [device.sessionId]);
  }
});
