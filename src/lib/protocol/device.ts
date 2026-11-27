/** A device token the joining browser makes up itself: 32 random bytes as hex. */
export const deviceTokenPattern = /^[0-9a-f]{64}$/;

export const normalizeCode = (code: string) => code.replace(/\s/g, "").toUpperCase();

/** The role in a station URL. A player's URL does not name its slot: the server assigns that. */
export type StationRole = "display" | "player";

export const isStationRole = (value: string): value is StationRole => value === "display" || value === "player";

/** Where a browser keeps its device token, so a reload keeps its seat. */
export const tokenKey = (code: string, role: StationRole) => `device:${code}:${role}`;
