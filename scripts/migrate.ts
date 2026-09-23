/**
 * Apply every migration in drizzle/ to DATABASE_URL, then exit.
 *
 *   npm run db:migrate
 *
 * Safe to run repeatedly: drizzle records which migrations have run. Run it
 * after pulling a change that touches lib/db/schema.ts, and once against a
 * new database before the app starts.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";

function loadEnvFile(path: string): void {
  try {
    for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eq = trimmed.indexOf("=");
      if (eq < 0) continue;
      const key = trimmed.slice(0, eq).trim();
      let raw = trimmed.slice(eq + 1).trim();
      if (
        (raw.startsWith('"') && raw.endsWith('"')) ||
        (raw.startsWith("'") && raw.endsWith("'"))
      ) {
        raw = raw.slice(1, -1);
      }
      if (!process.env[key]) process.env[key] = raw;
    }
  } catch {
    /* no .env.local is fine when DATABASE_URL is already exported */
  }
}

loadEnvFile(join(process.cwd(), ".env.local"));

const url = process.env.DATABASE_URL;
if (!url) {
  console.error(
    "DATABASE_URL is not set. Put your Postgres connection string in .env.local first.",
  );
  process.exit(1);
}

async function main(): Promise<void> {
  // A single connection, no pool: migrations run once and exit.
  const client = postgres(url!, { max: 1 });
  try {
    await migrate(drizzle(client), { migrationsFolder: "./drizzle" });
    console.log("Migrations applied.");
  } finally {
    await client.end({ timeout: 5 });
  }
}

main().catch((err: unknown) => {
  console.error("FAILED:", err instanceof Error ? err.message : err);
  process.exit(1);
});
