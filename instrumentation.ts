/**
 * Runs once when a Next.js server instance starts, before it handles
 * requests. In production it validates the server environment, so a missing
 * required setting (for example Upstash, DATA-01, or DATABASE_URL) stops the
 * server at startup instead of surfacing later as data that disappears.
 *
 * In development, a missing DATABASE_URL is not fatal: the app starts on a
 * file-backed PGlite database instead, so `npm run dev` works before anyone
 * has created a Postgres. That fallback never runs in production, where the
 * environment check above has already refused to start without a real one.
 */
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;

  if (process.env.NODE_ENV === "production") {
    const { getServerEnv } = await import("@/lib/env");
    getServerEnv();
    return;
  }

  // Never inside the test runner: the suite hands in its own database
  // (tests/helpers/db.ts) and booting a second one would fight it for the
  // .pglite directory.
  if (process.env.VITEST) return;
  if (!process.env.DATABASE_URL) await startLocalDatabase();
}

/**
 * A Postgres in this process, with the project's migrations applied, kept in
 * .pglite/ so the data survives a restart. Its failure is logged, not thrown:
 * a developer editing the landing page should not be stopped by it.
 */
async function startLocalDatabase(): Promise<void> {
  const { logger } = await import("@/lib/logger");
  try {
    const [{ PGlite }, { drizzle }, { migrate }, { setDatabase }, { schema }] =
      await Promise.all([
        import("@electric-sql/pglite"),
        import("drizzle-orm/pglite"),
        import("drizzle-orm/pglite/migrator"),
        import("@/lib/db/client"),
        import("@/lib/db/schema"),
      ]);

    const client = new PGlite(".pglite");
    const db = drizzle(client, { schema });
    await migrate(db, { migrationsFolder: "./drizzle" });
    setDatabase(db as never);
    logger.info("db.local_fallback", { path: ".pglite" });
  } catch (err) {
    logger.warn("db.local_fallback_failed", {
      message: err instanceof Error ? err.message : "unknown",
    });
  }
}
