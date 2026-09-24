import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { eq } from "drizzle-orm";
import { can, loadAccessSubject, roleFor } from "@/lib/auth/access";
import { getViewer } from "@/lib/auth/viewer";
import { getDatabase } from "@/lib/db/client";
import { workspaces } from "@/lib/db/schema";
import { getSession } from "@/lib/storage/session";
import { projectTitle } from "@/lib/projects/list";
import { latestVersion } from "@/lib/versions/store";
import { listApprovals } from "@/lib/versions/approval";
import { buildScopeDocx, loadWorkspaceLogo, type DocxMeta } from "@/lib/export/docx";
import { toJiraCsv, toLinearCsv } from "@/lib/export/csv";
import { jsonError, validateUuid } from "@/lib/security/route-helpers";
import { ValidationError } from "@/lib/errors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * The exports that have to be made on the server: a Word document, which
 * needs the workspace branding, the version number and the approval state,
 * and the two issue-tracker CSVs.
 *
 * Markdown and PDF stay in the browser, where they always were — they need
 * nothing the page does not already have.
 */

const FORMATS = ["docx-client", "docx-engineer", "jira-csv", "linear-csv"] as const;
type Format = (typeof FORMATS)[number];

function isFormat(value: string | null): value is Format {
  return value !== null && (FORMATS as readonly string[]).includes(value);
}

/** A file name that survives a download dialog on any platform. */
function safeFileName(title: string, suffix: string): string {
  const stem =
    title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 60) || "scope";
  return `${stem}-${suffix}`;
}

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

  const format = req.nextUrl.searchParams.get("format");
  if (!isFormat(format)) {
    return NextResponse.json(
      {
        error: {
          code: "VALIDATION_ERROR",
          message: `format must be one of ${FORMATS.join(", ")}`,
        },
      },
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
    // Reading is enough: an export is a copy of what the reader can see.
    if (!can(await roleFor(viewer, subject), "read")) {
      return NextResponse.json(
        { error: { code: "UNAUTHORIZED", message: "You cannot export this project" } },
        { status: 401 },
      );
    }

    const session = await getSession(id);
    if (!session?.final_output) {
      throw new ValidationError("This scope has no generated output yet.");
    }
    const output = session.final_output;

    if (format === "jira-csv" || format === "linear-csv") {
      const csv = format === "jira-csv" ? toJiraCsv(output) : toLinearCsv(output);
      const title = (await projectTitle(id)) ?? "scope";
      return file(
        csv,
        "text/csv; charset=utf-8",
        safeFileName(title, format === "jira-csv" ? "jira.csv" : "linear.csv"),
      );
    }

    const [title, version, decisions, workspace] = await Promise.all([
      projectTitle(id),
      latestVersion(id),
      listApprovals(id),
      loadWorkspace(subject.workspaceId),
    ]);

    const approved = decisions.find((d) => d.state === "approved");
    const changes = decisions.find((d) => d.state === "changes_requested");
    const meta: DocxMeta = {
      title: title ?? "Project scope",
      versionNumber: version?.versionNumber ?? null,
      approvalLabel: version?.lockedAt ? (version.label ?? null) : null,
      approvalState: approved ? "approved" : changes ? "changes_requested" : null,
      generatedAt: new Date(),
    };

    const view = format === "docx-client" ? "client" : "engineer";
    const docx = await buildScopeDocx({
      view,
      output,
      meta,
      branding: {
        workspaceName: workspace?.name ?? null,
        logo: await loadWorkspaceLogo(workspace?.logoUrl ?? null),
      },
    });

    return file(
      docx,
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      safeFileName(meta.title, `${view}.docx`),
    );
  } catch (err) {
    return jsonError(err, 500, req);
  }
}

async function loadWorkspace(
  workspaceId: string | null,
): Promise<{ name: string; logoUrl: string | null } | null> {
  if (!workspaceId) return null;
  const [row] = await getDatabase()
    .select({ name: workspaces.name, logoUrl: workspaces.logoUrl })
    .from(workspaces)
    .where(eq(workspaces.id, workspaceId))
    .limit(1);
  return row ?? null;
}

function file(
  body: string | Buffer,
  contentType: string,
  fileName: string,
): NextResponse {
  return new NextResponse(new Uint8Array(Buffer.from(body)), {
    status: 200,
    headers: {
      "Content-Type": contentType,
      "Content-Disposition": `attachment; filename="${fileName}"`,
      // A scope is not public data, and a download is not worth caching.
      "Cache-Control": "private, no-store",
    },
  });
}
