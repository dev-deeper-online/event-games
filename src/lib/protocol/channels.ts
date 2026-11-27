import { isQuizDisplay, type GameType, type Role } from "./roles";

export const channelName = (code: string) => `session:${code}`;
export const leaderboardChannel = "event:quiz-leaderboard";
export const budgetResultsChannel = "budget:results";

/** The event-wide channel a device listens on besides its session's, if it has one. */
export const eventChannelFor = (device: { gameType: GameType; role: Role }) => {
  if (device.gameType === "budget") return budgetResultsChannel;
  return isQuizDisplay(device) ? leaderboardChannel : null;
};
