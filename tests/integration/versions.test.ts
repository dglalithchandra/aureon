import { NextRequest, type NextResponse } from "next/server";
import { beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { PATCH as patchRoute } from "@/app/api/session/[id]/route";
import { POST as shareRoute } from "@/app/api/share/route";
import { GET as listSharesRoute } from "@/app/api/share/route";
import { DELETE as revokeRoute } from "@/app/api/share/[token]/route";
import { POST as decisionRoute } from "@/app/api/share/[token]/decision/route";
import { GET as versionsRoute } from "@/app/api/projects/[id]/versions/route";
import { getDatabase } from "@/lib/db/client";
import { approvals, auditLog, versions } from "@/lib/db/schema";
import { putSession } from "@/lib/storage/session";
import { resolveShareToken } from "@/lib/storage/share";
import {
  getVersion,
  latestVersion,
  listVersions,
  recordVersion,
} from "@/lib/versions/store";
import { hashIp } from "@/lib/versions/approval";
import { buildOwnerCookie, OWNER_COOKIE_NAME } from "@/lib/security/session-cookie";
import type { FinalOutput } from "@/lib/schemas/output";
import { truncateAll } from "../helpers/db";
import {
  makeClientView,
  makeEngineerView,
  makeRound,
  makeSession,
} from "../fixtures/llm";

/**
 * Blueprint steps 13 and 14: versions that cannot be rewritten, a client
 * approval that locks one, and a link that can approve but never edit.
 */

const PROJECT = "aaaaaaaa-0000-4000-8000-00000000000a";
const OWNER = "c0ffee00-0000-4000-8000-0000000000aa";
const owner = `${OWNER_COOKIE_NAME}=${buildOwnerCookie(OWNER).value}`;

/** Drizzle wraps a failed statement; the trigger's message is the cause. */
async function rejectionText(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
    return "(it did not reject)";
  } catch (err) {
    const parts = [err instanceof Error ? err.message : String(err)];
    let cause: unknown = err instanceof Error ? err.cause : null;
    while (cause instanceof Error) {
      parts.push(cause.message);
      cause = cause.cause;
    }
    return parts.join(" | ");
  }
}

let ip = 0;
function req(
  path: string,
  init: { method?: string; body?: string; cookie?: string } = {},
) {
  const { cookie, ...rest } = init;
  ip += 1;
  return new NextRequest(`http://localhost${path}`, {
    ...rest,
    headers: {
      "content-type": "application/json",
      "x-forwarded-for": `10.1.${Math.floor(ip / 250)}.${ip % 250}`,
      ...(cookie ? { cookie } : {}),
    },
  });
}

/**
 * A document whose summary carries `marker`. The summary is a real sentence
 * because ClientViewSchema asks for at least 20 characters — the same guard
 * that stops a half-written document being stored as a version.
 */
function outputWith(marker: string, score = 78): FinalOutput {
  const client = makeClientView();
  return {
    client: {
      ...client,
      project_summary: `${marker}: a marketplace for handmade crafts with seller payouts.`,
      confidence_badge: { ...client.confidence_badge, score },
    },
    engineer: makeEngineerView(),
  };
}

async function seedProject(): Promise<FinalOutput> {
  const output = outputWith("The original summary");
  await putSession(
    makeSession({
      id: PROJECT,
      status: "finalized",
      pipeline_stage: null,
      owner_id: OWNER,
      rounds: [makeRound()],
      final_output: output,
    }),
  );
  return output;
}

beforeEach(async () => {
  await truncateAll();
});

