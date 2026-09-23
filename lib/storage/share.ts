import "@/lib/server-only";
import { randomBytes } from "node:crypto";
import { and, desc, eq, gt } from "drizzle-orm";
import { z } from "zod";
import { getDatabase } from "@/lib/db/client";
import { shares, SHARE_EXPIRY_DAYS, SHARE_MODES, type ShareMode } from "@/lib/db/schema";
import { FinalOutputSchema } from "@/lib/schemas/output";
import { StorageUnavailableError } from "@/lib/errors";
import { logger } from "@/lib/logger";

/** Default life of a link; the owner may pick 7, 30 or 90 days. */
const SHARE_TTL_SECONDS = 30 * 24 * 60 * 60;
const DAY_SECONDS = 24 * 60 * 60;

/**
 * What a share link shows (BUG-04): a copy of the output taken when it was
 * shared, with its own 30-day expiry. The share page renders only from this,
 * so the link outlives any later edit, which appears only after the owner
 * revokes and shares again.
 *
 * The rows live in Postgres now; the functions are the ones the routes
 * already call.
 */
const ShareSnapshotSchema = z.object({
  sessionId: z.string().uuid(),
  /** The sharing browser's owner id; null for sessions from before owner_id. */
  owner_id: z.string().uuid().nullable(),
  title: z.string().min(1).max(120),
  final_output: FinalOutputSchema,
  created_at: z.number().int(),
  /** "view" (read-only) or "approval" (blueprint step 13). */
  mode: z.enum(SHARE_MODES).default("view"),
  /** The version the client is being asked to approve. */
  version_id: z.string().uuid().nullable().default(null),
  version_number: z.number().int().positive().nullable().default(null),
  expires_at: z.number().int().nullable().default(null),
});
export type ShareSnapshot = z.infer<typeof ShareSnapshotSchema>;

const TOKEN_RE = /^[A-Za-z0-9_-]{32,64}$/;
export function isShareToken(token: string): boolean {
  return TOKEN_RE.test(token);
}

function newShareToken(): string {
  // 32 bytes → 43 char base64url string. URL-safe, opaque, collision-resistant.
  return randomBytes(32).toString("base64url");
}

type ShareRow = typeof shares.$inferSelect;

/** A row becomes a snapshot only if it still parses; otherwise it is gone. */
function toSnapshot(row: ShareRow): ShareSnapshot | null {
  const parsed = ShareSnapshotSchema.safeParse({
    sessionId: row.projectId,
    owner_id: row.anonOwnerId,
    title: row.title,
    final_output: row.finalOutput,
    created_at: row.createdAt.getTime(),
    mode: row.mode,
    version_id: row.versionId,
    version_number: row.versionNumber,
    expires_at: row.expiresAt.getTime(),
  });
  if (!parsed.success) {
    logger.warn("share.zod_failure", {
      token: row.token.slice(0, 8),
      issues: parsed.error.issues
        .slice(0, 3)
        .map((i) => `${i.path.join(".")}: ${i.message}`)
        .join("; "),
    });
    return null;
  }
  return parsed.data;
}

export async function resolveShareToken(token: string): Promise<ShareSnapshot | null> {
  if (!isShareToken(token)) return null;
  const db = getDatabase();
  try {
    const [row] = await db
      .select()
      .from(shares)
      .where(and(eq(shares.token, token), gt(shares.expiresAt, new Date())))
      .limit(1);
    return row ? toSnapshot(row) : null;
  } catch (err) {
    logger.warn("share.db_get_failure", {
      message: err instanceof Error ? err.message : "unknown",
    });
    return null;
  }
}

