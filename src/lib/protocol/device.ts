import type { Role } from "./roles";

/** A device token the joining browser makes up itself: 32 random bytes as hex. */
export const deviceTokenPattern = /^[0-9a-f]{64}$/;

export const normalizeCode = (code: string) => code.replace(/\s/g, "").toUpperCase();

/** Where a browser keeps its device token, so a reload keeps its seat. */
export const tokenKey = (code: string, role: Role) => `device:${code}:${role}`;