describe("versions are immutable", () => {
  it("refuses to rewrite the stored document", async () => {
    await seedProject();
    const version = await recordVersion({
      projectId: PROJECT,
      output: outputWith("First"),
      reason: "generated",
      confidence: 70,
    });

    // The database says no, not only the code.
    const message = await rejectionText(
      getDatabase()
        .update(versions)
        .set({ output: outputWith("Rewritten") })
        .where(eq(versions.id, version!.id)),
    );
    expect(message).toMatch(/immutable/i);

    const stored = await getVersion(PROJECT, 1);
    expect(stored?.output.client.project_summary).toContain("First");
    expect(stored?.output.client.project_summary).not.toContain("Rewritten");
  });

  it.each([
    ["version_number", { versionNumber: 99 }],
    ["reason", { reason: "edited" as const }],
    ["confidence", { confidence: 1 }],
  ])("refuses to rewrite %s", async (_field, patch) => {
    await seedProject();
    const version = await recordVersion({
      projectId: PROJECT,
      output: outputWith("First"),
      reason: "generated",
      confidence: 70,
    });

    const message = await rejectionText(
      getDatabase().update(versions).set(patch).where(eq(versions.id, version!.id)),
    );
    expect(message).toMatch(/immutable/i);
  });

  it("numbers versions in order and never reuses a number", async () => {
    await seedProject();
    for (const summary of ["one", "two", "three"]) {
      await recordVersion({
        projectId: PROJECT,
        output: outputWith(summary),
        reason: "edited",
        confidence: 70,
      });
    }
    expect((await listVersions(PROJECT)).map((v) => v.versionNumber)).toEqual([1, 2, 3]);
  });

  it("does not record a version when nothing changed", async () => {
    await seedProject();
    const output = outputWith("Same");
    await recordVersion({
      projectId: PROJECT,
      output,
      reason: "generated",
      confidence: 70,
    });
    const second = await recordVersion({
      projectId: PROJECT,
      output,
      reason: "edited",
      confidence: 70,
    });

    expect(second).toBeNull();
    expect(await listVersions(PROJECT)).toHaveLength(1);
  });
});

