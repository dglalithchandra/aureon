import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { z } from "zod";
import { can, loadAccessSubject, roleFor } from "@/lib/auth/access";
import { getViewer } from "@/lib/auth/viewer";
import { deleteProject, renameProject } from "@/lib/projects/list";
import {
  jsonError,
  readJsonBody,
  requireJsonContentType,
  validateUuid,
} from "@/lib/security/route-helpers";

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

const RenameBodySchema = z.object({
  title: z.string().min(1).max(200),
});

/**
 * Rename a project (UX-02: the title typed on the output page is the one
 * the projects list shows afterwards). Anyone who may edit the scope may
 * rename it; the stored title is the tidied form, which the response
 * returns so the client shows exactly what was kept.
 */
export async function PATCH(
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

  const ctMismatch = requireJsonContentType(req);
  if (ctMismatch) return ctMismatch;

  try {
    const subject = await loadAccessSubject(id);
    if (!subject) {
      return NextResponse.json(
        { error: { code: "NOT_FOUND", message: "Project not found" } },
        { status: 404 },
      );
    }
    const viewer = await getViewer(req);
    if (!can(await roleFor(viewer, subject), "write")) {
      return NextResponse.json(
        { error: { code: "UNAUTHORIZED", message: "You cannot rename this project" } },
        { status: 401 },
      );
    }
    const { title } = await readJsonBody(req, RenameBodySchema);
    return NextResponse.json({ title: await renameProject(id, title) });
  } catch (err) {
    return jsonError(err);
  }
}
