import "@/lib/server-only";
import { and, asc, eq, inArray, notInArray } from "drizzle-orm";
import { getDatabase } from "@/lib/db/client";
import { projects, rounds as roundsTable } from "@/lib/db/schema";
import { acquireLock, releaseLock } from "@/lib/storage/lock";
import { SessionSchema, type Session } from "@/lib/schemas/mcq";
import { logger } from "@/lib/logger";
import { StorageUnavailableError } from "@/lib/errors";

/**
 * A scoping session, stored as a `projects` row plus its `rounds`.
 *
 * The function signatures are the ones the routes already call — the move
 * from Redis to Postgres is invisible above this file. What changed is that
 * a session no longer expires after 24 hours: it is a project now, and it
 * stays until someone deletes it or the retention job blanks its raw input.
 *
 * The Zod re-validation on read is kept from the Redis version: a row
 * written by an older schema is filtered out rather than trusted.
 */

type ProjectRow = typeof projects.$inferSelect;
type RoundRow = typeof roundsTable.$inferSelect;

/** A title for the projects list, derived once from the client's first words. */
export function deriveTitle(rawInput: string): string {
  const firstLine = rawInput
    .split(/[\n.!?]/)
    .map((line) => line.trim())
    .find((line) => line.length > 0);
  const text = (firstLine ?? rawInput).trim().replace(/\s+/g, " ");
  if (text.length === 0) return "Untitled scope";
  return text.length > 80 ? `${text.slice(0, 77)}…` : text;
}

function toSession(project: ProjectRow, rows: RoundRow[]): unknown {
  return {
    id: project.id,
    raw_input: project.rawInput,
    enriched_input: project.enrichedInput,
    rounds: rows.map((row) => ({
      round_number: row.roundNumber,
      extraction: row.extraction,
      github_enrichment: row.githubEnrichment,
      questions: row.questions,
      answers: row.answers,
      added_description: row.addedDescription,
    })),
    status: project.status,
    pipeline_stage: project.pipelineStage,
    current_confidence: project.confidence,
    final_output: project.finalOutput,
    draft_output: project.draftOutput,
    owner_id: project.anonOwnerId,
    last_error: project.lastError,
    created_at: project.createdAt.getTime(),
    updated_at: project.updatedAt.getTime(),
  };
}

export async function getSession(id: string): Promise<Session | null> {
  const db = getDatabase();
  let project: ProjectRow | undefined;
  let rows: RoundRow[];
  try {
    [project] = await db.select().from(projects).where(eq(projects.id, id)).limit(1);
    if (!project) return null;
    rows = await db
      .select()
      .from(roundsTable)
      .where(eq(roundsTable.projectId, id))
      .orderBy(asc(roundsTable.roundNumber));
  } catch (err) {
    logger.warn("session.db_get_failure", {
      sessionId: id,
      message: err instanceof Error ? err.message : "unknown",
    });
    return null;
  }

  const parsed = SessionSchema.safeParse(toSession(project, rows));
  if (!parsed.success) {
    logger.warn("session.zod_failure", {
      sessionId: id,
      issues: parsed.error.issues
        .slice(0, 3)
        .map((i) => `${i.path.join(".")}: ${i.message}`)
        .join("; "),
    });
    return null;
  }
  return parsed.data;
}

