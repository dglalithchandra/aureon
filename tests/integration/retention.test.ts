import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { POST as cronRoute } from "@/app/api/cron/retention/route";
import { PATCH as workspaceRoute } from "@/app/api/workspaces/[id]/route";
import { getDatabase } from "@/lib/db/client";
import {
  auditLog,
  DEFAULT_RAW_INPUT_RETENTION_DAYS,
  projects,
  users,
  authSessions,
  workspaceMembers,
  workspaces,
} from "@/lib/db/schema";
import { getSession, putSession } from "@/lib/storage/session";
import { runRetention } from "@/lib/retention/run";
import { truncateAll } from "../helpers/db";
import {
  makeClientView,
  makeEngineerView,
  makeRound,
  makeSession,
} from "../fixtures/llm";

/**
 * Retention: the client's own words go after the workspace's period; the
 * documents made from them stay.
 */

const DAY = 24 * 60 * 60 * 1000;

beforeEach(async () => {
  await truncateAll();
});

/** A project last touched `ageDays` ago. */
async function seed(options: {
  id: string;
  ageDays: number;
  workspaceId?: string | null;
}): Promise<void> {
  const session = makeSession({
    id: options.id,
    raw_input: "A marketplace for handmade crafts, with seller payouts.",
    enriched_input: "A marketplace for handmade crafts, plus answers.",
    status: "finalized",
    pipeline_stage: null,
    rounds: [makeRound()],
    final_output: { client: makeClientView(), engineer: makeEngineerView() },
  });
  await putSession(session);
  await getDatabase()
    .update(projects)
    .set({
      workspaceId: options.workspaceId ?? null,
      updatedAt: new Date(Date.now() - options.ageDays * DAY),
    })
    .where(eq(projects.id, options.id));
}

async function rowOf(id: string) {
  const [row] = await getDatabase().select().from(projects).where(eq(projects.id, id));
  return row;
}

describe("the default period", () => {
  it("clears raw input older than 90 days and keeps the documents", async () => {
    const id = "aaaaaaaa-0000-4000-8000-00000000000a";
    await seed({ id, ageDays: DEFAULT_RAW_INPUT_RETENTION_DAYS + 1 });

    const result = await runRetention();
    expect(result.cleared).toBe(1);

    const row = await rowOf(id);
    expect(row?.rawInput).toBe("");
    expect(row?.enrichedInput).toBe("");
    expect(row?.rawInputDeletedAt).toBeInstanceOf(Date);
    // The deliverable survives: that is the whole point of keeping it.
    expect(row?.finalOutput).not.toBeNull();
    expect(row?.title).toBe("A marketplace for handmade crafts, with seller payouts");
  });

  it("leaves a project inside the period alone", async () => {
    const id = "bbbbbbbb-0000-4000-8000-00000000000b";
    await seed({ id, ageDays: DEFAULT_RAW_INPUT_RETENTION_DAYS - 1 });

    expect((await runRetention()).cleared).toBe(0);
    expect((await rowOf(id))?.rawInput).not.toBe("");
  });

  it("records every deletion in the audit log", async () => {
    const id = "cccccccc-0000-4000-8000-00000000000c";
    await seed({ id, ageDays: 200 });
    await runRetention();

    const rows = await getDatabase()
      .select()
      .from(auditLog)
      .where(eq(auditLog.subjectId, id));
    expect(rows).toHaveLength(1);
    expect(rows[0]?.action).toBe("retention.raw_input_deleted");
  });

  it("does not clear the same project twice", async () => {
    const id = "dddddddd-0000-4000-8000-00000000000d";
    await seed({ id, ageDays: 200 });

    expect((await runRetention()).cleared).toBe(1);
    expect((await runRetention()).cleared).toBe(0);
  });

  it("leaves the session readable afterwards", async () => {
    const id = "eeeeeeee-0000-4000-8000-00000000000e";
    await seed({ id, ageDays: 200 });
    await runRetention();

    // raw_input has a minimum length in the schema, so a cleared project is
    // no longer a valid session — the output page reads the stored document,
    // and the projects list reads the row.
    expect(await getSession(id)).toBeNull();
    expect((await rowOf(id))?.finalOutput).not.toBeNull();
  });
});