describe("a saved edit becomes a version", () => {
  it("records what the owner changed by hand", async () => {
    await seedProject();
    const edited = outputWith("An edited summary");

    const res = await patchRoute(
      req(`/api/session/${PROJECT}`, {
        method: "PATCH",
        cookie: owner,
        body: JSON.stringify({ final_output: edited }),
      }),
      { params: Promise.resolve({ id: PROJECT }) },
    );
    expect(res.status).toBe(200);

    const stored = await listVersions(PROJECT);
    expect(stored).toHaveLength(1);
    expect(stored[0]).toMatchObject({ versionNumber: 1, reason: "edited" });
    expect((await getVersion(PROJECT, 1))?.output.client.project_summary).toContain(
      "An edited summary",
    );
  });

  it("is listed by the versions route, for anyone who may read the project", async () => {
    await seedProject();
    await recordVersion({
      projectId: PROJECT,
      output: outputWith("v1"),
      reason: "generated",
      confidence: 70,
    });

    const res = await versionsRoute(
      req(`/api/projects/${PROJECT}/versions`, { cookie: owner }),
      {
        params: Promise.resolve({ id: PROJECT }),
      },
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { versions: Array<{ versionNumber: number }> };
    expect(body.versions).toHaveLength(1);

    // Another browser has no business reading them.
    const stranger = await versionsRoute(
      req(`/api/projects/${PROJECT}/versions`, {
        cookie: `${OWNER_COOKIE_NAME}=${buildOwnerCookie("deadbeef-0000-4000-8000-0000000000bb").value}`,
      }),
      { params: Promise.resolve({ id: PROJECT }) },
    );
    expect(stranger.status).toBe(401);
  });
});

describe("approval", () => {
  async function approvalLink(): Promise<string> {
    await seedProject();
    await recordVersion({
      projectId: PROJECT,
      output: outputWith("The version under review"),
      reason: "generated",
      confidence: 78,
    });
    const res = await shareRoute(
      req("/api/share", {
        method: "POST",
        cookie: owner,
        body: JSON.stringify({ sessionId: PROJECT, mode: "approval", expiresInDays: 7 }),
      }),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      token: string;
      mode: string;
      version_number: number;
    };
    expect(body.mode).toBe("approval");
    expect(body.version_number).toBe(1);
    return body.token;
  }

  function decide(token: string, body: Record<string, unknown>): Promise<NextResponse> {
    return decisionRoute(
      req(`/api/share/${token}/decision`, {
        method: "POST",
        body: JSON.stringify(body),
      }),
      { params: Promise.resolve({ token }) },
    );
  }

  it("locks the version, labels it, and keeps who approved it", async () => {
    const token = await approvalLink();

    const res = await decide(token, {
      decision: "approved",
      name: "Priya Nair",
      email: "priya@example.com",
      comment: "Looks right to me.",
    });
    expect(res.status).toBe(200);

    const version = await latestVersion(PROJECT);
    expect(version?.lockedAt).not.toBeNull();
    expect(version?.approvedBy).toBe("Priya Nair");
    expect(version?.label).toMatch(/^Approved v1 — \d{1,2} \w+ \d{4}$/);

    const [approval] = await getDatabase()
      .select()
      .from(approvals)
      .where(eq(approvals.projectId, PROJECT));
    expect(approval).toMatchObject({
      state: "approved",
      approverName: "Priya Nair",
      approverEmail: "priya@example.com",
      versionNumber: 1,
    });
    // The address itself is never stored, only a hash of it.
    expect(approval?.approverIpHash).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.stringify(approval)).not.toContain("10.1.");
  });

  it("writes an audit row for the decision", async () => {
    const token = await approvalLink();
    await decide(token, { decision: "approved", name: "Priya" });

    const rows = await getDatabase()
      .select()
      .from(auditLog)
      .where(eq(auditLog.subjectId, PROJECT));
    expect(rows.map((r) => r.action)).toContain("approval.approved");
  });

  it("keeps the first approval when a second arrives", async () => {
    const token = await approvalLink();
    await decide(token, { decision: "approved", name: "First" });
    const lockedAt = (await latestVersion(PROJECT))?.lockedAt;

    await decide(token, { decision: "approved", name: "Second" });
    const after = await latestVersion(PROJECT);
    expect(after?.approvedBy).toBe("First");
    expect(after?.lockedAt).toBe(lockedAt);
  });

  it("records a request for changes without locking anything", async () => {
    const token = await approvalLink();

    const res = await decide(token, {
      decision: "changes_requested",
      name: "Rahul",
      comment: "Payouts should be weekly, not monthly.",
    });
    expect(res.status).toBe(200);

    expect((await latestVersion(PROJECT))?.lockedAt).toBeNull();
    const [note] = await getDatabase()
      .select()
      .from(approvals)
      .where(eq(approvals.projectId, PROJECT));
    expect(note).toMatchObject({
      state: "changes_requested",
      comment: "Payouts should be weekly, not monthly.",
    });
  });

  it("needs a name", async () => {
    const token = await approvalLink();
    expect((await decide(token, { decision: "approved", name: "" })).status).toBe(400);
  });

  it("refuses a decision through a read-only link", async () => {
    await seedProject();
    await recordVersion({
      projectId: PROJECT,
      output: outputWith("v1"),
      reason: "generated",
      confidence: 70,
    });
    const res = await shareRoute(
      req("/api/share", {
        method: "POST",
        cookie: owner,
        body: JSON.stringify({ sessionId: PROJECT }),
      }),
    );
    const { token } = (await res.json()) as { token: string };

    const decision = await decide(token, { decision: "approved", name: "Someone" });
    expect(decision.status).toBe(400);
    expect(await getDatabase().select().from(approvals)).toEqual([]);
  });

  it("refuses a decision through a revoked link", async () => {
    const token = await approvalLink();
    await revokeRoute(req(`/api/share/${token}`, { method: "DELETE", cookie: owner }), {
      params: Promise.resolve({ token }),
    });

    expect((await decide(token, { decision: "approved", name: "Someone" })).status).toBe(
      404,
    );
  });

  it("hashes the same address to the same value, and a different one differently", () => {
    expect(hashIp("203.0.113.1")).toBe(hashIp("203.0.113.1"));
    expect(hashIp("203.0.113.1")).not.toBe(hashIp("203.0.113.2"));
    expect(hashIp("203.0.113.1")).not.toContain("203");
  });
});

