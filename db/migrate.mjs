// shortcut: re-applies an idempotent schema, switch to versioned migrations at the first change to an existing table.
import { existsSync, readFileSync } from "node:fs";
import pg from "pg";

if (existsSync(".env.local")) process.loadEnvFile(".env.local");
if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is not set");

const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
await client.connect();
try {
  await client.query(readFileSync(new URL("schema.sql", import.meta.url), "utf8"));
  console.log("Database schema is up to date.");
} finally {
  await client.end();
}
