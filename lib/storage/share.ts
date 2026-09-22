import "@/lib/server-only";
import { randomBytes } from "node:crypto";
import { z } from "zod";
import { getRedis } from "@/lib/storage/redis";
import { FinalOutputSchema } from "@/lib/schemas/output";
import { StorageUnavailableError } from "@/lib/errors";
import { logger } from "@/lib/logger";

const SHARE_TTL_SECONDS = 30 * 24 * 60 * 60; // 30 days

/**
 * What a share link shows (BUG-04): a copy of the output taken when it was
 * shared, stored under the share key with its own 30-day TTL. The share page
 * renders only from this, so the link outlives the 24 h session, and later
 * edits appear only after the owner revokes and shares again.
 */
const ShareSnapshotSchema = z.object({
  sessionId: z.string().uuid(),
  /** The sharing browser's owner id; null for sessions from before owner_id. */
  owner_id: z.string().uuid().nullable(),
  title: z.string().min(1).max(120),
  final_output: FinalOutputSchema,
  created_at: z.number().int(),
});
export type ShareSnapshot = z.infer<typeof ShareSnapshotSchema>;

/** Points a session at its active share, so re-sharing returns the same link. */
const ActiveShareSchema = z.object({ token: z.string() });

interface MemoryEntry {
  value: unknown;
  expiresAt: number;
}

const memory: Map<string, MemoryEntry> = (() => {
  const g = globalThis as { __scopeai_share_snapshots?: Map<string, MemoryEntry> };
  if (!g.__scopeai_share_snapshots) {
    g.__scopeai_share_snapshots = new Map<string, MemoryEntry>();
  }
  return g.__scopeai_share_snapshots;
})();

function shareKey(token: string): string {
  return `scopeai:share:${token}`;
}

function activeShareKey(sessionId: string): string {
  return `scopeai:share-of:${sessionId}`;
}

const TOKEN_RE = /^[A-Za-z0-9_-]{32,64}$/;
export function isShareToken(token: string): boolean {
  return TOKEN_RE.test(token);
}

function newShareToken(): string {
  // 32 bytes → 43 char base64url string. URL-safe, opaque, collision-resistant.
  return randomBytes(32).toString("base64url");
}

/** Read a key; a failed Redis read is logged and treated as missing. */
async function read(key: string): Promise<unknown> {
  const r = getRedis();
  if (r) {
    try {
      return await r.get(key);
    } catch (err) {
      logger.warn("share.redis_get_failure", {
        message: err instanceof Error ? err.message : "unknown",
      });
      return null;
    }
  }
  const entry = memory.get(key);
  if (!entry) return null;
  if (entry.expiresAt < Date.now()) {
    memory.delete(key);
    return null;
  }
  return entry.value;
}

/** Write a key; a failed Redis write throws STORAGE_UNAVAILABLE (DATA-01). */
async function write(key: string, value: unknown): Promise<void> {
  const r = getRedis();
  if (!r) {
    memory.set(key, { value, expiresAt: Date.now() + SHARE_TTL_SECONDS * 1000 });
    return;
  }
  try {
    await r.set(key, value, { ex: SHARE_TTL_SECONDS });
  } catch (err) {
    logger.error("share.redis_set_failure", {
      message: err instanceof Error ? err.message : "unknown",
    });
    throw new StorageUnavailableError();
  }
}

async function remove(keys: string[]): Promise<void> {
  const r = getRedis();
  if (!r) {
    for (const k of keys) memory.delete(k);
    return;
  }
  try {
    await r.del(...keys);
  } catch (err) {
    logger.error("share.redis_del_failure", {
      message: err instanceof Error ? err.message : "unknown",
    });
    throw new StorageUnavailableError();
  }
}

export async function resolveShareToken(token: string): Promise<ShareSnapshot | null> {
  if (!isShareToken(token)) return null;
  const parsed = ShareSnapshotSchema.safeParse(await read(shareKey(token)));
  return parsed.success ? parsed.data : null;
}

/** The session's current share link, if it has one that is still live. */
export async function findActiveShare(
  sessionId: string,
): Promise<{ token: string; snapshot: ShareSnapshot } | null> {
  const active = ActiveShareSchema.safeParse(await read(activeShareKey(sessionId)));
  if (!active.success) return null;
  const snapshot = await resolveShareToken(active.data.token);
  if (!snapshot || snapshot.sessionId !== sessionId) return null;
  return { token: active.data.token, snapshot };
}

/** Store a new snapshot under a fresh token and make it the session's active share. */
export async function createShareLink(
  input: Omit<ShareSnapshot, "created_at">,
): Promise<{ token: string; snapshot: ShareSnapshot }> {
  const token = newShareToken();
  const snapshot = ShareSnapshotSchema.parse({ ...input, created_at: Date.now() });
  await write(shareKey(token), snapshot);
  await write(activeShareKey(snapshot.sessionId), { token });
  return { token, snapshot };
}

/** Delete a share: its link 404s from now on and the next share gets a new token. */
export async function revokeShareLink(token: string, sessionId: string): Promise<void> {
  const active = ActiveShareSchema.safeParse(await read(activeShareKey(sessionId)));
  const keys = [shareKey(token)];
  if (active.success && active.data.token === token) keys.push(activeShareKey(sessionId));
  await remove(keys);
}
