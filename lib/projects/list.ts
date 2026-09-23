import "@/lib/server-only";
import { randomUUID } from "node:crypto";
import { and, desc, eq, ilike, inArray, isNull, or, type SQL } from "drizzle-orm";
import { getDatabase } from "@/lib/db/client";
import {
  auditLog,
  projects,
  rounds as roundsTable,
  workspaceMembers,
} from "@/lib/db/schema";
import { deriveTitle } from "@/lib/storage/session";
import type { Viewer } from "@/lib/auth/viewer";
import { logger } from "@/lib/logger";

/**
 * The /projects page's data: what this viewer may see, and what they may do
 * with it. Every query is filtered by the same rule as lib/auth/access.ts —
 * their own projects, plus anything in a workspace they belong to, plus
 * (while signed out) whatever their browser made.
 */

export interface ProjectSummary {
  id: string;
  title: string;
  status: string;
  confidence: number;
  hasOutput: boolean;
  workspaceId: string | null;
  updatedAt: number;
  createdAt: number;
  /** True once the retention job has removed the client's original text. */
  rawInputDeleted: boolean;
}

/** The workspaces this user belongs to, in any role. */
async function workspaceIdsFor(userId: string): Promise<string[]> {
  const rows = await getDatabase()
    .select({ id: workspaceMembers.workspaceId })
    .from(workspaceMembers)
    .where(eq(workspaceMembers.userId, userId));
  return rows.map((row) => row.id);
}

/** Everything this viewer is allowed to see, as one SQL condition. */
export async function visibleTo(viewer: Viewer): Promise<SQL | undefined> {
  const clauses: SQL[] = [];
  if (viewer.userId) {
    clauses.push(eq(projects.userId, viewer.userId));
    const workspaceIds = await workspaceIdsFor(viewer.userId);
    if (workspaceIds.length > 0) {
      clauses.push(inArray(projects.workspaceId, workspaceIds));
    }
  }
  if (viewer.anonId) {
    // An anonymous project answers to the browser that made it, until an
    // account claims it.
    clauses.push(and(eq(projects.anonOwnerId, viewer.anonId), isNull(projects.userId))!);
  }
  if (clauses.length === 0) return undefined;
  return clauses.length === 1 ? clauses[0] : or(...clauses);
}

export interface ListOptions {
  /** Matches the title or the client's own words, case-insensitively. */
  query?: string;
  limit?: number;
  offset?: number;
}

export async function listProjects(
  viewer: Viewer,
  options: ListOptions = {},
): Promise<ProjectSummary[]> {
  const visible = await visibleTo(viewer);
  if (!visible) return [];

  const query = options.query?.trim();
  const where = query
    ? and(
        visible,
        or(ilike(projects.title, `%${query}%`), ilike(projects.rawInput, `%${query}%`)),
      )
    : visible;

  const rows = await getDatabase()
    .select({
      id: projects.id,
      title: projects.title,
      status: projects.status,
      confidence: projects.confidence,
      finalOutput: projects.finalOutput,
      workspaceId: projects.workspaceId,
      updatedAt: projects.updatedAt,
      createdAt: projects.createdAt,
      rawInputDeletedAt: projects.rawInputDeletedAt,
    })
    .from(projects)
    .where(where)
    .orderBy(desc(projects.updatedAt))
    .limit(Math.min(100, options.limit ?? 50))
    .offset(options.offset ?? 0);

  return rows.map((row) => ({
    id: row.id,
    title: row.title,
    status: row.status,
    confidence: row.confidence,
    hasOutput: row.finalOutput !== null,
    workspaceId: row.workspaceId,
    updatedAt: row.updatedAt.getTime(),
    createdAt: row.createdAt.getTime(),
    rawInputDeleted: row.rawInputDeletedAt !== null,
  }));
}

/**
 * Copy a project and its rounds under a new id. The copy starts life
 * unshared and unapproved: a share link points at what was shared, and an
 * approval was given for a particular document.
 */
export async function duplicateProject(
  id: string,
  viewer: Viewer,
): Promise<string | null> {
  const db = getDatabase();
  const [source] = await db.select().from(projects).where(eq(projects.id, id)).limit(1);
  if (!source) return null;

  const copyId = randomUUID();
  const now = new Date();
  await db.transaction(async (tx) => {
    await tx.insert(projects).values({
      ...source,
      id: copyId,
      title: `Copy of ${source.title}`.slice(0, 200),
      // The copy belongs to whoever made it.
      userId: viewer.userId ?? null,
      anonOwnerId: viewer.userId ? null : viewer.anonId,
      workspaceId: source.workspaceId,
      createdAt: now,
      updatedAt: now,
    });
    const sourceRounds = await tx
      .select()
      .from(roundsTable)
      .where(eq(roundsTable.projectId, id));
    if (sourceRounds.length > 0) {
      await tx.insert(roundsTable).values(
        sourceRounds.map((round) => ({
          projectId: copyId,
          roundNumber: round.roundNumber,
          extraction: round.extraction,
          githubEnrichment: round.githubEnrichment,
          questions: round.questions,
          answers: round.answers,
          addedDescription: round.addedDescription,
        })),
      );
    }
    await tx.insert(auditLog).values({
      action: "project.duplicated",
      actorUserId: viewer.userId,
      actorAnonId: viewer.anonId,
      subjectType: "project",
      subjectId: copyId,
      workspaceId: source.workspaceId,
      detail: { from: id },
    });
  });

  logger.info("project.duplicated", { from: id, to: copyId });
  return copyId;
}

/**
 * Hard delete. The row goes, and with it — by foreign key — its rounds,
 * shares, versions, approvals and usage rows. The audit entry is written
 * first, because it is the one thing that must survive.
 */
export async function deleteProject(id: string, viewer: Viewer): Promise<boolean> {
  const db = getDatabase();
  const [row] = await db
    .select({ id: projects.id, workspaceId: projects.workspaceId, title: projects.title })
    .from(projects)
    .where(eq(projects.id, id))
    .limit(1);
  if (!row) return false;

  await db.insert(auditLog).values({
    action: "project.deleted",
    actorUserId: viewer.userId,
    actorAnonId: viewer.anonId,
    subjectType: "project",
    subjectId: id,
    workspaceId: row.workspaceId,
    detail: { title: row.title },
  });
  await db.delete(projects).where(eq(projects.id, id));
  logger.info("project.deleted", { projectId: id });
  return true;
}

/** The stored title, or null when there is no such project. */
export async function projectTitle(id: string): Promise<string | null> {
  const [row] = await getDatabase()
    .select({ title: projects.title })
    .from(projects)
    .where(eq(projects.id, id))
    .limit(1);
  return row?.title ?? null;
}

/**
 * Rename a project. Returns the title as stored, which is the given one
 * tidied by `deriveTitle` (trimmed, collapsed, capped at 80 characters).
 */
export async function renameProject(id: string, title: string): Promise<string> {
  const clean = deriveTitle(title);
  await getDatabase()
    .update(projects)
    .set({ title: clean, updatedAt: new Date() })
    .where(eq(projects.id, id));
  return clean;
}
