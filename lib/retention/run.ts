import "@/lib/server-only";
import { and, eq, isNotNull, isNull, lt, or, sql } from "drizzle-orm";
import { getDatabase } from "@/lib/db/client";
import {
  auditLog,
  DEFAULT_RAW_INPUT_RETENTION_DAYS,
  projects,
  workspaces,
} from "@/lib/db/schema";
import { logger } from "@/lib/logger";

/**
 * Retention: the client's own words do not live here forever.
 *
 * After a workspace's retention period with no activity on a project, its
 * raw input and the enriched copy of it are blanked. The documents that were
 * produced from it — the client view, the engineer view, the extraction and
 * its evidence — are kept, because those are the deliverable and the reason
 * the project exists.
 *
 * The clock runs from the last update, not from creation: a project someone
 * is still working on has not been abandoned. A workspace can set 0 to keep
 * raw input indefinitely.
 *
 * Runs daily from POST /api/cron/retention.
 */

export interface RetentionResult {
  scanned: number;
  cleared: number;
}

function cutoff(days: number): Date {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000);
}

/**
 * Blank the raw input of everything past its retention period.
 *
 * Two passes: one per workspace that has changed its setting, and one for
 * everything with no workspace (anonymous scopes and personal ones), which
 * uses the default.
 */
export async function runRetention(now = new Date()): Promise<RetentionResult> {
  const db = getDatabase();
  let scanned = 0;
  let cleared = 0;

  const rows = await db
    .select({ id: workspaces.id, days: workspaces.rawInputRetentionDays })
    .from(workspaces);

  const groups: Array<{ workspaceId: string | null; days: number }> = [
    ...rows.map((row) => ({ workspaceId: row.id, days: row.days })),
    { workspaceId: null, days: DEFAULT_RAW_INPUT_RETENTION_DAYS },
  ];

  for (const group of groups) {
    // 0 means "keep it": a workspace that has to keep its record.
    if (group.days <= 0) continue;
    const before = new Date(now.getTime() - group.days * 24 * 60 * 60 * 1000);

    const affected = await db
      .update(projects)
      .set({
        rawInput: "",
        enrichedInput: "",
        rawInputDeletedAt: now,
      })
      .where(
        and(
          group.workspaceId === null
            ? isNull(projects.workspaceId)
            : eq(projects.workspaceId, group.workspaceId),
          lt(projects.updatedAt, before),
          isNull(projects.rawInputDeletedAt),
          // An empty raw input has nothing to clear.
          sql`length(${projects.rawInput}) > 0`,
        ),
      )
      .returning({ id: projects.id, workspaceId: projects.workspaceId });

    scanned += affected.length;
    cleared += affected.length;

    if (affected.length > 0) {
      await db.insert(auditLog).values(
        affected.map((project) => ({
          action: "retention.raw_input_deleted",
          subjectType: "project",
          subjectId: project.id,
          workspaceId: project.workspaceId,
          detail: { retentionDays: group.days },
        })),
      );
    }
  }

  logger.info("retention.completed", { cleared, groups: groups.length });
  return { scanned, cleared };
}

/** What the next run would touch, without touching it. */
export async function retentionPreview(days: number): Promise<number> {
  const rows = await getDatabase()
    .select({ id: projects.id })
    .from(projects)
    .where(
      and(
        lt(projects.updatedAt, cutoff(days)),
        isNull(projects.rawInputDeletedAt),
        or(isNotNull(projects.rawInput), sql`length(${projects.rawInput}) > 0`),
      ),
    );
  return rows.length;
}
