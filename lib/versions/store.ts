import "@/lib/server-only";
import { and, asc, desc, eq, isNull } from "drizzle-orm";
import { getDatabase } from "@/lib/db/client";
import { auditLog, versions, type VersionReason } from "@/lib/db/schema";
import { FinalOutputSchema, type FinalOutput } from "@/lib/schemas/output";
import { logger } from "@/lib/logger";

/**
 * Version history (blueprint step 14).
 *
 * Every finalize and every saved edit writes one row here, and nothing ever
 * rewrites it — the database refuses an UPDATE that touches the content
 * (see the trigger in drizzle/0001). Approval may set the lock and the
 * label, which is why those columns are exempt.
 *
 * The stored document is re-validated by Zod on read, the same rule the rest
 * of the storage layer follows: a row written by an older schema is reported
 * as unreadable rather than handed to the diff.
 */

export interface VersionRecord {
  id: string;
  projectId: string;
  versionNumber: number;
  output: FinalOutput;
  reason: VersionReason;
  confidence: number;
  label: string | null;
  createdBy: string | null;
  createdAt: number;
  lockedAt: number | null;
  approvedBy: string | null;
}

/** A version without its document, for lists. */
export type VersionSummary = Omit<VersionRecord, "output">;

const LABEL_DATE = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "long",
  year: "numeric",
  timeZone: "UTC",
});

/** "Approved v3 — 23 September 2026". */
export function approvedLabel(versionNumber: number, at: Date): string {
  return `Approved v${versionNumber} — ${LABEL_DATE.format(at)}`;
}

type Row = typeof versions.$inferSelect;

function toSummary(row: Row): VersionSummary {
  return {
    id: row.id,
    projectId: row.projectId,
    versionNumber: row.versionNumber,
    reason: (row.reason as VersionReason) ?? "generated",
    confidence: row.confidence,
    label: row.label,
    createdBy: row.createdBy,
    createdAt: row.createdAt.getTime(),
    lockedAt: row.lockedAt?.getTime() ?? null,
    approvedBy: row.approvedBy,
  };
}

function toRecord(row: Row): VersionRecord | null {
  const parsed = FinalOutputSchema.safeParse(row.output);
  if (!parsed.success) {
    logger.warn("version.zod_failure", {
      versionId: row.id,
      issues: parsed.error.issues
        .slice(0, 3)
        .map((i) => `${i.path.join(".")}: ${i.message}`)
        .join("; "),
    });
    return null;
  }
  return { ...toSummary(row), output: parsed.data };
}

/**
 * JSON with every object key in order, so "did this document change?" does
 * not depend on the order Postgres happened to return the JSONB in.
 */
function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`);
    return `{${entries.join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

export interface RecordVersionInput {
  projectId: string;
  output: FinalOutput;
  reason: VersionReason;
  confidence: number;
  createdBy?: string | null;
}

/**
 * Write the next version of a project, unless its document is identical to
 * the newest one — a re-save that changed nothing is not a version.
 * Returns the new version, or null when nothing was written.
 */
export async function recordVersion(
  input: RecordVersionInput,
): Promise<VersionSummary | null> {
  const db = getDatabase();
  const [latest] = await db
    .select()
    .from(versions)
    .where(eq(versions.projectId, input.projectId))
    .orderBy(desc(versions.versionNumber))
    .limit(1);

  if (latest && stableJson(latest.output) === stableJson(input.output)) {
    return null;
  }

  const [row] = await db
    .insert(versions)
    .values({
      projectId: input.projectId,
      versionNumber: (latest?.versionNumber ?? 0) + 1,
      output: input.output,
      reason: input.reason,
      confidence: input.confidence,
      createdBy: input.createdBy ?? null,
    })
    .returning();

  logger.info("version.recorded", {
    projectId: input.projectId,
    versionNumber: row!.versionNumber,
    reason: input.reason,
  });
  return toSummary(row!);
}

export async function listVersions(projectId: string): Promise<VersionSummary[]> {
  const rows = await getDatabase()
    .select()
    .from(versions)
    .where(eq(versions.projectId, projectId))
    .orderBy(asc(versions.versionNumber));
  return rows.map(toSummary);
}

export async function getVersion(
  projectId: string,
  versionNumber: number,
): Promise<VersionRecord | null> {
  const [row] = await getDatabase()
    .select()
    .from(versions)
    .where(
      and(eq(versions.projectId, projectId), eq(versions.versionNumber, versionNumber)),
    )
    .limit(1);
  return row ? toRecord(row) : null;
}

export async function getVersionById(id: string): Promise<VersionRecord | null> {
  const [row] = await getDatabase()
    .select()
    .from(versions)
    .where(eq(versions.id, id))
    .limit(1);
  return row ? toRecord(row) : null;
}

/** The newest version of a project, if it has any. */
export async function latestVersion(projectId: string): Promise<VersionSummary | null> {
  const [row] = await getDatabase()
    .select()
    .from(versions)
    .where(eq(versions.projectId, projectId))
    .orderBy(desc(versions.versionNumber))
    .limit(1);
  return row ? toSummary(row) : null;
}

/**
 * Lock a version because a client approved it. Locking is one-way and
 * idempotent: a second approval of the same version keeps the first lock,
 * so the label always names who approved it first.
 */
export async function lockVersion(
  versionId: string,
  approverName: string,
  at: Date = new Date(),
): Promise<VersionSummary | null> {
  const db = getDatabase();
  const [current] = await db
    .select()
    .from(versions)
    .where(eq(versions.id, versionId))
    .limit(1);
  if (!current) return null;
  if (current.lockedAt) return toSummary(current);

  const [row] = await db
    .update(versions)
    .set({
      lockedAt: at,
      approvedBy: approverName.slice(0, 120),
      label: approvedLabel(current.versionNumber, at),
    })
    .where(and(eq(versions.id, versionId), isNull(versions.lockedAt)))
    .returning();
  // Another approval won the race; its lock stands.
  if (!row) return toSummary(current);

  await db.insert(auditLog).values({
    action: "version.locked",
    subjectType: "version",
    subjectId: versionId,
    detail: { versionNumber: row.versionNumber, approver: approverName.slice(0, 120) },
  });
  logger.info("version.locked", { versionId, versionNumber: row.versionNumber });
  return toSummary(row);
}
