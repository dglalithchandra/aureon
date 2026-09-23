import "@/lib/server-only";
import { drizzle as drizzlePostgres } from "drizzle-orm/postgres-js";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import postgres from "postgres";
import { getServerEnv } from "@/lib/env";
import { logger } from "@/lib/logger";
import { schema } from "@/lib/db/schema";

/**
 * The database handle.
 *
 * postgres.js rather than a provider's own driver, so the same code runs on
 * Neon (the default) and on any other Postgres — a pooled connection string
 * is all it needs. Tests hand in a PGlite-backed handle instead, which is a
 * real Postgres in-process: no Docker, no network, nothing to mock.
 */

export type Database = PgDatabase<PgQueryResultHKT, typeof schema>;

let db: Database | null = null;
let client: ReturnType<typeof postgres> | null = null;

/**
 * Point every caller at a different database. Tests use it to inject PGlite;
 * nothing in the app calls it.
 */
export function setDatabase(next: Database | null): void {
  db = next;
}

export function getDatabase(): Database {
  if (db) return db;
  const url = getServerEnv().DATABASE_URL;
  if (!url) {
    throw new Error(
      "DATABASE_URL is not set. Create a Postgres database (Neon: https://neon.com) and put its pooled connection string in .env.local, then run `npm run db:migrate`.",
    );
  }
  // One pool per process. Serverless keeps instances warm long enough for a
  // small pool to pay for itself, and Fluid compute reuses them further.
  client = postgres(url, {
    max: 5,
    idle_timeout: 20,
    connect_timeout: 10,
    // Neon's pooled endpoint terminates idle connections; let postgres.js
    // reconnect quietly rather than surfacing the disconnect as an error.
    onnotice: () => undefined,
  });
  db = drizzlePostgres(client, { schema }) as unknown as Database;
  logger.info("db.connected", { pool: 5 });
  return db;
}

/** Close the pool. Used by scripts and tests, never by a request. */
export async function closeDatabase(): Promise<void> {
  if (client) {
    await client.end({ timeout: 5 });
    client = null;
  }
  db = null;
}
