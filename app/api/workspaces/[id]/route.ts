import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { getDatabase } from "@/lib/db/client";
import { auditLog, workspaces } from "@/lib/db/schema";
import { getViewer } from "@/lib/auth/viewer";
import { workspaceRoleFor } from "@/lib/auth/access";
import {
  jsonError,
  readJsonBody,
  requireJsonContentType,
  validateUuid,
} from "@/lib/security/route-helpers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const PatchSchema = z.object({
  /** 0 keeps raw input indefinitely; the default is 90 days. */
  rawInputRetentionDays: z.number().int().min(0).max(3650),
});

/**
 * Change a workspace's settings. Owners only: retention decides when the
 * client's own words are deleted, which is not an editor's call.
 */
export async function PATCH(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const { id } = await ctx.params;
  if (!validateUuid(id)) {
    return NextResponse.json(
      { error: { code: "VALIDATION_ERROR", message: "Invalid workspace id" } },
      { status: 400 },
    );
  }
  const ctMismatch = requireJsonContentType(req);
  if (ctMismatch) return ctMismatch;

  try {
    const viewer = await getViewer(req);
    if ((await workspaceRoleFor(viewer, id)) !== "owner") {
      return NextResponse.json(
        {
          error: {
            code: "UNAUTHORIZED",
            message: "Only a workspace owner can change retention",
          },
        },
        { status: 401 },
      );
    }
    const { rawInputRetentionDays } = await readJsonBody(req, PatchSchema);
    await getDatabase()
      .update(workspaces)
      .set({ rawInputRetentionDays })
      .where(eq(workspaces.id, id));
    await getDatabase().insert(auditLog).values({
      action: "workspace.retention_changed",
      actorUserId: viewer.userId,
      subjectType: "workspace",
      subjectId: id,
      workspaceId: id,
      detail: { rawInputRetentionDays },
    });
    return NextResponse.json({ rawInputRetentionDays });
  } catch (err) {
    return jsonError(err);
  }
}
