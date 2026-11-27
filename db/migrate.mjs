import { existsSync, readFileSync } from "node:fs";
import pg from "pg";

if (existsSync(".env.local")) process.loadEnvFile(".env.local");
if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is not set");

const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
const migrations = ["schema.sql", "002_quiz_retry.sql"];

await client.connect();
try {
  await client.query("begin");
  await client.query("select pg_advisory_xact_lock(hashtext('event-games migrations'))");
  await client.query("create table if not exists schema_migrations (name text primary key)");
  const { rows } = await client.query("select name from schema_migrations");
  const applied = new Set(rows.map(({ name }) => name));
  for (const name of migrations) {
    if (applied.has(name)) continue;
    await client.query(readFileSync(new URL(name, import.meta.url), "utf8"));
    await client.query("insert into schema_migrations (name) values ($1)", [name]);
  }
  await client.query("commit");
  console.log("Database schema is up to date.");
} finally {
  await client.end();
}