describe("a workspace's own period", () => {
  async function workspace(days: number): Promise<string> {
    const [row] = await getDatabase()
      .insert(workspaces)
      .values({ name: "Acme", rawInputRetentionDays: days })
      .returning({ id: workspaces.id });
    return row!.id;
  }

  it("uses the configured number of days", async () => {
    const id = "11111111-0000-4000-8000-000000000001";
    const workspaceId = await workspace(7);
    await seed({ id, ageDays: 10, workspaceId });

    expect((await runRetention()).cleared).toBe(1);
    expect((await rowOf(id))?.rawInput).toBe("");
  });

  it("keeps raw input indefinitely when the period is 0", async () => {
    const id = "22222222-0000-4000-8000-000000000002";
    const workspaceId = await workspace(0);
    await seed({ id, ageDays: 5000, workspaceId });

    expect((await runRetention()).cleared).toBe(0);
    expect((await rowOf(id))?.rawInput).not.toBe("");
  });

  it("does not touch another workspace's projects", async () => {
    const strict = await workspace(1);
    const relaxed = await workspace(365);
    await seed({
      id: "33333333-0000-4000-8000-000000000003",
      ageDays: 30,
      workspaceId: strict,
    });
    await seed({
      id: "44444444-0000-4000-8000-000000000004",
      ageDays: 30,
      workspaceId: relaxed,
    });

    await runRetention();
    expect((await rowOf("33333333-0000-4000-8000-000000000003"))?.rawInput).toBe("");
    expect((await rowOf("44444444-0000-4000-8000-000000000004"))?.rawInput).not.toBe("");
  });
});

describe("the cron endpoint", () => {
  function request(auth?: string): NextRequest {
    return new NextRequest("http://localhost/api/cron/retention", {
      method: "POST",
      headers: auth ? { authorization: auth } : {},
    });
  }

  it("refuses anything without the scheduler's secret", async () => {
    vi.stubEnv("CRON_SECRET", "cron-secret-0123456789abcdef");
    expect((await cronRoute(request())).status).toBe(401);
    expect((await cronRoute(request("Bearer wrong"))).status).toBe(401);
    vi.unstubAllEnvs();
  });

  it("refuses everything when no secret is configured", async () => {
    // Fail closed: a deployment that forgot CRON_SECRET must not expose a
    // job that deletes client text.
    expect((await cronRoute(request("Bearer anything"))).status).toBe(401);
  });

  it("runs with the right secret", async () => {
    vi.stubEnv("CRON_SECRET", "cron-secret-0123456789abcdef");
    await seed({ id: "55555555-0000-4000-8000-000000000005", ageDays: 200 });

    const res = await cronRoute(request("Bearer cron-secret-0123456789abcdef"));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ cleared: 1 });
    vi.unstubAllEnvs();
  });
});

describe("changing the setting", () => {
  async function account(email: string) {
    const db = getDatabase();
    const [user] = await db.insert(users).values({ email }).returning({ id: users.id });
    const token = `token-${email}`;
    await db.insert(authSessions).values({
      sessionToken: token,
      userId: user!.id,
      expires: new Date(Date.now() + DAY),
    });
    return { userId: user!.id, cookie: `authjs.session-token=${token}` };
  }

  function patch(workspaceId: string, cookie: string, days: number): Promise<Response> {
    return workspaceRoute(
      new NextRequest(`http://localhost/api/workspaces/${workspaceId}`, {
        method: "PATCH",
        headers: { "content-type": "application/json", cookie },
        body: JSON.stringify({ rawInputRetentionDays: days }),
      }),
      { params: Promise.resolve({ id: workspaceId }) },
    );
  }

  it("is owner only", async () => {
    const owner = await account("owner@example.com");
    const editor = await account("editor@example.com");
    const [workspace] = await getDatabase()
      .insert(workspaces)
      .values({ name: "Acme" })
      .returning({ id: workspaces.id });
    await getDatabase()
      .insert(workspaceMembers)
      .values([
        { workspaceId: workspace!.id, userId: owner.userId, role: "owner" },
        { workspaceId: workspace!.id, userId: editor.userId, role: "editor" },
      ]);

    expect((await patch(workspace!.id, editor.cookie, 7)).status).toBe(401);
    expect((await patch(workspace!.id, "", 7)).status).toBe(401);

    const res = await patch(workspace!.id, owner.cookie, 7);
    expect(res.status).toBe(200);

    const [row] = await getDatabase()
      .select()
      .from(workspaces)
      .where(eq(workspaces.id, workspace!.id));
    expect(row?.rawInputRetentionDays).toBe(7);
  });
});
