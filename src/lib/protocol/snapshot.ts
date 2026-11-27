import type { BudgetRound } from "../budget-state";
import type { GameType, PlayerRole, Role } from "./roles";

export type LeaderboardEntry = { id: string; name: string; score: number; rank: number };

/** The full state a device receives when it joins and whenever it reconnects. */
export type Snapshot = {
  code: string;
  gameType: GameType;
  role: Role;
  budgetRound: BudgetRound | null;
  seats: { role: Role; deviceIds: string[]; name: string | null; ready: boolean }[];
  /** This device's own registration. A guest uses the name to play again. */
  me: { name: string | null; ready: boolean };
  /** The quiz station's running or last finished match. */
  match: Match | null;
  stopNotice: { reason: StopReason; remainingMs: number } | null;
  refreshInMs: number | null;
  /** Present on completed matches and on idle quiz displays. */
  leaderboard?: LeaderboardEntry[];
};

export type StopReason = "display" | "disconnect";

/** Who took a closed question. The correct choice is deliberately never part of it. */
export type QuestionResult = { scorer: PlayerRole | null; points: number };

/** What happened to one answer. Never says which choice was picked or which was right. */
export type Outcome = { id: string; player: PlayerRole; kind: "wrong" | "scored"; points?: number };

export type Match = {
  id: string;
  players: Record<PlayerRole, { name: string; score: number }>;
  questionCount: number;
} & (
  /** All players are Ready. `startsInMs` is how long until the first question opens. */
  | { phase: "countdown"; startsInMs: number }
  | ({
      question: { number: number; prompt: string; choices: string[] };
      /** Every answer to the shown question in the order it arrived, so a skipped snapshot loses nothing. */
      outcomes: Outcome[];
    } & (
      | { phase: "open"; canAnswer: boolean; retryId?: string }
      /** `nextInMs` is how long until the next question opens; devices fetch a snapshot then. */
      | { phase: "closed"; result: QuestionResult; nextInMs: number }
      | { phase: "complete"; result: QuestionResult }
    ))
);

/** A match whose first question has opened. */
export type ShownMatch = Exclude<Match, { phase: "countdown" }>;
