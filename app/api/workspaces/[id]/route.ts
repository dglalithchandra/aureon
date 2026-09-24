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
import { ValidationError } from "@/lib/errors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * The branding that goes on an exported document. An https URL is fetched
 * by the server when a document is built, so it is bounded here: https
 * only, and short enough to be a URL rather than a payload. A `data:` URI
 * is embedded as-is and needs no network, which is why it is allowed and
 * capped at roughly 256 KB of base64.
 */
const LogoSchema = z
  .string()
  .max(350_000)
  .refine(
    (value) =>
      value === "" ||
      value.startsWith("https://") ||
      /^data:image\/(png|jpeg|jpg|gif|bmp);base64,/.test(value),
    "A logo must be an https URL or a base64 data URI for a PNG, JPEG, GIF or BMP",
  );

const PatchSchema = z.object({
  /** 0 keeps raw input indefinitely; the default is 90 days. */
  rawInputRetentionDays: z.number().int().min(0).max(3650).optional(),
  name: z.string().trim().min(1).max(120).optional(),
  /** "" clears it. */
  logoUrl: LogoSchema.optional(),
});

/**
 * Change a workspace's settings: how long raw client input is kept, the
 * name, and the logo that goes on exported documents. Owners only —
 * retention decides when the client's own words are deleted, and the name
 * and logo are what leaves the building on a document.
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
    const body = await readJsonBody(req, PatchSchema);
    if (
      body.rawInputRetentionDays === undefined &&
      body.name === undefined &&
      body.logoUrl === undefined
    ) {
      throw new ValidationError("Nothing to change.");
    }

    const changes: Partial<typeof workspaces.$inferInsert> = {};
    if (body.rawInputRetentionDays !== undefined) {
      changes.rawInputRetentionDays = body.rawInputRetentionDays;
    }
    if (body.name !== undefined) changes.name = body.name;
    if (body.logoUrl !== undefined) changes.logoUrl = body.logoUrl || null;

    const [updated] = await getDatabase()
      .update(workspaces)
      .set(changes)
      .where(eq(workspaces.id, id))
      .returning({
        name: workspaces.name,
        logoUrl: workspaces.logoUrl,
        rawInputRetentionDays: workspaces.rawInputRetentionDays,
      });
    if (!updated) {
      return NextResponse.json(
        { error: { code: "NOT_FOUND", message: "Workspace not found" } },
        { status: 404 },
      );
    }

    await getDatabase()
      .insert(auditLog)
      .values({
        action: "workspace.settings_changed",
        actorUserId: viewer.userId,
        subjectType: "workspace",
        subjectId: id,
        workspaceId: id,
        // The logo can be a data URI, so the audit records that it changed,
        // not what it changed to.
        detail: {
          rawInputRetentionDays: updated.rawInputRetentionDays,
          name: updated.name,
          logoChanged: body.logoUrl !== undefined,
        },
      });
    return NextResponse.json(updated);
  } catch (err) {
    return jsonError(err, 500, req);
  }
}
