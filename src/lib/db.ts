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

/**
 * Every seat change (join, reseat, Ready, start, release) takes this row lock first, so they run one
 * after another per session and never race inside one transaction.
 */
export const lockSession = (client: PoolClient, sessionId: string) =>
  client.query("select 1 from sessions where id = $1 for update", [sessionId]);

/** A round has ended: its players become guests and the slots are free for the next ones. */
export const releaseSeats = (client: PoolClient, sessionId: string) =>
  client.query(
    "update devices set role = 'guest', ready_at = null where session_id = $1 and role in ('player1', 'player2')",
    [sessionId],
  );
