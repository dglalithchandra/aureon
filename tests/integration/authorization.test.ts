import { NextRequest, type NextResponse } from "next/server";
import { beforeEach, describe, expect, it } from "vitest";
import {
  GET as getSessionRoute,
  PATCH as patchRoute,
} from "@/app/api/session/[id]/route";
import { POST as runRoute } from "@/app/api/session/[id]/run/route";
import { POST as answerRoute } from "@/app/api/session/[id]/answer/route";
import { POST as describeRoute } from "@/app/api/session/[id]/describe/route";
import { POST as clarifyRoute } from "@/app/api/session/[id]/clarify/route";
import { POST as finalizeRoute } from "@/app/api/finalize/route";
import { POST as shareRoute } from "@/app/api/share/route";
import { GET as listProjectsRoute } from "@/app/api/projects/route";
import {
  DELETE as deleteProjectRoute,
  PATCH as renameProjectRoute,
} from "@/app/api/projects/[id]/route";
import { POST as duplicateRoute } from "@/app/api/projects/[id]/duplicate/route";
import { getDatabase } from "@/lib/db/client";
import {
  authSessions,
  projects,
  users,
  workspaceMembers,
  workspaces,
} from "@/lib/db/schema";
import { putSession } from "@/lib/storage/session";
import { buildOwnerCookie, OWNER_COOKIE_NAME } from "@/lib/security/session-cookie";
import type { WorkspaceRole } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { truncateAll } from "../helpers/db";
import {
  makeClientView,
  makeEngineerView,
  makeRound,
  makeSession,
} from "../fixtures/llm";

/**
 * The authorisation matrix: owner, editor, viewer, another account and an
 * anonymous browser, against every route that touches a project.
 *
 * Signing in is simulated the way the app reads it — a row in auth_sessions
 * and the matching cookie — so the routes run their real checks.
 */

const PROJECT_ID = "aaaaaaaa-0000-4000-8000-00000000000a";
const ANON = "c0ffee00-0000-4000-8000-0000000000aa";
const OTHER_ANON = "deadbeef-0000-4000-8000-0000000000bb";

interface Account {
  userId: string;
  cookie: string;
}

async function makeAccount(email: string): Promise<Account> {
  const db = getDatabase();
  const [user] = await db.insert(users).values({ email }).returning({ id: users.id });
  const token = `token-${email}`;
  await db.insert(authSessions).values({
    sessionToken: token,
    userId: user!.id,
    expires: new Date(Date.now() + 86_400_000),
  });
  return { userId: user!.id, cookie: `authjs.session-token=${token}` };
}

const anonCookie = (id: string) => `${OWNER_COOKIE_NAME}=${buildOwnerCookie(id).value}`;

/** A finalized project owned by `owner`, inside `workspace`. */
async function seedProject(options: {
  userId?: string | null;
  workspaceId?: string | null;
  anonOwnerId?: string | null;
  status?: "ready" | "finalized";
}): Promise<void> {
  const session = makeSession({
    id: PROJECT_ID,
    raw_input: "A marketplace for handmade crafts, with seller payouts.",
    status: options.status ?? "finalized",
    pipeline_stage: null,
    owner_id: options.anonOwnerId ?? null,
    rounds: [makeRound()],
    final_output: { client: makeClientView(), engineer: makeEngineerView() },
  });
  await putSession(session);
  await getDatabase()
    .update(projects)
    .set({
      userId: options.userId ?? null,
      workspaceId: options.workspaceId ?? null,
    })
    .where(eq(projects.id, PROJECT_ID));
}

async function makeWorkspace(ownerId: string): Promise<string> {
  const [workspace] = await getDatabase()
    .insert(workspaces)
    .values({ name: "Acme" })
    .returning({ id: workspaces.id });
  await getDatabase()
    .insert(workspaceMembers)
    .values({ workspaceId: workspace!.id, userId: ownerId, role: "owner" });
  return workspace!.id;
}

async function addMember(
  workspaceId: string,
  userId: string,
  role: WorkspaceRole,
): Promise<void> {
  await getDatabase().insert(workspaceMembers).values({ workspaceId, userId, role });
}

/* ── the routes under test, each as a thunk taking a cookie ────────── */

const json = { "content-type": "application/json" };

let ip = 0;

/**
 * One request. Each gets its own client IP: the LLM routes rate-limit before
 * they check access, and a shared bucket would answer 429 where this suite
 * is asking about 401.
 */
function req(
  path: string,
  init: { method?: string; body?: string; cookie?: string } = {},
): NextRequest {
  const { cookie, ...rest } = init;
  ip += 1;
  return new NextRequest(`http://localhost${path}`, {
    ...rest,
    headers: {
      ...json,
      "x-forwarded-for": `10.0.${Math.floor(ip / 250)}.${ip % 250}`,
      ...(cookie ? { cookie } : {}),
    },
  });
}

