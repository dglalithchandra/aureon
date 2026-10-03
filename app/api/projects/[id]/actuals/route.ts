import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { eq } from "drizzle-orm";
import { can, loadAccessSubject, roleFor } from "@/lib/auth/access";
import { getViewer } from "@/lib/auth/viewer";
import { getDatabase } from "@/lib/db/client";
import { auditLog, projectActuals } from "@/lib/db/schema";
import { getSession } from "@/lib/storage/session";
import { latestVersion } from "@/lib/versions/store";
import { RecordActualsSchema } from "@/lib/schemas/actuals";
import { projectActualsDetail } from "@/lib/calibration/store";
import {
  jsonError,
  readJsonBody,
  requireJsonContentType,
  validateUuid,
} from "@/lib/security/route-helpers";
import { ValidationError } from "@/lib/errors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * What a project actually cost, recorded after it shipped.
 *
 * Only on an approved project: the point of the number is to compare what
 * happened against what was agreed, and an unapproved scope was never
 * agreed. The estimate is snapshotted into the row at the same time, so a
 * later edit to the document cannot rewrite what was predicted.
 */

interface RouteParams {
  params: Promise<{ id: string }>;
}

export async function GET(
  req: NextRequest,
  { params }: RouteParams,
): Promise<NextResponse> {
  const { id } = await params;
  if (!validateUuid(id)) return badId();

  try {
    const gate = await authorise(req, id, "read");
    if (gate instanceof NextResponse) return gate;
    // The whole record, note and module names included: this is the
    // workspace reading back what it wrote.
    return NextResponse.json({ actuals: await projectActualsDetail(id) });
  } catch (err) {
    return jsonError(err, 500, req);
  }
}

export async function POST(
  req: NextRequest,
  { params }: RouteParams,
): Promise<NextResponse> {
  const { id } = await params;
  if (!validateUuid(id)) return badId();

  const ctMismatch = requireJsonContentType(req);
  if (ctMismatch) return ctMismatch;

  try {
    const gate = await authorise(req, id, "write");
    if (gate instanceof NextResponse) return gate;
    const { subject, viewer } = gate;

    const session = await getSession(id);
    if (!session?.final_output) {
      throw new ValidationError("This scope has no generated output yet.");
    }
    const version = await latestVersion(id);
    if (!version?.lockedAt) {
      throw new ValidationError(
        "Record actuals once the client has approved a version: the comparison is against what was agreed.",
      );
    }

    const body = await readJsonBody(req, RecordActualsSchema);
    const effort = session.final_output.engineer.effort_summary;
    const domain =
      session.rounds[session.rounds.length - 1]?.extraction.domain ?? "Other";

    const now = new Date();
    const row = {
      projectId: id,
      workspaceId: subject.workspaceId,
      domain,
      actualWeeks: body.actualWeeks,
      actualTeamSize: body.actualTeamSize,
      scopeAccuracy: body.scopeAccuracy,
      note: body.note || null,
      modules: body.modules,
      // Snapshotted, so a later edit to the scope cannot change history.
      estimatedSprints: effort.total_sprints,
      estimatedPoints: effort.total_points,
      estimatedTeamSize: effort.team_size,
      estimatedVelocity: effort.velocity,
      domainMultiplier: effort.domain_multiplier,
      recordedBy: viewer.userId,
      updatedAt: now,
    };

    await getDatabase()
      .insert(projectActuals)
      .values(row)
      .onConflictDoUpdate({ target: projectActuals.projectId, set: row });

    await getDatabase()
      .insert(auditLog)
      .values({
        action: "project.actuals_recorded",
        actorUserId: viewer.userId,
        actorAnonId: viewer.anonId,
        subjectType: "project",
        subjectId: id,
        workspaceId: subject.workspaceId,
        // Numbers only: the note is the owner's, and stays in the row.
        detail: {
          actualWeeks: body.actualWeeks,
          estimatedSprints: effort.total_sprints,
          scopeAccuracy: body.scopeAccuracy,
        },
      });

    return NextResponse.json({ recorded: true });
  } catch (err) {
    return jsonError(err, 500, req);
  }
}

export async function DELETE(
  req: NextRequest,
  { params }: RouteParams,
): Promise<NextResponse> {
  const { id } = await params;
  if (!validateUuid(id)) return badId();

  try {
    const gate = await authorise(req, id, "write");
    if (gate instanceof NextResponse) return gate;
    await getDatabase().delete(projectActuals).where(eq(projectActuals.projectId, id));
    return NextResponse.json({ deleted: true });
  } catch (err) {
    return jsonError(err, 500, req);
  }
}

function badId(): NextResponse {
  return NextResponse.json(
    { error: { code: "VALIDATION_ERROR", message: "Invalid project id" } },
    { status: 400 },
  );
}

async function authorise(
  req: NextRequest,
  id: string,
  action: "read" | "write",
): Promise<
  | NextResponse
  | {
      subject: NonNullable<Awaited<ReturnType<typeof loadAccessSubject>>>;
      viewer: Awaited<ReturnType<typeof getViewer>>;
    }
> {
  const subject = await loadAccessSubject(id);
  if (!subject) {
    return NextResponse.json(
      { error: { code: "NOT_FOUND", message: "Project not found" } },
      { status: 404 },
    );
  }
  const viewer = await getViewer(req);
  if (!can(await roleFor(viewer, subject), action)) {
    return NextResponse.json(
      { error: { code: "UNAUTHORIZED", message: "You cannot do that here" } },
      { status: 401 },
    );
  }
  return { subject, viewer };
}
