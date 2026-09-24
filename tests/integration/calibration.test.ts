import { NextRequest } from "next/server";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { generateEngineerView } from "@/lib/pipeline/finalize";
import { startMockLlm, type MockLlm } from "../mocks/mock-llm";
import {
  GET as getActuals,
  POST as postActuals,
} from "@/app/api/projects/[id]/actuals/route";
import { PATCH as patchWorkspace } from "@/app/api/workspaces/[id]/route";
import { getDatabase } from "@/lib/db/client";
import {
  authSessions,
  projectActuals,
  projects,
  users,
  workspaceMembers,
  workspaces,
} from "@/lib/db/schema";
import { getSession, putSession } from "@/lib/storage/session";
import { recordVersion, lockVersion } from "@/lib/versions/store";
import {
  calibrationFor,
  sharedPool,
  workspaceFactors,
  workspaceRecords,
} from "@/lib/calibration/store";
import { MIN_PROJECTS } from "@/lib/calibration/factors";
import { buildOwnerCookie, OWNER_COOKIE_NAME } from "@/lib/security/session-cookie";
import { truncateAll } from "../helpers/db";
import {
  makeClientView,
  makeEngineerView,
  makeRound,
  makeSession,
} from "../fixtures/llm";

/**
 * The calibration loop against a real database: recording actuals, the
 * five-project rule, and the boundary the shared pool must not cross.
 */

const OWNER = "c0ffee00-0000-4000-8000-0000000000aa";

/** A distinctive string that must never reach another workspace. */
const SECRET_NOTE = "Client hated the checkout copy, ask Priya before quoting again";
const SECRET_MODULE = "Codename Bluebird payouts";

let ip = 0;

function post(projectId: string, body: unknown, owner = OWNER): NextRequest {
  ip += 1;
  return new NextRequest(`http://localhost/api/projects/${projectId}/actuals`, {
    method: "POST",
    headers: {
      cookie: `${OWNER_COOKIE_NAME}=${buildOwnerCookie(owner).value}`,
      "content-type": "application/json",
      "x-forwarded-for": `198.51.112.${ip}`,
    },
    body: JSON.stringify(body),
  });
}

const params = (id: string) => ({ params: Promise.resolve({ id }) });

async function makeWorkspace(name: string, share = false): Promise<string> {
  const [row] = await getDatabase()
    .insert(workspaces)
    .values({ name, shareCalibration: share })
    .returning({ id: workspaces.id });
  return row!.id;
}

/** An approved project, ready for its actuals. */
async function approvedProject(options: {
  id: string;
  workspaceId?: string | null;
  domain?: string;
  sprints?: number;
  moduleName?: string;
}): Promise<void> {
  const engineer = makeEngineerView();
  const round = makeRound();
  const session = makeSession({
    id: options.id,
    raw_input: "An internal tool for account managers to look after client accounts.",
    status: "finalized",
    pipeline_stage: null,
    owner_id: OWNER,
    current_confidence: 74,
    rounds: [
      {
        ...round,
        extraction: { ...round.extraction, domain: options.domain ?? "SaaS" },
      },
    ],
    final_output: {
      client: makeClientView(),
      engineer: {
        ...engineer,
        module_table: [
          { ...engineer.module_table[0]!, name: options.moduleName ?? "Auth" },
        ],
        effort_summary: {
          ...engineer.effort_summary,
          total_sprints: options.sprints ?? 5,
          total_points: 130,
          velocity: 26,
          team_size: 3,
          domain_multiplier: 1,
        },
      },
    },
  });
  await putSession(session);
  if (options.workspaceId !== undefined) {
    await getDatabase()
      .update(projects)
      .set({ workspaceId: options.workspaceId })
      .where(eq(projects.id, options.id));
  }
  const version = await recordVersion({
    projectId: options.id,
    output: session.final_output!,
    reason: "generated",
    confidence: 74,
  });
  if (version) await lockVersion(version.id, "Client");
}

function actualsBody(overrides: Record<string, unknown> = {}) {
  return {
    actualWeeks: 12,
    actualTeamSize: 3,
    scopeAccuracy: 4,
    note: SECRET_NOTE,
    modules: [
      {
        name: SECRET_MODULE,
        estimatedSize: "MEDIUM",
        actualSize: "LARGE",
        actualSprints: 2,
      },
    ],
    ...overrides,
  };
}