const params = { params: Promise.resolve({ id: PROJECT_ID }) };

const ROUTES: Record<string, (cookie: string) => Promise<NextResponse>> = {
  "GET /api/session/:id": (cookie) =>
    getSessionRoute(req(`/api/session/${PROJECT_ID}`, { cookie }), params),
  "PATCH /api/session/:id": (cookie) =>
    patchRoute(
      req(`/api/session/${PROJECT_ID}`, {
        method: "PATCH",
        cookie,
        body: JSON.stringify({
          final_output: { client: makeClientView(), engineer: makeEngineerView() },
        }),
      }),
      params,
    ),
  "POST /api/session/:id/run": (cookie) =>
    runRoute(req(`/api/session/${PROJECT_ID}/run`, { method: "POST", cookie }), params),
  "POST /api/session/:id/answer": (cookie) =>
    answerRoute(
      req(`/api/session/${PROJECT_ID}/answer`, {
        method: "POST",
        cookie,
        body: JSON.stringify({ answers: [] }),
      }),
      params,
    ),
  "POST /api/session/:id/describe": (cookie) =>
    describeRoute(
      req(`/api/session/${PROJECT_ID}/describe`, {
        method: "POST",
        cookie,
        body: JSON.stringify({ addedDescription: "More detail about the project." }),
      }),
      params,
    ),
  "POST /api/session/:id/clarify": (cookie) =>
    clarifyRoute(
      req(`/api/session/${PROJECT_ID}/clarify`, {
        method: "POST",
        cookie,
        body: JSON.stringify({ question: "Budget?", answer: "40,000 dollars." }),
      }),
      params,
    ),
  "PATCH /api/projects/:id": (cookie) =>
    renameProjectRoute(
      req(`/api/projects/${PROJECT_ID}`, {
        method: "PATCH",
        cookie,
        body: JSON.stringify({ title: "Renamed by the matrix" }),
      }),
      params,
    ),
  "POST /api/finalize": (cookie) =>
    finalizeRoute(
      req("/api/finalize", {
        method: "POST",
        cookie,
        body: JSON.stringify({ sessionId: PROJECT_ID }),
      }),
    ),
  "POST /api/share": (cookie) =>
    shareRoute(
      req("/api/share", {
        method: "POST",
        cookie,
        body: JSON.stringify({ sessionId: PROJECT_ID }),
      }),
    ),
  "POST /api/projects/:id/duplicate": (cookie) =>
    duplicateRoute(
      req(`/api/projects/${PROJECT_ID}/duplicate`, { method: "POST", cookie }),
      params,
    ),
  "DELETE /api/projects/:id": (cookie) =>
    deleteProjectRoute(
      req(`/api/projects/${PROJECT_ID}`, { method: "DELETE", cookie }),
      params,
    ),
};

/** Every route that needs at least read access. */
const READ_ROUTES = ["GET /api/session/:id", "POST /api/projects/:id/duplicate"] as const;
/** Every route that changes the project. */
const WRITE_ROUTES = [
  "PATCH /api/session/:id",
  "POST /api/session/:id/run",
  "POST /api/session/:id/answer",
  "POST /api/session/:id/describe",
  "POST /api/session/:id/clarify",
  "PATCH /api/projects/:id",
  "POST /api/finalize",
  "POST /api/share",
] as const;
const DELETE_ROUTES = ["DELETE /api/projects/:id"] as const;

/** 401 is the only "no" we accept; anything else means the check was skipped. */
async function statusOf(route: string, cookie: string): Promise<number> {
  return (await ROUTES[route]!(cookie)).status;
}

beforeEach(async () => {
  await truncateAll();
});

describe("an anonymous project", () => {
  beforeEach(async () => {
    await seedProject({ anonOwnerId: ANON });
  });

  it.each([...READ_ROUTES, ...WRITE_ROUTES, ...DELETE_ROUTES])(
    "%s: the browser that made it is allowed",
    async (route) => {
      expect(await statusOf(route, anonCookie(ANON))).not.toBe(401);
    },
  );

  it.each([...READ_ROUTES, ...WRITE_ROUTES, ...DELETE_ROUTES])(
    "%s: another browser is refused",
    async (route) => {
      expect(await statusOf(route, anonCookie(OTHER_ANON))).toBe(401);
    },
  );

  it.each([...READ_ROUTES, ...WRITE_ROUTES, ...DELETE_ROUTES])(
    "%s: no cookie at all is refused",
    async (route) => {
      expect(await statusOf(route, "")).toBe(401);
    },
  );

  it.each([...READ_ROUTES, ...WRITE_ROUTES, ...DELETE_ROUTES])(
    "%s: a signed-in stranger is refused",
    async (route) => {
      const stranger = await makeAccount("stranger@example.com");
      expect(await statusOf(route, stranger.cookie)).toBe(401);
    },
  );
});

