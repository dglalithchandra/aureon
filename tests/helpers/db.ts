import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { sql } from "drizzle-orm";
import { fileURLToPath } from "node:url";
import { setDatabase, type Database } from "@/lib/db/client";
import { schema } from "@/lib/db/schema";

/**
 * A real Postgres for the tests, in this process.
 *
 * PGlite is Postgres compiled to WebAssembly, so the suite runs the actual
 * migrations and the actual SQL — no Docker, no network (tests/setup.ts
 * blocks it), and nothing mocked. One instance per worker, reused across the
 * files it runs, with `truncateAll()` between tests that need a clean slate.
 */

const MIGRATIONS = fileURLToPath(new URL("../../drizzle", import.meta.url));

let ready: Promise<Database> | null = null;
let client: PGlite | null = null;

/** Start (or reuse) the in-process database and point the app at it. */
export async function startTestDatabase(): Promise<Database> {
  ready ??= (async () => {
    client = new PGlite();
    const db = drizzle(client, { schema }) as unknown as Database;
    await migrate(db as never, { migrationsFolder: MIGRATIONS });
    return db;
  })();
  const db = await ready;
  setDatabase(db);
  return db;
}

/** Every table the app writes, in an order that respects the foreign keys. */
const TABLES = [
  "audit_log",
  "llm_usage",
  "approvals",
  "versions",
  "shares",
  "rounds",
  "projects",
  "workspace_members",
  "workspaces",
  "verification_tokens",
  "auth_sessions",
  "accounts",
  "users",
] as const;

/** Empty every table, keeping the schema. Cheap: one statement. */
export async function truncateAll(): Promise<void> {
  const db = await startTestDatabase();
  await db.execute(sql.raw(`TRUNCATE ${TABLES.join(", ")} RESTART IDENTITY CASCADE`));
}

/** Close the database. Only a test file that started its own needs this. */
export async function closeTestDatabase(): Promise<void> {
  setDatabase(null);
  if (client) {
    await client.close();
    client = null;
  }
  ready = null;
}