let mock: MockLlm;

beforeAll(async () => {
  mock = await startMockLlm();
  process.env.GEMINI_BASE_URL = mock.url;
});

afterAll(async () => {
  await mock.close();
});

beforeEach(async () => {
  mock.reset();
  await truncateAll();
});

describe("recording actuals", () => {
  const PROJECT = "dddddddd-0000-4000-8000-00000000000d";

  it("stores what happened, with the estimate snapshotted beside it", async () => {
    const workspaceId = await makeWorkspace("Acme");
    await approvedProject({ id: PROJECT, workspaceId, sprints: 5 });

    const res = await postActuals(post(PROJECT, actualsBody()), params(PROJECT));
    expect(res.status).toBe(200);

    const [row] = await getDatabase()
      .select()
      .from(projectActuals)
      .where(eq(projectActuals.projectId, PROJECT));
    expect(row).toMatchObject({
      actualWeeks: 12,
      actualTeamSize: 3,
      scopeAccuracy: 4,
      note: SECRET_NOTE,
      estimatedSprints: 5,
      estimatedVelocity: 26,
      workspaceId,
    });
  });

  it("replaces the record rather than adding a second one", async () => {
    const workspaceId = await makeWorkspace("Acme");
    await approvedProject({ id: PROJECT, workspaceId });

    await postActuals(post(PROJECT, actualsBody()), params(PROJECT));
    await postActuals(post(PROJECT, actualsBody({ actualWeeks: 20 })), params(PROJECT));

    const rows = await getDatabase()
      .select()
      .from(projectActuals)
      .where(eq(projectActuals.projectId, PROJECT));
    expect(rows).toHaveLength(1);
    expect(rows[0]?.actualWeeks).toBe(20);
  });

  it("refuses until a version has been approved", async () => {
    const workspaceId = await makeWorkspace("Acme");
    const session = makeSession({
      id: PROJECT,
      status: "finalized",
      pipeline_stage: null,
      owner_id: OWNER,
      rounds: [makeRound()],
      final_output: { client: makeClientView(), engineer: makeEngineerView() },
    });
    await putSession(session);
    await getDatabase()
      .update(projects)
      .set({ workspaceId })
      .where(eq(projects.id, PROJECT));

    const res = await postActuals(post(PROJECT, actualsBody()), params(PROJECT));
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: { message: string } };
    expect(body.error.message).toMatch(/approved/i);
  });

  it("refuses another browser", async () => {
    await approvedProject({ id: PROJECT, workspaceId: await makeWorkspace("Acme") });
    const res = await postActuals(
      post(PROJECT, actualsBody(), "deadbeef-0000-4000-8000-0000000000bb"),
      params(PROJECT),
    );
    expect(res.status).toBe(401);
  });

  it("refuses numbers outside the bounds", async () => {
    await approvedProject({ id: PROJECT, workspaceId: await makeWorkspace("Acme") });
    for (const bad of [
      { actualWeeks: 0 },
      { actualWeeks: 500 },
      { actualTeamSize: 0 },
      { scopeAccuracy: 6 },
      { scopeAccuracy: 0 },
    ]) {
      const res = await postActuals(post(PROJECT, actualsBody(bad)), params(PROJECT));
      expect(res.status).toBe(400);
    }
  });

  it("reads back what was recorded", async () => {
    await approvedProject({ id: PROJECT, workspaceId: await makeWorkspace("Acme") });
    await postActuals(post(PROJECT, actualsBody()), params(PROJECT));

    const res = await getActuals(
      new NextRequest(`http://localhost/api/projects/${PROJECT}/actuals`, {
        headers: { cookie: `${OWNER_COOKIE_NAME}=${buildOwnerCookie(OWNER).value}` },
      }),
      params(PROJECT),
    );
    const body = (await res.json()) as { actuals: { actualWeeks: number } | null };
    expect(body.actuals?.actualWeeks).toBe(12);
  });
});

