import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { getViewer } from "@/lib/auth/viewer";
import { listProjects } from "@/lib/projects/list";
import { jsonError } from "@/lib/security/route-helpers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * The viewer's projects, newest first. `?q=` searches the title and the
 * client's own words. An anonymous browser sees its own; a signed-in user
 * sees theirs plus every workspace they belong to.
 */
export async function GET(req: NextRequest): Promise<NextResponse> {
  try {
    const viewer = await getViewer(req);
    const query = req.nextUrl.searchParams.get("q") ?? undefined;
    const projects = await listProjects(viewer, { query });
    return NextResponse.json({ projects });
  } catch (err) {
    return jsonError(err);
  }
}