describe("a project owned by an account", () => {
  let owner: Account;

  beforeEach(async () => {
    owner = await makeAccount("owner@example.com");
    await seedProject({ userId: owner.userId });
  });

  it.each([...READ_ROUTES, ...WRITE_ROUTES, ...DELETE_ROUTES])(
    "%s: the owner is allowed",
    async (route) => {
      expect(await statusOf(route, owner.cookie)).not.toBe(401);
    },
  );

  it.each([...READ_ROUTES, ...WRITE_ROUTES, ...DELETE_ROUTES])(
    "%s: another account is refused",
    async (route) => {
      const stranger = await makeAccount("stranger@example.com");
      expect(await statusOf(route, stranger.cookie)).toBe(401);
    },
  );

  it.each([...READ_ROUTES, ...WRITE_ROUTES, ...DELETE_ROUTES])(
    "%s: the anonymous browser that no longer owns it is refused",
    async (route) => {
      // The project was claimed by the account; the old cookie loses access.
      expect(await statusOf(route, anonCookie(ANON))).toBe(401);
    },
  );

  it("an expired login is not a login", async () => {
    await getDatabase()
      .update(authSessions)
      .set({ expires: new Date(Date.now() - 1000) })
      .where(eq(authSessions.userId, owner.userId));
    expect(await statusOf("GET /api/session/:id", owner.cookie)).toBe(401);
  });

  it("an unknown session token is not a login", async () => {
    expect(await statusOf("GET /api/session/:id", "authjs.session-token=nope")).toBe(401);
  });
});

describe("a project in a workspace", () => {
  let owner: Account;
  let editor: Account;
  let viewer: Account;

  beforeEach(async () => {
    owner = await makeAccount("owner@example.com");
    editor = await makeAccount("editor@example.com");
    viewer = await makeAccount("viewer@example.com");
    const workspaceId = await makeWorkspace(owner.userId);
    await addMember(workspaceId, editor.userId, "editor");
    await addMember(workspaceId, viewer.userId, "viewer");
    await seedProject({ userId: owner.userId, workspaceId });
  });

  it.each([...READ_ROUTES, ...WRITE_ROUTES])(
    "%s: an editor is allowed",
    async (route) => {
      expect(await statusOf(route, editor.cookie)).not.toBe(401);
    },
  );

  it.each(DELETE_ROUTES)("%s: an editor is refused", async (route) => {
    expect(await statusOf(route, editor.cookie)).toBe(401);
  });

  it.each(READ_ROUTES)("%s: a viewer is allowed", async (route) => {
    expect(await statusOf(route, viewer.cookie)).not.toBe(401);
  });

  it.each([...WRITE_ROUTES, ...DELETE_ROUTES])(
    "%s: a viewer is refused",
    async (route) => {
      expect(await statusOf(route, viewer.cookie)).toBe(401);
    },
  );

  it.each([...READ_ROUTES, ...WRITE_ROUTES, ...DELETE_ROUTES])(
    "%s: someone outside the workspace is refused",
    async (route) => {
      const outsider = await makeAccount("outsider@example.com");
      expect(await statusOf(route, outsider.cookie)).toBe(401);
    },
  );
});

describe("the projects list", () => {
  async function list(cookie: string, query = ""): Promise<{ projects: unknown[] }> {
    const res = await listProjectsRoute(
      req(`/api/projects${query ? `?q=${query}` : ""}`, { cookie }),
    );
    return (await res.json()) as { projects: unknown[] };
  }

  it("shows a browser only its own projects", async () => {
    await seedProject({ anonOwnerId: ANON });
    expect((await list(anonCookie(ANON))).projects).toHaveLength(1);
    expect((await list(anonCookie(OTHER_ANON))).projects).toHaveLength(0);
    expect((await list("")).projects).toHaveLength(0);
  });

  it("shows an account its own projects and its workspaces'", async () => {
    const owner = await makeAccount("owner@example.com");
    const member = await makeAccount("member@example.com");
    const workspaceId = await makeWorkspace(owner.userId);
    await addMember(workspaceId, member.userId, "viewer");
    await seedProject({ userId: owner.userId, workspaceId });

    expect((await list(owner.cookie)).projects).toHaveLength(1);
    expect((await list(member.cookie)).projects).toHaveLength(1);

    const outsider = await makeAccount("outsider@example.com");
    expect((await list(outsider.cookie)).projects).toHaveLength(0);
  });

  it("searches the title and the client's own words", async () => {
    await seedProject({ anonOwnerId: ANON });
    expect((await list(anonCookie(ANON), "marketplace")).projects.length).toBeGreaterThan(
      0,
    );
    expect((await list(anonCookie(ANON), "nothing-like-this")).projects).toHaveLength(0);
  });
});