describe("the five-project rule, end to end", () => {
  async function recordProjects(workspaceId: string, count: number): Promise<void> {
    for (let i = 0; i < count; i += 1) {
      const id = `eeeeeeee-0000-4000-8000-00000000000${i.toString(16)}`;
      await approvedProject({ id, workspaceId, domain: "SaaS", sprints: 5 });
      await postActuals(
        post(id, actualsBody({ actualWeeks: 15 })), // 7.5 sprints against 5
        params(id),
      );
    }
  }

  it("offers no calibration until the fifth project is recorded", async () => {
    const workspaceId = await makeWorkspace("Acme");
    await recordProjects(workspaceId, MIN_PROJECTS - 1);

    const factors = await workspaceFactors(workspaceId);
    expect(factors.projects).toBe(MIN_PROJECTS - 1);
    expect(factors.byDomain.saas?.applicable).toBe(false);
    expect(await calibrationFor(workspaceId, "SaaS")).toBeNull();
  });

  it("starts adjusting at five", async () => {
    const workspaceId = await makeWorkspace("Acme");
    await recordProjects(workspaceId, MIN_PROJECTS);

    const calibration = await calibrationFor(workspaceId, "SaaS");
    expect(calibration?.source).toBe("workspace");
    expect(calibration?.domain?.projects).toBe(MIN_PROJECTS);
    expect(calibration?.domain?.ratio).toBe(1.5);
  });

  it("is nothing at all for a project with no workspace", async () => {
    expect(await calibrationFor(null, "SaaS")).toBeNull();
  });
});

describe("the shared pool", () => {
  const MINE = "11111111-0000-4000-8000-00000000000a";

  async function workspaceWithRecords(
    name: string,
    share: boolean,
    projectIds: string[],
  ): Promise<string> {
    const workspaceId = await makeWorkspace(name, share);
    for (const id of projectIds) {
      await approvedProject({
        id,
        workspaceId,
        domain: "FinTech",
        moduleName: SECRET_MODULE,
      });
      await postActuals(post(id, actualsBody()), params(id));
    }
    return workspaceId;
  }

  const THEIRS = [
    "22222222-0000-4000-8000-00000000000a",
    "22222222-0000-4000-8000-00000000000b",
    "22222222-0000-4000-8000-00000000000c",
    "22222222-0000-4000-8000-00000000000d",
    "22222222-0000-4000-8000-00000000000e",
  ];

  it("gives a workspace that has not opted in nothing at all", async () => {
    await workspaceWithRecords("Sharers", true, THEIRS);
    const mine = await workspaceWithRecords("Mine", false, [MINE]);

    expect(await sharedPool(mine)).toEqual([]);
    // And with fewer than five of its own, it gets no calibration either.
    expect(await calibrationFor(mine, "FinTech")).toBeNull();
  });

  it("gives an opted-in workspace the others' numbers", async () => {
    await workspaceWithRecords("Sharers", true, THEIRS);
    const mine = await workspaceWithRecords("Mine", true, [MINE]);

    const pool = await sharedPool(mine);
    expect(pool).toHaveLength(THEIRS.length);
    const calibration = await calibrationFor(mine, "FinTech");
    expect(calibration?.source).toBe("shared");
    expect(calibration?.domain?.projects).toBe(THEIRS.length);
  });

  it("never carries a note or a module name across the boundary", async () => {
    await workspaceWithRecords("Sharers", true, THEIRS);
    const mine = await workspaceWithRecords("Mine", true, [MINE]);

    const pool = await sharedPool(mine);
    const serialised = JSON.stringify(pool);
    expect(serialised).not.toContain(SECRET_NOTE);
    expect(serialised).not.toContain(SECRET_MODULE);
    expect(serialised).not.toContain("note");
    for (const record of pool) {
      for (const row of record.modules) {
        expect(Object.keys(row).sort()).toEqual([
          "actualSize",
          "actualSprints",
          "estimatedSize",
        ]);
      }
    }
  });

  it("leaves the workspace's own project out of its own pool", async () => {
    await workspaceWithRecords("Sharers", true, THEIRS);
    const mine = await workspaceWithRecords("Mine", true, [MINE]);

    const pool = await sharedPool(mine);
    expect(pool.map((r) => r.projectId)).not.toContain(MINE);
  });

  it("stops sharing the moment the toggle goes off", async () => {
    const sharers = await workspaceWithRecords("Sharers", true, THEIRS);
    const mine = await workspaceWithRecords("Mine", true, [MINE]);
    expect(await sharedPool(mine)).toHaveLength(THEIRS.length);

    // The other workspace opts out: its rows leave the pool at once,
    // because the pool is a query and not a copy.
    await getDatabase()
      .update(workspaces)
      .set({ shareCalibration: false })
      .where(eq(workspaces.id, sharers));

    expect(await sharedPool(mine)).toEqual([]);
  });

  it("is off by default for a new workspace", async () => {
    const workspaceId = await makeWorkspace("Fresh");
    const [row] = await getDatabase()
      .select({ share: workspaces.shareCalibration })
      .from(workspaces)
      .where(eq(workspaces.id, workspaceId));
    expect(row?.share).toBe(false);
  });

  it("is the workspace owner's switch, and nobody else's", async () => {
    const db = getDatabase();
    const workspaceId = await makeWorkspace("Acme");
    const [owner] = await db
      .insert(users)
      .values({ email: "owner@example.com" })
      .returning({ id: users.id });
    const [member] = await db
      .insert(users)
      .values({ email: "member@example.com" })
      .returning({ id: users.id });
    await db.insert(workspaceMembers).values([
      { workspaceId, userId: owner!.id, role: "owner" },
      { workspaceId, userId: member!.id, role: "editor" },
    ]);
    for (const [user, token] of [
      [owner!.id, "owner-token"],
      [member!.id, "member-token"],
    ] as const) {
      await db.insert(authSessions).values({
        sessionToken: token,
        userId: user,
        expires: new Date(Date.now() + 86_400_000),
      });
    }

    const patch = (token: string) =>
      patchWorkspace(
        new NextRequest(`http://localhost/api/workspaces/${workspaceId}`, {
          method: "PATCH",
          headers: {
            "content-type": "application/json",
            cookie: `authjs.session-token=${token}`,
          },
          body: JSON.stringify({ shareCalibration: true }),
        }),
        { params: Promise.resolve({ id: workspaceId }) },
      );

    expect((await patch("member-token")).status).toBe(401);
    expect((await patch("owner-token")).status).toBe(200);

    const [row] = await db
      .select({ share: workspaces.shareCalibration })
      .from(workspaces)
      .where(eq(workspaces.id, workspaceId));
    expect(row?.share).toBe(true);
  });
});

