import type { BudgetRound } from "./budget-state";

/** What the browser and the server both need to agree on. */

export const gameTypes = ["quiz", "budget"] as const;
export type GameType = (typeof gameTypes)[number];

export type PlayerRole = "player1" | "player2";

export const playerSlots: Record<GameType, readonly PlayerRole[]> = {
  quiz: ["player1", "player2"],
  budget: ["player1"],
};

export const isPlayer = (role: Role): role is PlayerRole => role === "player1" || role === "player2";

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
  budgetRound: BudgetRound | null;
  seats: { role: Role; deviceIds: string[] }[];
  /** The quiz station's running or last finished match. */
  match: Match | null;
};

export const maxNameLength = 30;

/** Who took a closed question. The correct choice is deliberately never part of it. */
export type QuestionResult = { scorer: PlayerRole | null; points: number };

export type Match = {
  id: string;
  players: Record<PlayerRole, { name: string; score: number }>;
  questionCount: number;
  question: { number: number; prompt: string; choices: string[] };
} & (
  | { phase: "open"; canAnswer: boolean }
  /** `nextInMs` is how long until the next question opens; devices fetch a snapshot then. */
  | { phase: "closed"; result: QuestionResult; nextInMs: number }
  | { phase: "complete"; result: QuestionResult }
);

/** A device token the joining browser makes up itself: 32 random bytes as hex. */
export const deviceTokenPattern = /^[0-9a-f]{64}$/;

export const normalizeCode = (code: string) => code.replace(/\s/g, "").toUpperCase();

export const channelName = (code: string) => `session:${code}`;

/** Where a browser keeps its device token, so a reload keeps its seat. */
export const tokenKey = (code: string, role: string) => `device:${code}:${role}`;
