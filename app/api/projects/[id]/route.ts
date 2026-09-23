import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { can, loadAccessSubject, roleFor } from "@/lib/auth/access";
import { getViewer } from "@/lib/auth/viewer";
import { deleteProject } from "@/lib/projects/list";
import { jsonError, validateUuid } from "@/lib/security/route-helpers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Delete a project for good: its rounds, shares, versions and approvals go
 * with it, and any share link stops resolving. Owners only — an editor can
 * change a scope but not destroy it.
 */
export async function DELETE(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const { id } = await ctx.params;
  if (!validateUuid(id)) {
    return NextResponse.json(
      { error: { code: "VALIDATION_ERROR", message: "Invalid project id" } },
      { status: 400 },
    );
  }

  try {
    const subject = await loadAccessSubject(id);
    if (!subject) {
      return NextResponse.json(
        { error: { code: "NOT_FOUND", message: "Project not found" } },
        { status: 404 },
      );
    }
    const viewer = await getViewer(req);
    if (!can(await roleFor(viewer, subject), "delete")) {
      return NextResponse.json(
        { error: { code: "UNAUTHORIZED", message: "Only the owner can delete this" } },
        { status: 401 },
      );
    }
    await deleteProject(id, viewer);
    return NextResponse.json({ deleted: true });
  } catch (err) {
    return jsonError(err);
  }
}
