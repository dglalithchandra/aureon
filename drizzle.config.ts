import { defineConfig } from "drizzle-kit";

/**
 * Migrations are generated from lib/db/schema.ts into drizzle/ and applied
 * with `npm run db:migrate`. The SQL is committed, so every environment gets
 * the same schema in the same order.
 */
export default defineConfig({
  schema: "./lib/db/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DATABASE_URL ?? "",
  },
  strict: true,
  verbose: true,
});