describe("an approval link cannot edit anything", () => {
  it("has no power over the project, only over the decision", async () => {
    await seedProject();
    await recordVersion({
      projectId: PROJECT,
      output: outputWith("v1"),
      reason: "generated",
      confidence: 70,
    });
    const created = await shareRoute(
      req("/api/share", {
        method: "POST",
        cookie: owner,
        body: JSON.stringify({ sessionId: PROJECT, mode: "approval" }),
      }),
    );
    const { token } = (await created.json()) as { token: string };

    // Holding the link is not holding the project: every write refuses it,
    // with or without the token as a cookie.
    const asClient = `share_token=${token}`;
    const edit = await patchRoute(
      req(`/api/session/${PROJECT}`, {
        method: "PATCH",
        cookie: asClient,
        body: JSON.stringify({ final_output: outputWith("Rewritten by the client") }),
      }),
      { params: Promise.resolve({ id: PROJECT }) },
    );
    expect(edit.status).toBe(401);

    const revoke = await revokeRoute(
      req(`/api/share/${token}`, { method: "DELETE", cookie: asClient }),
      { params: Promise.resolve({ token }) },
    );
    expect(revoke.status).toBe(401);

    const listed = await listSharesRoute(
      req(`/api/share?sessionId=${PROJECT}`, { cookie: asClient }),
    );
    expect(listed.status).toBe(401);

    // And the document it shows is still the one that was shared.
    expect(
      (await resolveShareToken(token))?.final_output.client.project_summary,
    ).toContain("The original summary");
  });
});

describe("share management", () => {
  it("lists live links with their mode and expiry, and drops a revoked one", async () => {
    await seedProject();
    await recordVersion({
      projectId: PROJECT,
      output: outputWith("v1"),
      reason: "generated",
      confidence: 70,
    });

    const view = await shareRoute(
      req("/api/share", {
        method: "POST",
        cookie: owner,
        body: JSON.stringify({ sessionId: PROJECT, expiresInDays: 7 }),
      }),
    );
    const viewLink = (await view.json()) as { token: string; expires_at: number };
    const approval = await shareRoute(
      req("/api/share", {
        method: "POST",
        cookie: owner,
        body: JSON.stringify({ sessionId: PROJECT, mode: "approval", expiresInDays: 90 }),
      }),
    );
    const approvalLink = (await approval.json()) as { token: string; expires_at: number };

    // 7 days and 90 days, as asked for.
    const week = 7 * 24 * 60 * 60 * 1000;
    expect(viewLink.expires_at - Date.now()).toBeGreaterThan(week - 60_000);
    expect(viewLink.expires_at - Date.now()).toBeLessThan(week + 60_000);
    expect(approvalLink.expires_at - viewLink.expires_at).toBeGreaterThan(
      80 * 24 * 3600_000,
    );

    const listed = await listSharesRoute(
      req(`/api/share?sessionId=${PROJECT}`, { cookie: owner }),
    );
    const body = (await listed.json()) as {
      shares: Array<{ token: string; mode: string; active: boolean }>;
    };
    expect(body.shares).toHaveLength(2);
    expect(body.shares.find((s) => s.token === approvalLink.token)).toMatchObject({
      mode: "approval",
      active: true,
    });

    await revokeRoute(
      req(`/api/share/${viewLink.token}`, { method: "DELETE", cookie: owner }),
      { params: Promise.resolve({ token: viewLink.token }) },
    );
    const after = await listSharesRoute(
      req(`/api/share?sessionId=${PROJECT}`, { cookie: owner }),
    );
    expect(((await after.json()) as { shares: unknown[] }).shares).toHaveLength(1);
  });

  it("reuses the active read-only link instead of making another", async () => {
    await seedProject();
    const first = await shareRoute(
      req("/api/share", {
        method: "POST",
        cookie: owner,
        body: JSON.stringify({ sessionId: PROJECT }),
      }),
    );
    const second = await shareRoute(
      req("/api/share", {
        method: "POST",
        cookie: owner,
        body: JSON.stringify({ sessionId: PROJECT }),
      }),
    );
    const a = (await first.json()) as { token: string };
    const b = (await second.json()) as { token: string; reused: boolean };
    expect(b.token).toBe(a.token);
    expect(b.reused).toBe(true);
  });
});