describe("what the workspace keeps to itself", () => {
  it("reads its own notes and module names back, because they never left", async () => {
    const workspaceId = await makeWorkspace("Acme");
    const id = "33333333-0000-4000-8000-00000000000a";
    await approvedProject({ id, workspaceId, moduleName: SECRET_MODULE });
    await postActuals(post(id, actualsBody()), params(id));

    const records = await workspaceRecords(workspaceId);
    expect(records).toHaveLength(1);
    const [row] = await getDatabase()
      .select({ note: projectActuals.note })
      .from(projectActuals)
      .where(eq(projectActuals.projectId, id));
    expect(row?.note).toBe(SECRET_NOTE);
  });
});

describe("the estimate engine, through the pipeline", () => {
  /** Five recorded projects that each took half again as long as estimated. */
  async function workspaceThatRunsLate(): Promise<string> {
    const workspaceId = await makeWorkspace("Acme");
    for (let i = 0; i < MIN_PROJECTS; i += 1) {
      const id = `44444444-0000-4000-8000-00000000000${i.toString(16)}`;
      await approvedProject({ id, workspaceId, domain: "SaaS", sprints: 4 });
      await postActuals(
        post(id, actualsBody({ actualWeeks: 12 })), // 6 sprints against 4
        params(id),
      );
    }
    return workspaceId;
  }

  it("adjusts a new estimate by what the workspace's projects actually took", async () => {
    const workspaceId = await workspaceThatRunsLate();

    const id = "55555555-0000-4000-8000-00000000000a";
    await approvedProject({ id, workspaceId, domain: "SaaS" });
    const session = await getSession(id);
    const view = await generateEngineerView(session!);

    expect(view.effort_summary.calibration).toMatchObject({
      projects: MIN_PROJECTS,
      source: "workspace",
    });
    expect(view.effort_summary.calibration!.multiplier).toBeGreaterThan(1);
  });

  it("leaves a workspace with no history alone", async () => {
    const workspaceId = await makeWorkspace("Fresh");
    const id = "55555555-0000-4000-8000-00000000000b";
    await approvedProject({ id, workspaceId, domain: "SaaS" });
    const session = await getSession(id);
    const view = await generateEngineerView(session!);

    expect(view.effort_summary.calibration).toBeNull();
  });
});