export async function putSession(session: Session): Promise<void> {
  const validated = SessionSchema.safeParse(session);
  if (!validated.success) {
    logger.error("session.put_invalid", {
      issues: validated.error.issues
        .slice(0, 3)
        .map((i) => `${i.path.join(".")}: ${i.message}`)
        .join("; "),
    });
    throw new Error("Refusing to store invalid session");
  }
  const value = validated.data;
  const db = getDatabase();

  try {
    await db.transaction(async (tx) => {
      const row = {
        id: value.id,
        title: deriveTitle(value.raw_input),
        rawInput: value.raw_input,
        enrichedInput: value.enriched_input,
        status: value.status,
        pipelineStage: value.pipeline_stage,
        confidence: value.current_confidence,
        finalOutput: value.final_output,
        draftOutput: value.draft_output,
        lastError: value.last_error,
        anonOwnerId: value.owner_id,
        createdAt: new Date(value.created_at),
        updatedAt: new Date(value.updated_at),
      };
      await tx
        .insert(projects)
        .values(row)
        .onConflictDoUpdate({
          target: projects.id,
          set: {
            // The title and the owner are set once, at creation: a later
            // write must not rename a project the user renamed, nor hand it
            // to a different browser.
            rawInput: row.rawInput,
            enrichedInput: row.enrichedInput,
            status: row.status,
            pipelineStage: row.pipelineStage,
            confidence: row.confidence,
            finalOutput: row.finalOutput,
            draftOutput: row.draftOutput,
            lastError: row.lastError,
            updatedAt: row.updatedAt,
          },
        });

      const numbers = value.rounds.map((r) => r.round_number);
      // A round can be rewritten (answers arrive) but never disappears
      // except when the whole list shrinks, which only a reset would do.
      if (numbers.length === 0) {
        await tx.delete(roundsTable).where(eq(roundsTable.projectId, value.id));
      } else {
        await tx
          .delete(roundsTable)
          .where(
            and(
              eq(roundsTable.projectId, value.id),
              notInArray(roundsTable.roundNumber, numbers),
            ),
          );
        for (const round of value.rounds) {
          await tx
            .insert(roundsTable)
            .values({
              projectId: value.id,
              roundNumber: round.round_number,
              extraction: round.extraction,
              githubEnrichment: round.github_enrichment,
              questions: round.questions,
              answers: round.answers,
              addedDescription: round.added_description,
            })
            .onConflictDoUpdate({
              target: [roundsTable.projectId, roundsTable.roundNumber],
              set: {
                extraction: round.extraction,
                githubEnrichment: round.github_enrichment,
                questions: round.questions,
                answers: round.answers,
                addedDescription: round.added_description,
              },
            });
        }
      }
    });
  } catch (err) {
    // Never report a write that did not happen as a success (DATA-01).
    logger.error("session.db_set_failure", {
      sessionId: value.id,
      message: err instanceof Error ? err.message : "unknown",
    });
    throw new StorageUnavailableError();
  }
}

/**
 * Hard delete: the project row and, by cascade, its rounds, shares, versions
 * and approvals. A revoked share's link stops resolving immediately.
 */
export async function deleteSession(id: string): Promise<void> {
  const db = getDatabase();
  try {
    await db.delete(projects).where(eq(projects.id, id));
  } catch (err) {
    logger.error("session.db_delete_failure", {
      sessionId: id,
      message: err instanceof Error ? err.message : "unknown",
    });
    throw new StorageUnavailableError();
  }
}

/** Delete several projects at once, for the /projects page. */
export async function deleteSessions(ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  const db = getDatabase();
  await db.delete(projects).where(inArray(projects.id, ids));
}

/**
 * Total byte cost of a session's user-supplied content. Used to enforce
 * the 50KB combined cap on raw_input + every answer's custom_text +
 * selected_options.
 */
export function userContentBytes(session: Session): number {
  let total = Buffer.byteLength(session.raw_input, "utf8");
  for (const r of session.rounds) {
    for (const a of r.answers) {
      if (a.custom_text) total += Buffer.byteLength(a.custom_text, "utf8");
      for (const opt of a.selected_options) {
        total += Buffer.byteLength(opt, "utf8");
      }
    }
  }
  return total;
}

const WRITE_LOCK_TTL_SECONDS = 10;
const WRITE_LOCK_WAIT_MS = 5_000;

/**
 * Read-modify-write a session under a short per-session write lock, so two
 * jobs updating the same session at once (the client and engineer finalize
 * jobs) cannot overwrite each other. Returns the stored result, or null if
 * the session no longer exists.
 */
export async function mutateSession(
  id: string,
  mutate: (current: Session) => Session,
): Promise<Session | null> {
  const key = `lock:session-write:${id}`;
  const deadline = Date.now() + WRITE_LOCK_WAIT_MS;
  let token = await acquireLock(key, WRITE_LOCK_TTL_SECONDS);
  while (!token) {
    if (Date.now() > deadline) {
      throw new Error(`Timed out waiting for the write lock on session ${id}`);
    }
    await new Promise((r) => setTimeout(r, 25));
    token = await acquireLock(key, WRITE_LOCK_TTL_SECONDS);
  }
  try {
    const current = await getSession(id);
    if (!current) return null;
    const next = mutate(current);
    await putSession(next);
    return next;
  } finally {
    await releaseLock(key, token).catch(() => undefined);
  }
}
