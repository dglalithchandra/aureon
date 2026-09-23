/**
 * A real Postgres for the integration tests: PGlite with this project's own
 * migrations applied, in-process. Only the integration project loads this
 * (see vitest.config.mts), so the unit tests stay instant.
 */
import { startTestDatabase } from "./helpers/db";

await startTestDatabase();
