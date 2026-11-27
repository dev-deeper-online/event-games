import { createHash, randomBytes, randomInt } from "node:crypto";
import type { PoolClient } from "pg";
import { presentDeviceIds } from "./ably";
import { abandonMs as budgetAbandonMs, budgetRoundFor, countdownMs as budgetCountdownMs, startBudgetRound } from "./budget";
import { db, isUniqueViolation, lockSession, transaction } from "./db";
import { isPlayer, isQuizDisplay, playerSlots, type GameType, type PlayerRole, type Role, type Snapshot } from "./protocol";
import { eventLeaderboard } from "./leaderboard";
import { abandonMs as quizAbandonMs, matchRefreshInMs, quizFor, refreshMatchConnection, startMatchWith } from "./quiz";
import type { Refusal } from "./refusal";

// No 0, O, 1 or I: guests read these codes aloud and staff type them.
const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

const newCode = () => Array.from({ length: 6 }, () => alphabet[randomInt(alphabet.length)]).join("");

const hash = (token: string) => createHash("sha256").update(token).digest("hex");

/** The creating device becomes the session's display. */
export async function createSession(gameType: GameType) {
  const token = randomBytes(32).toString("hex");
  for (let attempt = 0; attempt < 5; attempt++) {
    const code = newCode();
    const { rowCount } = await db.query(
      `with session as (
         insert into sessions (code, game_type) values ($1, $2) on conflict (code) do nothing returning id
       )
       insert into devices (session_id, role, token_hash) select id, 'display', $3 from session`,
      [code, gameType, hash(token)],
    );
    if (rowCount) return { code, token };
  }
  throw new Error("Could not find a free join code");
}

type Seat = { id: string; role: Role; name: string | null; token_hash: string; ready_at: Date | null; seated_at: Date | null };

const full: Refusal = { error: "This station is full. Wait for the next round.", status: 409 };

/** Frees a seat nobody is using: not Ready, seated longer than the abandon period ago, and not connected. */
async function reclaimAbandoned(client: PoolClient, code: string, seats: Seat[], abandonMs: number, now: number) {
  const stale = seats.filter(
    (seat) => isPlayer(seat.role) && !seat.ready_at && (!seat.seated_at || seat.seated_at.getTime() <= now - abandonMs),
  );
  if (!stale.length) return undefined;
  // A network call under the session lock, but only when the station is full and a seat has sat idle.
  // An unverified presence read counts as present, so a seat is never taken from a phone that may be live.
  const present = await presentDeviceIds(code).catch(() => null);
  if (!present) return undefined;
  const abandoned = stale.find((seat) => !present.has(seat.id));
  if (!abandoned) return undefined;
  await client.query("update devices set role = 'guest' where id = $1", [abandoned.id]);
  return abandoned.role as PlayerRole;
}

/**
 * Seats the device holding `token` in a free player slot. The device chooses the token, so it can repeat a
 * join whose reply was lost and get the same seat back, and a guest can use it to play again.
 */
export async function joinSession(code: string, name: string, token: string, now = Date.now()): Promise<Refusal | null> {
  try {
    return await transaction(async (client): Promise<Refusal | null> => {
      const { rows: [session] } = await client.query<{ id: string; game_type: GameType }>(
        "select id, game_type from sessions where code = $1 for update",
        [code],
      );
      if (!session) return { error: "No session uses that code.", status: 404 };
      const { rows: seats } = await client.query<Seat>(
        "select id, role, name, token_hash, ready_at, seated_at from devices where session_id = $1",
        [session.id],
      );
      const mine = seats.find((seat) => seat.token_hash === hash(token));
      if (mine?.role === "display") return { error: "The display cannot take a seat.", status: 409 };
      if (mine && isPlayer(mine.role)) {
        await client.query("update devices set name = $2 where id = $1", [mine.id, name]);
        return null;
      }

      const taken = new Set(seats.map((seat) => seat.role));
      const slot = playerSlots[session.game_type].find((candidate) => !taken.has(candidate))
        ?? await reclaimAbandoned(client, code, seats, session.game_type === "quiz" ? quizAbandonMs() : budgetAbandonMs(), now);
      if (!slot) return full;

      const seatedAt = new Date(now);
      if (mine) {
        await client.query(
          "update devices set role = $2, name = $3, ready_at = null, seated_at = $4 where id = $1",
          [mine.id, slot, name, seatedAt],
        );
      } else {
        await client.query(
          "insert into devices (session_id, role, token_hash, name, seated_at) values ($1, $2, $3, $4, $5)",
          [session.id, slot, hash(token), name, seatedAt],
        );
      }
      return null;
    });
  } catch (error) {
    // The slot index and the unique token are backstops: the session lock should have made this impossible.
    if (!isUniqueViolation(error)) throw error;
    return { error: "Could not take a seat. Try again.", status: 409 };
  }
}

