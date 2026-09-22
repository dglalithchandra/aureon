import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { z } from "zod";
import { getSession, putSession } from "@/lib/storage/session";
import { FinalOutputSchema } from "@/lib/schemas/output";
import { deepSanitize } from "@/lib/security/deep-sanitize";
import {
  jsonError,
  readJsonBody,
  requireJsonContentType,
  requireSessionOwner,
  validateUuid,
} from "@/lib/security/route-helpers";
import { ValidationError } from "@/lib/errors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface RouteParams {
  params: Promise<{ id: string }>;
}

export async function GET(
  req: NextRequest,
  { params }: RouteParams,
): Promise<NextResponse> {
  const { id } = await params;
  if (!validateUuid(id)) {
    return NextResponse.json(
      { error: { code: "VALIDATION_ERROR", message: "Invalid session id" } },
      { status: 400 },
    );
  }

  const unauthorized = requireSessionOwner(req, id);
  if (unauthorized) return unauthorized;

  try {
    const session = await getSession(id);
    if (!session) {
      return NextResponse.json(
        { error: { code: "NOT_FOUND", message: "Session not found or expired" } },
        { status: 404 },
      );
    }
    return NextResponse.json({ session });
  } catch (err) {
    return jsonError(err);
  }
}

/**
 * PATCH replaces `session.final_output` with the supplied object. The body
 * must validate against `FinalOutputSchema` in strict mode (no unknown keys
 * — Zod 4's default for object schemas with `.strict()`). Every string is
 * deep-sanitized server-side via DOMPurify before storage.
 */
const PatchBodySchema = z.object({
  final_output: FinalOutputSchema.strict(),
});

export async function PATCH(
  req: NextRequest,
  { params }: RouteParams,
): Promise<NextResponse> {
  const { id } = await params;
  if (!validateUuid(id)) {
    return NextResponse.json(
      { error: { code: "VALIDATION_ERROR", message: "Invalid session id" } },
      { status: 400 },
    );
  }

  const ctMismatch = requireJsonContentType(req);
  if (ctMismatch) return ctMismatch;

  const unauthorized = requireSessionOwner(req, id);
  if (unauthorized) return unauthorized;

  try {
    const { final_output } = await readJsonBody(req, PatchBodySchema);

    const session = await getSession(id);
    if (!session) {
      return NextResponse.json(
        { error: { code: "NOT_FOUND", message: "Session not found or expired" } },
        { status: 404 },
      );
    }
    if (session.status !== "ready" && session.status !== "finalized") {
      throw new ValidationError(
        `Cannot edit output for session in status ${session.status}`,
      );
    }

    const sanitized = deepSanitize(final_output);
    // Re-validate after sanitize to catch any string that became too short
    // (e.g. a single-char string that DOMPurify trimmed to "").
    const reparsed = FinalOutputSchema.safeParse(sanitized);
    if (!reparsed.success) {
      const message = reparsed.error.issues
        .slice(0, 3)
        .map((i) => `${i.path.join(".")}: ${i.message}`)
        .join("; ");
      throw new ValidationError(`Sanitized payload invalid: ${message}`);
    }

    const updated = {
      ...session,
      final_output: reparsed.data,
      updated_at: Date.now(),
    };
    await putSession(updated);
    return NextResponse.json({ session: updated });
  } catch (err) {
    return jsonError(err);
  }
}
