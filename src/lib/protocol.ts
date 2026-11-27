/** What the browser and the server both need to agree on. */

export const gameTypes = ["quiz", "budget"] as const;
export type GameType = (typeof gameTypes)[number];

export const playerSlots: Record<GameType, readonly ("player1" | "player2")[]> = {
  quiz: ["player1", "player2"],
  budget: ["player1"],
};

export const joinableRoles = ["display", "player1", "player2"] as const;
export type JoinableRole = (typeof joinableRoles)[number];
export type Role = "operator" | JoinableRole;

export const roleLabels: Record<Role, string> = {
  operator: "Operator",
  display: "Display",
  player1: "Player 1",
  player2: "Player 2",
};

export const gameLabels: Record<GameType, string> = { quiz: "Quiz", budget: "Budget" };

/** The full state a device receives when it joins and whenever it reconnects. */
export type Snapshot = {
  code: string;
  gameType: GameType;
  role: Role;
  seats: { role: Role; deviceIds: string[] }[];
};

/** A device token the joining browser makes up itself: 32 random bytes as hex. */
export const deviceTokenPattern = /^[0-9a-f]{64}$/;

export const normalizeCode = (code: string) => code.replace(/\s/g, "").toUpperCase();

export const channelName = (code: string) => `session:${code}`;

/** Where a browser keeps its device token, so a reload keeps its seat. */
export const tokenKey = (code: string, role: string) => `device:${code}:${role}`;