/** The session's current share link, if it has one that is still live. */
export async function findActiveShare(
  sessionId: string,
): Promise<{ token: string; snapshot: ShareSnapshot } | null> {
  const db = getDatabase();
  try {
    const [row] = await db
      .select()
      .from(shares)
      .where(
        and(
          eq(shares.projectId, sessionId),
          eq(shares.active, true),
          gt(shares.expiresAt, new Date()),
        ),
      )
      .orderBy(desc(shares.createdAt))
      .limit(1);
    if (!row) return null;
    const snapshot = toSnapshot(row);
    return snapshot ? { token: row.token, snapshot } : null;
  } catch (err) {
    logger.warn("share.db_get_failure", {
      message: err instanceof Error ? err.message : "unknown",
    });
    return null;
  }
}

export interface CreateShareInput extends Omit<
  ShareSnapshot,
  "created_at" | "expires_at" | "mode" | "version_id" | "version_number"
> {
  mode?: ShareMode;
  version_id?: string | null;
  version_number?: number | null;
  /** 7, 30 or 90; anything else falls back to the default 30. */
  expires_in_days?: number;
}

/** The link's life in seconds. Only the offered choices are honoured. */
function expirySeconds(days: number | undefined): number {
  if (days === undefined) return SHARE_TTL_SECONDS;
  const allowed = (SHARE_EXPIRY_DAYS as readonly number[]).includes(days);
  return allowed ? days * DAY_SECONDS : SHARE_TTL_SECONDS;
}

/** Every live link of a project, newest first — for share management. */
export async function listShares(
  sessionId: string,
): Promise<Array<{ token: string; snapshot: ShareSnapshot; active: boolean }>> {
  const rows = await getDatabase()
    .select()
    .from(shares)
    .where(and(eq(shares.projectId, sessionId), gt(shares.expiresAt, new Date())))
    .orderBy(desc(shares.createdAt));
  return rows.flatMap((row) => {
    const snapshot = toSnapshot(row);
    return snapshot ? [{ token: row.token, snapshot, active: row.active }] : [];
  });
}

/** Store a new snapshot under a fresh token and make it the active share. */
export async function createShareLink(
  input: CreateShareInput,
): Promise<{ token: string; snapshot: ShareSnapshot }> {
  const token = newShareToken();
  const createdAt = new Date();
  const ttlSeconds = expirySeconds(input.expires_in_days);
  const expiresAt = new Date(createdAt.getTime() + ttlSeconds * 1000);
  const snapshot = ShareSnapshotSchema.parse({
    ...input,
    mode: input.mode ?? "view",
    version_id: input.version_id ?? null,
    version_number: input.version_number ?? null,
    created_at: createdAt.getTime(),
    expires_at: expiresAt.getTime(),
  });
  const db = getDatabase();
  try {
    await db.transaction(async (tx) => {
      // Only the newest link is "the" link; older ones keep resolving until
      // they expire or are revoked, exactly as they did before.
      await tx
        .update(shares)
        .set({ active: false })
        .where(eq(shares.projectId, snapshot.sessionId));
      await tx.insert(shares).values({
        token,
        projectId: snapshot.sessionId,
        anonOwnerId: snapshot.owner_id,
        title: snapshot.title,
        finalOutput: snapshot.final_output,
        active: true,
        mode: snapshot.mode,
        versionId: snapshot.version_id,
        versionNumber: snapshot.version_number,
        createdAt,
        expiresAt,
      });
    });
  } catch (err) {
    logger.error("share.db_set_failure", {
      message: err instanceof Error ? err.message : "unknown",
    });
    throw new StorageUnavailableError();
  }
  return { token, snapshot };
}

/** Delete a share: its link 404s from now on and the next share gets a new token. */
export async function revokeShareLink(token: string, sessionId: string): Promise<void> {
  const db = getDatabase();
  try {
    await db
      .delete(shares)
      .where(and(eq(shares.token, token), eq(shares.projectId, sessionId)));
  } catch (err) {
    logger.error("share.db_del_failure", {
      message: err instanceof Error ? err.message : "unknown",
    });
    throw new StorageUnavailableError();
  }
}

/** Revoke every share of a project. Used by delete (step 4). */
export async function revokeAllShares(sessionId: string): Promise<void> {
  const db = getDatabase();
  await db.delete(shares).where(eq(shares.projectId, sessionId));
}
