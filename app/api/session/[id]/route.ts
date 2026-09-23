import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { z } from "zod";
import { putSession } from "@/lib/storage/session";
import { FinalOutputSchema } from "@/lib/schemas/output";
import {
  jsonError,
  loadAccessibleSession,
  loadOwnedSession,
  readJsonBody,
  requireJsonContentType,
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

  try {
    // A viewer may read a project; editing it needs "write" (see the PATCH).
    const session = await loadAccessibleSession(req, id, "read");
    if (session instanceof NextResponse) return session;
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

  try {
    const session = await loadOwnedSession(req, id);
    if (session instanceof NextResponse) return session;
    const { final_output } = await readJsonBody(req, PatchBodySchema);

    if (session.status !== "ready" && session.status !== "finalized") {
      throw new ValidationError(
        `Cannot edit output for session in status ${session.status}`,
      );
    }

    // Stored verbatim: the bounds above are the guard, and every sink —
    // React text nodes, react-markdown with its element allow-list — escapes
    // what it renders. An HTML sanitiser here deleted real content such as
    // "List<Order>" and "<5 users & R&D" (BUG-07).
    const updated = {
      ...session,
      final_output,
      updated_at: Date.now(),
    };
    await putSession(updated);
    return NextResponse.json({ session: updated });
  } catch (err) {
    return jsonError(err);
  }
}
