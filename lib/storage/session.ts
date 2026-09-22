import "@/lib/server-only";
import { getRedis } from "@/lib/storage/redis";
import { acquireLock, releaseLock } from "@/lib/storage/lock";
import { SessionSchema, type Session } from "@/lib/schemas/mcq";
import { logger } from "@/lib/logger";

const SESSION_TTL_SECONDS = 24 * 60 * 60;

interface MemoryEntry {
  session: Session;
  expiresAt: number;
}

/**
 * In-memory store stashed on globalThis so it survives Next.js Fast Refresh
 * module re-evaluation in dev. Without this, the Map is wiped every time we
 * edit a server file and any session created seconds earlier is gone.
 */
const memory: Map<string, MemoryEntry> = (() => {
  const g = globalThis as { __scopeai_session_store?: Map<string, MemoryEntry> };
  if (!g.__scopeai_session_store) {
    g.__scopeai_session_store = new Map<string, MemoryEntry>();
  }
  return g.__scopeai_session_store;
})();

function key(id: string): string {
  return `scopeai:session:${id}`;
}

/**
 * Look up a session by id. Returns null if missing, expired, or shape-invalid.
 *
 * The Zod re-validation on the way out is intentional: it protects against a
 * cache that may have been written by a previous schema version and
 * silently filters bad data instead of crashing the request.
 */
export async function getSession(id: string): Promise<Session | null> {
  const r = getRedis();
  let raw: unknown;
  if (r) {
    try {
      raw = await r.get(key(id));
    } catch (err) {
      logger.warn("session.redis_get_failure", {
        message: err instanceof Error ? err.message : "unknown",
      });
      return null;
    }
  } else {
    const entry = memory.get(id);
    if (!entry) return null;
    if (entry.expiresAt < Date.now()) {
      memory.delete(id);
      return null;
    }
    raw = entry.session;
  }
  if (!raw) return null;
  const parsed = SessionSchema.safeParse(raw);
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
  const r = getRedis();
  if (r) {
    try {
      await r.set(key(session.id), validated.data, { ex: SESSION_TTL_SECONDS });
      return;
    } catch (err) {
      logger.warn("session.redis_set_failure", {
        message: err instanceof Error ? err.message : "unknown",
      });
      return;
    }
  }
  memory.set(session.id, {
    session: validated.data,
    expiresAt: Date.now() + SESSION_TTL_SECONDS * 1000,
  });
}

export async function deleteSession(id: string): Promise<void> {
  const r = getRedis();
  if (r) {
    try {
      await r.del(key(id));
      return;
    } catch {
      // best effort
    }
  }
  memory.delete(id);
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
