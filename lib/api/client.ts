import { z } from "zod";
import { SessionSchema, type MCQAnswer, type Session } from "@/lib/schemas/mcq";
import { FinalOutputSchema, type FinalOutput } from "@/lib/schemas/output";
import { getClientEnv } from "@/lib/env";

/**
 * Browser-side API helpers. Every response is Zod-validated before it leaves
 * this module so consumers can rely on typed `Session` objects without ever
 * trusting the wire shape.
 *
 * Errors carry the server's `{ error: { code, message } }` envelope and
 * surface the message to the caller for inline rendering.
 */

export class ApiError extends Error {
  public readonly code: string;
  public readonly status: number;
  constructor(code: string, message: string, status: number) {
    super(message);
    this.name = "ApiError";
    this.code = code;
    this.status = status;
  }
}

interface ErrorEnvelope {
  error: { code: string; message: string };
}

async function readError(res: Response): Promise<ApiError> {
  let body: ErrorEnvelope | null = null;
  try {
    body = (await res.json()) as ErrorEnvelope;
  } catch {
    /* fallthrough */
  }
  const code = body?.error?.code ?? "UNKNOWN_ERROR";
  const message = body?.error?.message ?? `Request failed (${res.status})`;
  return new ApiError(code, message, res.status);
}

const SessionResponseSchema = z.object({ session: SessionSchema });

/**
 * Outcome of an action that runs the pipeline. `inProgress` means another
 * request is already working on this session (HTTP 409 IN_PROGRESS): not an
 * error — the caller keeps polling `session` until it leaves "analyzing".
 */
export interface SessionActionResult {
  session: Session;
  inProgress: boolean;
}

async function readSessionAction(res: Response): Promise<SessionActionResult> {
  if (res.status === 409) {
    let body: unknown = null;
    try {
      body = await res.json();
    } catch {
      /* fallthrough */
    }
    const parsed = SessionResponseSchema.safeParse(body);
    if (parsed.success) return { session: parsed.data.session, inProgress: true };
    throw new ApiError("IN_PROGRESS", "Already working on this session.", 409);
  }
  if (!res.ok) throw await readError(res);
  const parsed = SessionResponseSchema.parse(await res.json());
  return { session: parsed.session, inProgress: false };
}

export async function createSession(rawText: string): Promise<Session> {
  const res = await fetch("/api/session", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ rawText }),
    credentials: "same-origin",
  });
  if (!res.ok) throw await readError(res);
  const parsed = SessionResponseSchema.parse(await res.json());
  return parsed.session;
}

/** Start the initial pipeline round after its owned session is available. */
export async function runSession(sessionId: string): Promise<SessionActionResult> {
  const res = await fetch(`/api/session/${sessionId}/run`, {
    method: "POST",
    credentials: "same-origin",
  });
  return readSessionAction(res);
}

export async function fetchSession(sessionId: string): Promise<Session> {
  const res = await fetch(`/api/session/${sessionId}`, {
    method: "GET",
    credentials: "same-origin",
  });
  if (!res.ok) throw await readError(res);
  const parsed = SessionResponseSchema.parse(await res.json());
  return parsed.session;
}

export async function submitAnswers(
  sessionId: string,
  answers: MCQAnswer[],
): Promise<SessionActionResult> {
  const res = await fetch(`/api/session/${sessionId}/answer`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ answers }),
    credentials: "same-origin",
  });
  return readSessionAction(res);
}

/**
 * Send the fuller description the chat asks for while the session is
 * "needs_input" (BUG-05). Starts the next round.
 */
export async function describeSession(
  sessionId: string,
  text: string,
): Promise<SessionActionResult> {
  const res = await fetch(`/api/session/${sessionId}/describe`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text }),
    credentials: "same-origin",
  });
  return readSessionAction(res);
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(s: string | null | undefined): s is string {
  return typeof s === "string" && UUID_RE.test(s);
}

const FinalizedResponseSchema = z.object({
  output: FinalOutputSchema,
  cached: z.boolean().optional(),
});

/**
 * Outcome of POST /api/finalize: the output when the session was already
 * finalized, otherwise the session whose two view jobs were just queued (or,
 * with `inProgress`, are already running) — follow it until final_output lands.
 */
export type FinalizeResult =
  | { output: FinalOutput }
  | { output: null; session: Session; inProgress: boolean };

export async function finalizeSession(
  sessionId: string,
  /**
   * "Generate anyway" (UX-02): write the scope from what is known, even
   * though the session is not ready. The document then carries a low
   * confidence score, and the output page says so.
   */
  options: { override?: boolean } = {},
): Promise<FinalizeResult> {
  const res = await fetch(`/api/finalize`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ sessionId, override: options.override ?? false }),
    credentials: "same-origin",
  });
  if (res.status === 200) {
    return { output: FinalizedResponseSchema.parse(await res.json()).output };
  }
  const { session, inProgress } = await readSessionAction(res);
  return { output: null, session, inProgress };
}

const RenameResponseSchema = z.object({ title: z.string() });