/**
 * Marks the player Ready. The tap that completes the set starts the round in the same transaction, so taps
 * take turns and the last one always sees every other. Pressing Ready proves the phone is live; a phone that
 * vanishes later is stopped by the disconnect grace period.
 */
export async function markReady({ sessionId, deviceId, gameType }: Device, now: number): Promise<Refusal | null> {
  try {
    return await transaction(async (client): Promise<Refusal | null> => {
      await lockSession(client, sessionId);
      const { rows: seats } = await client.query<Seat>(
        "select id, role, name, token_hash, ready_at, seated_at from devices where session_id = $1",
        [sessionId],
      );
      const me = seats.find((seat) => seat.id === deviceId);
      if (!me || !isPlayer(me.role)) return { error: "Take a seat before you press Ready.", status: 409 };
      if (me.ready_at) return null;
      await client.query("update devices set ready_at = $2 where id = $1", [deviceId, new Date(now)]);
      me.ready_at = new Date(now);

      const players = playerSlots[gameType].map((slot) => seats.find((seat) => seat.role === slot));
      if (!players.every((player) => player?.ready_at)) return null;
      if (gameType === "budget") {
        const [player] = players;
        await startBudgetRound(client, sessionId, player!.id, player!.name!, new Date(now + budgetCountdownMs()));
      } else {
        const [player1, player2] = players.map((player) => ({ id: player!.id, name: player!.name! }));
        await startMatchWith(client, sessionId, { player1, player2 }, now);
      }
      return null;
    });
  } catch (error) {
    // Here only the one-running-round indexes can be violated.
    if (!isUniqueViolation(error)) throw error;
    return { error: "A round is already running.", status: 409 };
  }
}

export type Device = { sessionId: string; deviceId: string; role: Role; code: string; gameType: GameType };

/** The device that sent this request, or null when its bearer token is missing or unknown. */
export async function authenticate(request: Request): Promise<Device | null> {
  const token = request.headers.get("authorization")?.match(/^Bearer (.+)$/)?.[1];
  if (!token) return null;
  const { rows } = await db.query<Device>(
    `select s.id as "sessionId", d.id as "deviceId", d.role, s.code, s.game_type as "gameType"
     from devices d join sessions s on s.id = d.session_id
     where d.token_hash = $1`,
    [hash(token)],
  );
  return rows[0] ?? null;
}

const devicesOf = async (sessionId: string) =>
  (
    await db.query<{ id: string; role: Role; name: string | null; ready_at: Date | null }>(
      "select id, role, name, ready_at from devices where session_id = $1",
      [sessionId],
    )
  ).rows;

export async function snapshotFor(
  { sessionId, deviceId, role, code, gameType }: Device,
  now = Date.now(),
): Promise<Snapshot> {
  const [devices, { match, stopNotice }, budgetRound] = await Promise.all([
    devicesOf(sessionId),
    gameType === "quiz" ? quizFor(sessionId, role, deviceId, now) : { match: null, stopNotice: null },
    gameType === "budget"
      ? budgetRoundFor(sessionId, role === "display" ? null : deviceId, isPlayer(role), now)
      : null,
  ]);
  const showLeaderboard = match?.phase === "complete" || (!match && isQuizDisplay({ gameType, role }));
  const leaderboard = showLeaderboard ? await eventLeaderboard() : undefined;
  const seats: Role[] = ["display", ...playerSlots[gameType]];
  const me = devices.find((device) => device.id === deviceId);
  return {
    code,
    gameType,
    role,
    match,
    stopNotice,
    refreshInMs: match && match.phase !== "complete" ? matchRefreshInMs() : null,
    leaderboard,
    budgetRound,
    me: { name: me?.name ?? null, ready: !!me?.ready_at },
    seats: seats.map((seat) => {
      const holders = devices.filter((device) => device.role === seat);
      return {
        role: seat,
        deviceIds: holders.map((device) => device.id),
        name: holders[0]?.name ?? null,
        ready: holders.some((device) => device.ready_at),
      };
    }),
  };
}

export async function liveSnapshotFor(device: Device, now = Date.now(), { checkIn = true } = {}) {
  const player = checkIn && isPlayer(device.role) ? device.role : undefined;
  const stopped = device.gameType === "quiz" && await refreshMatchConnection(device.sessionId, now, player);
  return { snapshot: await snapshotFor(device, now), stopped };
}
