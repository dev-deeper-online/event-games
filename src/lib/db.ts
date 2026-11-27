import { DatabaseError, Pool, type PoolClient } from "pg";

// One pool per server instance, kept across dev reloads. It connects on first query.
const globals = globalThis as { pool?: Pool };

export const db = (globals.pool ??= new Pool({ connectionString: process.env.DATABASE_URL, max: 5 }).on(
  "error",
  (error) => console.error("Idle Postgres client failed", error),
));

export const isUniqueViolation = (error: unknown) => error instanceof DatabaseError && error.code === "23505";

/** Runs `work` in one transaction, committing when it returns and rolling back when it throws. */
export async function transaction<T>(work: (client: PoolClient) => Promise<T>) {
  const client = await db.connect();
  try {
    await client.query("begin");
    const result = await work(client);
    await client.query("commit");
    client.release();
    return result;
  } catch (error) {
    // Destroys the connection, which also rolls back, rather than trusting it for another request.
    client.release(true);
    throw error;
  }
}