/** Rename the project. Returns the title as stored (trimmed and capped). */
export async function renameProject(projectId: string, title: string): Promise<string> {
  const res = await fetch(`/api/projects/${projectId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ title }),
    credentials: "same-origin",
  });
  if (!res.ok) throw await readError(res);
  return RenameResponseSchema.parse(await res.json()).title;
}

const ImportResponseSchema = z.object({
  text: z.string(),
  kind: z.enum(["txt", "md", "pdf", "docx"]),
  pages: z.number().int().nullable(),
  bytes: z.number().int(),
  truncated: z.boolean(),
  overBudget: z.boolean(),
  limitBytes: z.number().int(),
  fileName: z.string(),
});

export type ImportedDocument = z.infer<typeof ImportResponseSchema>;

/**
 * Read a requirements file and get its text back. The file is not stored:
 * the text goes into the input box, and what the user submits from there is
 * what becomes the brief.
 */
export async function importFile(file: File): Promise<ImportedDocument> {
  const form = new FormData();
  form.set("file", file);
  const res = await fetch("/api/import", {
    method: "POST",
    body: form,
    credentials: "same-origin",
  });
  if (!res.ok) throw await readError(res);
  return ImportResponseSchema.parse(await res.json());
}

/**
 * Delete a project for good: its rounds, versions, approvals and share
 * links go with it, and any link someone holds stops resolving (PRIV-01).
 */
export async function deleteProject(projectId: string): Promise<void> {
  const res = await fetch(`/api/projects/${projectId}`, {
    method: "DELETE",
    credentials: "same-origin",
  });
  if (!res.ok) throw await readError(res);
}

/**
 * Answer one open item (UX-02). The session leaves "finalized" for a new
 * round; follow it until it settles, then finalize again.
 */
export async function clarifySession(
  sessionId: string,
  question: string,
  answer: string,
): Promise<Session> {
  const res = await fetch(`/api/session/${sessionId}/clarify`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ question, answer }),
    credentials: "same-origin",
  });
  if (!res.ok) throw await readError(res);
  return (await readSessionAction(res)).session;
}

export async function patchFinalOutput(
  sessionId: string,
  finalOutput: FinalOutput,
): Promise<Session> {
  const res = await fetch(`/api/session/${sessionId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ final_output: finalOutput }),
    credentials: "same-origin",
  });
  if (!res.ok) throw await readError(res);
  const parsed = SessionResponseSchema.parse(await res.json());
  return parsed.session;
}

const ShareResponseSchema = z.object({
  token: z.string(),
  /** Relative path; see absoluteUrl. */
  url: z.string(),
  /** When the snapshot behind the link was taken (ms). */
  created_at: z.number(),
  /** When it stops working (ms). */
  expires_at: z.number().nullable().default(null),
  /** "view" or "approval" (blueprint step 13). */
  mode: z.enum(["view", "approval"]).default("view"),
  /** The version an approval link is asking about. */
  version_number: z.number().nullable().default(null),
  /** True when the session's existing link was returned. */
  reused: z.boolean(),
});
export type ShareLink = z.infer<typeof ShareResponseSchema>;

const ShareListSchema = z.object({
  shares: z.array(
    z.object({
      token: z.string(),
      url: z.string(),
      mode: z.enum(["view", "approval"]),
      version_number: z.number().nullable(),
      created_at: z.number(),
      expires_at: z.number().nullable(),
      active: z.boolean(),
    }),
  ),
});
export type ShareListItem = z.infer<typeof ShareListSchema>["shares"][number];

/** Every live link of a session (owner only). */
export async function listShares(sessionId: string): Promise<ShareListItem[]> {
  const res = await fetch(`/api/share?sessionId=${encodeURIComponent(sessionId)}`, {
    credentials: "same-origin",
  });
  if (!res.ok) throw await readError(res);
  return ShareListSchema.parse(await res.json()).shares;
}

export interface CreateShareOptions {
  title?: string;
  /** "approval" asks the client to approve the latest version. */
  mode?: "view" | "approval";
  /** 7, 30 or 90 days. */
  expiresInDays?: 7 | 30 | 90;
  /** Make a new link even when one is already active. */
  fresh?: boolean;
}

/** Share a finalized session: its active link, or a new snapshot link. */
export async function createShare(
  sessionId: string,
  options: CreateShareOptions = {},
): Promise<ShareLink> {
  const res = await fetch(`/api/share`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      sessionId,
      title: options.title,
      mode: options.mode ?? "view",
      expiresInDays: options.expiresInDays ?? 30,
      fresh: options.fresh ?? false,
    }),
    credentials: "same-origin",
  });
  if (!res.ok) throw await readError(res);
  return ShareResponseSchema.parse(await res.json());
}

/** Revoke a share link (owner only); it answers 404 afterwards. */
export async function revokeShare(token: string): Promise<void> {
  const res = await fetch(`/api/share/${encodeURIComponent(token)}`, {
    method: "DELETE",
    credentials: "same-origin",
  });
  if (!res.ok) throw await readError(res);
}

/**
 * An absolute URL for `path`: on NEXT_PUBLIC_APP_URL when it is set (so a
 * shared link points at the public domain), otherwise on `origin`.
 */
export function absoluteUrl(path: string, origin: string): string {
  return new URL(path, getClientEnv().NEXT_PUBLIC_APP_URL ?? origin).toString();
}
