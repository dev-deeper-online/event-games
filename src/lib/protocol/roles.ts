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

/** A guest is a player device whose round has ended. It keeps its token and its own last result. */
export type Role = "display" | PlayerRole | "guest";

export const roleLabels: Record<Role, string> = {
  display: "Display",
  player1: "Player 1",
  player2: "Player 2",
  guest: "Guest",
};

export const isQuizDisplay = ({ gameType, role }: { gameType: GameType; role: Role }) =>
  gameType === "quiz" && role === "display";

export const maxNameLength = 30;

/** The name as it is saved, or null when it is not one a player can have. */
export const parsePlayerName = (value: unknown) => {
  const name = typeof value === "string" ? value.trim() : "";
  return name && name.length <= maxNameLength ? name : null;
};
