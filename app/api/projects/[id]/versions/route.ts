import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { can, loadAccessSubject, roleFor } from "@/lib/auth/access";
import { getViewer } from "@/lib/auth/viewer";
import { listVersions } from "@/lib/versions/store";
import { jsonError, validateUuid } from "@/lib/security/route-helpers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Every version of a project, oldest first. Reading the project is enough. */
export async function GET(
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
    if (!can(await roleFor(await getViewer(req), subject), "read")) {
      return NextResponse.json(
        { error: { code: "UNAUTHORIZED", message: "No access to this project" } },
        { status: 401 },
      );
    }
    return NextResponse.json({ versions: await listVersions(id) });
  } catch (err) {
    return jsonError(err, 500, req);
  }
}
