/** The games and the seats in them. Like all of protocol/, shared by the browser and the server. */

export const gameTypes = ["quiz", "budget"] as const;
export type GameType = (typeof gameTypes)[number];

export const gameLabels: Record<GameType, string> = { quiz: "Quiz", budget: "Budget" };

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

export const isRole = (value: string): value is Role => Object.hasOwn(roleLabels, value);

export const isQuizDisplay = ({ gameType, role }: { gameType: GameType; role: Role }) =>
  gameType === "quiz" && role === "display";

export const maxNameLength = 30;

/** The name as it is saved, or null when it is not one a player can have. */
export const playerName = (value: unknown) => {
  const name = typeof value === "string" ? value.trim() : "";
  return name && name.length <= maxNameLength ? name : null;
};
