import { Pool } from "pg";

// One pool per server instance, kept across dev reloads. It connects on first query.
const globals = globalThis as { pool?: Pool };

export const db = (globals.pool ??= new Pool({ connectionString: process.env.DATABASE_URL, max: 5 }).on(
  "error",
  (error) => console.error("Idle Postgres client failed", error),
));
