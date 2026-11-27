import { createHash, randomBytes, randomInt } from "node:crypto";
import { budgetRoundFor } from "./budget";
import { db, isUniqueViolation } from "./db";
import { isPlayer, isQuizDisplay, playerSlots, roleLabels, type GameType, type JoinableRole, type Role } from "./protocol/roles";
import type { Snapshot } from "./protocol/snapshot";
import { eventLeaderboard } from "./leaderboard";
import { matchRefreshInMs, quizFor, refreshMatchConnection } from "./quiz";
import type { Refusal } from "./refusal";

// No 0, O, 1 or I: operators read these codes aloud and guests type them.
const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

const newCode = () => Array.from({ length: 6 }, () => alphabet[randomInt(alphabet.length)]).join("");

const hash = (token: string) => createHash("sha256").update(token).digest("hex");

export async function createSession(gameType: GameType) {
  const token = randomBytes(32).toString("hex");
  for (let attempt = 0; attempt < 5; attempt++) {
    const code = newCode();
    const { rowCount } = await db.query(
      `with session as (
         insert into sessions (code, game_type) values ($1, $2) on conflict (code) do nothing returning id
       )
       insert into devices (session_id, role, token_hash) select id, 'operator', $3 from session`,
      [code, gameType, hash(token)],
    );
    if (rowCount) return { code, token };
  }
  throw new Error("Could not find a free join code");
}

/**
 * Seats the device holding `token`. The device chooses the token, so it can repeat a join whose reply
 * was lost and get the same seat back instead of finding it taken.
 */
export async function joinSession(
  code: string,
  role: JoinableRole,
  token: string,
): Promise<Refusal | null> {
  const {
    rows: [session],
  } = await db.query<{ id: string; game_type: GameType }>("select id, game_type from sessions where code = $1", [code]);
  if (!session) return { error: "No session uses that code.", status: 404 };
  if (role !== "display" && !playerSlots[session.game_type].includes(role)) {
    return { error: `This game has no ${roleLabels[role]}.`, status: 409 };
  }

  const seatParams = [session.id, role, hash(token)];
  try {
    await db.query("insert into devices (session_id, role, token_hash) values ($1, $2, $3)", seatParams);
  } catch (error) {
    if (!isUniqueViolation(error)) throw error;
    const { rowCount } = await db.query(
      "select 1 from devices where session_id = $1 and role = $2 and token_hash = $3",
      seatParams,
    );
    if (!rowCount) return { error: `${roleLabels[role]} is already taken.`, status: 409 };
  }
  return null;
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
  (await db.query<{ id: string; role: Role }>("select id, role from devices where session_id = $1", [sessionId])).rows;

/** Every player seat of this session's game paired with the device in it, if one has joined. */
export async function playerDevices({ sessionId, gameType }: Device) {
  const devices = await devicesOf(sessionId);
  return playerSlots[gameType].map((slot) => devices.find((device) => device.role === slot)?.id);
}

export async function snapshotFor(
  { sessionId, role, code, gameType }: Device,
  now = Date.now(),
): Promise<Snapshot> {
  const [devices, { match, stopNotice }, budgetRound] = await Promise.all([
    devicesOf(sessionId),
    gameType === "quiz" ? quizFor(sessionId, role, now) : { match: null, stopNotice: null },
    gameType === "budget" ? budgetRoundFor(sessionId, role === "player1") : null,
  ]);
  const showLeaderboard = match?.phase === "complete" || (!match && isQuizDisplay({ gameType, role }));
  const leaderboard = showLeaderboard ? await eventLeaderboard() : undefined;
  const seats: Role[] = ["operator", "display", ...playerSlots[gameType]];
  return {
    code,
    gameType,
    role,
    match,
    stopNotice,
    refreshInMs: match && match.phase !== "complete" ? matchRefreshInMs() : null,
    leaderboard,
    budgetRound,
    seats: seats.map((seat) => ({
      role: seat,
      deviceIds: devices.filter((device) => device.role === seat).map((device) => device.id),
    })),
  };
}

export async function liveSnapshotFor(device: Device, now = Date.now(), { checkIn = true } = {}) {
  const player = checkIn && isPlayer(device.role) ? device.role : undefined;
  const stopped = device.gameType === "quiz" && await refreshMatchConnection(device.sessionId, now, player);
  return { snapshot: await snapshotFor(device, now), stopped };
}
