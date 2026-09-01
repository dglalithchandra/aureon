import { z } from "zod";
import { SessionSchema, type MCQAnswer, type Session } from "@/lib/schemas/mcq";
import {
  FinalOutputSchema,
  type FinalOutput,
} from "@/lib/schemas/output";

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
export async function runSession(sessionId: string): Promise<Session> {
  const res = await fetch(`/api/session/${sessionId}/run`, {
    method: "POST",
    credentials: "same-origin",
  });
  if (!res.ok) throw await readError(res);
  const parsed = SessionResponseSchema.parse(await res.json());
  return parsed.session;
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
): Promise<Session> {
  const res = await fetch(`/api/session/${sessionId}/answer`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ answers }),
    credentials: "same-origin",
  });
  if (!res.ok) throw await readError(res);
  const parsed = SessionResponseSchema.parse(await res.json());
  return parsed.session;
}

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(s: string | null | undefined): s is string {
  return typeof s === "string" && UUID_RE.test(s);
}

const FinalizeResponseSchema = z.object({
  output: FinalOutputSchema,
  cached: z.boolean().optional(),
});

export async function finalizeSession(sessionId: string): Promise<FinalOutput> {
  const res = await fetch(`/api/finalize`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ sessionId }),
    credentials: "same-origin",
  });
  if (!res.ok) throw await readError(res);
  const parsed = FinalizeResponseSchema.parse(await res.json());
  return parsed.output;
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
  url: z.string(),
});

export async function createShare(
  sessionId: string,
): Promise<{ token: string; url: string }> {
  const res = await fetch(`/api/share`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ sessionId }),
    credentials: "same-origin",
  });
  if (!res.ok) throw await readError(res);
  return ShareResponseSchema.parse(await res.json());
}
