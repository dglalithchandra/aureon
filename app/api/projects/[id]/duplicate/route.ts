import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { can, loadAccessSubject, roleFor } from "@/lib/auth/access";
import { getViewer } from "@/lib/auth/viewer";
import { duplicateProject } from "@/lib/projects/list";
import { jsonError, validateUuid } from "@/lib/security/route-helpers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Copy a project, rounds and all, under a new id. Reading it is enough to
 * copy it: the copy belongs to whoever made it, and starts unshared.
 */
export async function POST(
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
    if (!can(await roleFor(viewer, subject), "read")) {
      return NextResponse.json(
        { error: { code: "UNAUTHORIZED", message: "No access to this project" } },
        { status: 401 },
      );
    }
    const copyId = await duplicateProject(id, viewer);
    return NextResponse.json({ id: copyId }, { status: 201 });
  } catch (err) {
    return jsonError(err);
  }
}
