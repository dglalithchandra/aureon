import { NextRequest } from "next/server";
import { eq } from "drizzle-orm";
import JSZip from "jszip";
import { beforeEach, describe, expect, it } from "vitest";
import { GET as exportRoute } from "@/app/api/projects/[id]/export/route";
import { getDatabase } from "@/lib/db/client";
import { projects, workspaces } from "@/lib/db/schema";
import { putSession } from "@/lib/storage/session";
import { renameProject } from "@/lib/projects/list";
import { recordVersion } from "@/lib/versions/store";
import { buildOwnerCookie, OWNER_COOKIE_NAME } from "@/lib/security/session-cookie";
import { DRAFT_FOOTER } from "@/lib/export/docx";
import { truncateAll } from "../helpers/db";
import {
  makeClientView,
  makeEngineerView,
  makeRound,
  makeSession,
} from "../fixtures/llm";

/**
 * GET /api/projects/[id]/export — the exports that are built on the server
 * because they need what the page does not have: the workspace branding,
 * the version number and the approval state.
 */

const PROJECT_ID = "cccccccc-0000-4000-8000-00000000000c";
const OWNER = "c0ffee00-0000-4000-8000-0000000000aa";

const params = { params: Promise.resolve({ id: PROJECT_ID }) };

let ip = 0;

function get(format: string, owner = OWNER): NextRequest {
  ip += 1;
  return new NextRequest(
    `http://localhost/api/projects/${PROJECT_ID}/export?format=${format}`,
    {
      headers: {
        cookie: `${OWNER_COOKIE_NAME}=${buildOwnerCookie(owner).value}`,
        "x-forwarded-for": `198.51.111.${ip}`,
      },
    },
  );
}

async function seed(options: { workspace?: { name: string; logoUrl?: string } } = {}) {
  await putSession(
    makeSession({
      id: PROJECT_ID,
      raw_input: "An internal tool for account managers to look after client accounts.",
      status: "finalized",
      pipeline_stage: null,
      owner_id: OWNER,
      current_confidence: 74,
      rounds: [makeRound()],
      final_output: { client: makeClientView(), engineer: makeEngineerView() },
    }),
  );
  await renameProject(PROJECT_ID, "Account manager console");

  if (options.workspace) {
    const [workspace] = await getDatabase()
      .insert(workspaces)
      .values({
        name: options.workspace.name,
        logoUrl: options.workspace.logoUrl ?? null,
      })
      .returning({ id: workspaces.id });
    await getDatabase()
      .update(projects)
      .set({ workspaceId: workspace!.id })
      .where(eq(projects.id, PROJECT_ID));
  }
}

function plain(xml: string): string {
  return xml.replace(/<[^>]+>/g, "");
}

beforeEach(async () => {
  await truncateAll();
});

describe("the Word export", () => {
  it("comes back as a .docx, named after the project", async () => {
    await seed({ workspace: { name: "Acme Studio" } });
    const res = await exportRoute(get("docx-client"), params);

    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("wordprocessingml.document");
    expect(res.headers.get("content-disposition")).toBe(
      'attachment; filename="account-manager-console-client.docx"',
    );
    expect(res.headers.get("cache-control")).toBe("private, no-store");
  });

  it("carries the workspace name, the version and the draft footer", async () => {
    await seed({ workspace: { name: "Acme Studio" } });
    await recordVersion({
      projectId: PROJECT_ID,
      output: { client: makeClientView(), engineer: makeEngineerView() },
      reason: "generated",
      confidence: 74,
    });

    const res = await exportRoute(get("docx-engineer"), params);
    const zip = await JSZip.loadAsync(Buffer.from(await res.arrayBuffer()));

    const headers = await Promise.all(
      zip.file(/word\/header\d*\.xml/).map((f) => f.async("string")),
    );
    const footers = await Promise.all(
      zip.file(/word\/footer\d*\.xml/).map((f) => f.async("string")),
    );
    const body = plain(await zip.file("word/document.xml")!.async("string"));

    expect(plain(headers.join())).toContain("Acme Studio");
    expect(plain(footers.join())).toContain(DRAFT_FOOTER);
    expect(body).toContain("Version 1");
    expect(body).toContain("Not approved yet");
    expect(body).toContain("Engineering build document");
  });

  it("works for a project with no workspace at all", async () => {
    await seed();
    const res = await exportRoute(get("docx-client"), params);
    expect(res.status).toBe(200);
  });
});

describe("the issue CSVs", () => {
  it("returns the Jira columns as text/csv", async () => {
    await seed();
    const res = await exportRoute(get("jira-csv"), params);

    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/csv");
    expect(res.headers.get("content-disposition")).toContain("jira.csv");
    const csv = await res.text();
    expect(csv.split("\r\n")[0]).toContain("Work type,Summary,Description");
  });

  it("returns the Linear columns", async () => {
    await seed();
    const csv = await (await exportRoute(get("linear-csv"), params)).text();
    expect(csv.split("\r\n")[0]).toBe(
      "Title,Description,Status,Priority,Estimate,Labels",
    );
  });
});

describe("what the route refuses", () => {
  it("a format it does not know", async () => {
    await seed();
    expect((await exportRoute(get("pptx"), params)).status).toBe(400);
  });

  it("a project that has not been generated yet", async () => {
    await putSession(
      makeSession({
        id: PROJECT_ID,
        status: "ready",
        pipeline_stage: null,
        owner_id: OWNER,
        rounds: [makeRound()],
      }),
    );
    const res = await exportRoute(get("jira-csv"), params);
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: { message: string } };
    expect(body.error.message).toMatch(/no generated output/i);
  });

  it("a project that does not exist", async () => {
    expect((await exportRoute(get("jira-csv"), params)).status).toBe(404);
  });

  it("another browser", async () => {
    await seed();
    const res = await exportRoute(
      get("jira-csv", "deadbeef-0000-4000-8000-0000000000bb"),
      params,
    );
    expect(res.status).toBe(401);
  });
});
