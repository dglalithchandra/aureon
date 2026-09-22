import "@/lib/server-only";
import { randomBytes } from "node:crypto";
import { z } from "zod";
import { getRedis } from "@/lib/storage/redis";
import { logger } from "@/lib/logger";

const SHARE_TTL_SECONDS = 30 * 24 * 60 * 60; // 30 days

const ShareRecordSchema = z.object({
  sessionId: z.string().uuid(),
  createdAt: z.number().int(),
});
type ShareRecord = z.infer<typeof ShareRecordSchema>;

interface ShareEntry {
  record: ShareRecord;
  expiresAt: number;
}

const memory: Map<string, ShareEntry> = (() => {
  const g = globalThis as { __scopeai_share_store?: Map<string, ShareEntry> };
  if (!g.__scopeai_share_store) {
    g.__scopeai_share_store = new Map<string, ShareEntry>();
  }
  return g.__scopeai_share_store;
})();

function key(token: string): string {
  return `scopeai:share:${token}`;
}

const TOKEN_RE = /^[A-Za-z0-9_-]{32,64}$/;
export function isShareToken(token: string): boolean {
  return TOKEN_RE.test(token);
}

export function newShareToken(): string {
  // 32 bytes → 43 char base64url string. URL-safe, opaque, collision-resistant.
  return randomBytes(32).toString("base64url");
}

export async function createShareLink(sessionId: string): Promise<string> {
  const token = newShareToken();
  const record: ShareRecord = { sessionId, createdAt: Date.now() };
  const r = getRedis();
  if (r) {
    try {
      await r.set(key(token), record, { ex: SHARE_TTL_SECONDS });
      return token;
    } catch (err) {
      logger.warn("share.redis_set_failure", {
        message: err instanceof Error ? err.message : "unknown",
      });
    }
  }
  memory.set(token, { record, expiresAt: Date.now() + SHARE_TTL_SECONDS * 1000 });
  return token;
}

export async function resolveShareToken(token: string): Promise<ShareRecord | null> {
  if (!isShareToken(token)) return null;
  const r = getRedis();
  let raw: unknown;
  if (r) {
    try {
      raw = await r.get(key(token));
    } catch (err) {
      logger.warn("share.redis_get_failure", {
        message: err instanceof Error ? err.message : "unknown",
      });
      return null;
    }
  } else {
    const entry = memory.get(token);
    if (!entry) return null;
    if (entry.expiresAt < Date.now()) {
      memory.delete(token);
      return null;
    }
    raw = entry.record;
  }
  if (!raw) return null;
  const parsed = ShareRecordSchema.safeParse(raw);
  return parsed.success ? parsed.data : null;
}
