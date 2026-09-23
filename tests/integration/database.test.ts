import { beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { getDatabase } from "@/lib/db/client";
import {
  approvals,
  auditLog,
  llmUsage,
  projects,
  rounds as roundsTable,
  shares,
  versions,
} from "@/lib/db/schema";
import {
  deleteSession,
  deriveTitle,
  getSession,
  putSession,
} from "@/lib/storage/session";
import {
  createShareLink,
  findActiveShare,
  resolveShareToken,
  revokeShareLink,
} from "@/lib/storage/share";
import { projectTitle, renameProject } from "@/lib/projects/list";
import { truncateAll } from "../helpers/db";
import {
  makeClientView,
  makeEngineerView,
  makeExtraction,
  makeRound,
  makeSession,
} from "../fixtures/llm";

/**
 * The storage layer on Postgres. Same function signatures as the Redis
 * version; what is new is that the data is durable and related rows are
 * really related — so a delete has to take all of them.
 */

const OWNER = "c0ffee00-0000-4000-8000-0000000000aa";

beforeEach(async () => {
  await truncateAll();
});

function finalized() {
  return makeSession({
    id: "e0e0e0e0-0000-4000-8000-00000000000a",
    raw_input: "A marketplace for handmade crafts. Sellers list items, buyers check out.",
    status: "finalized",
    pipeline_stage: null,
    owner_id: OWNER,
    current_confidence: 82,
    rounds: [makeRound()],
    final_output: { client: makeClientView(), engineer: makeEngineerView() },
  });
}

describe("a session round-trips through the database", () => {
  it("stores every field, including the JSONB documents", async () => {
    const session = finalized();
    await putSession(session);

    const back = await getSession(session.id);
    expect(back).toEqual(session);
  });

  it("keeps the rounds in order and rewrites them in place", async () => {
    const session = makeSession({
      rounds: [makeRound({ round_number: 0 }), makeRound({ round_number: 1 })],
    });
    await putSession(session);

    const answered = {
      ...session,
      rounds: [
        {
          ...session.rounds[0]!,
          answers: [
            {
              question_id: "11111111-1111-4111-8111-111111111111",
              selected_options: ["Stripe"],
              custom_text: null,
            },
          ],
        },
        session.rounds[1]!,
      ],
    };
    await putSession(answered);

    const back = await getSession(session.id);
    expect(back?.rounds.map((r) => r.round_number)).toEqual([0, 1]);
    expect(back?.rounds[0]?.answers[0]?.selected_options).toEqual(["Stripe"]);
    // Rewritten, not duplicated.
    const rows = await getDatabase()
      .select()
      .from(roundsTable)
      .where(eq(roundsTable.projectId, session.id));
    expect(rows).toHaveLength(2);
  });

  it("drops rounds that are no longer in the session", async () => {
    const session = makeSession({
      rounds: [makeRound({ round_number: 0 }), makeRound({ round_number: 1 })],
    });
    await putSession(session);
    await putSession({ ...session, rounds: [session.rounds[0]!] });

    const back = await getSession(session.id);
    expect(back?.rounds).toHaveLength(1);
  });

  it("never lets a later write change the owner", async () => {
    const session = makeSession({ owner_id: OWNER });
    await putSession(session);
    await putSession({ ...session, owner_id: "deadbeef-0000-4000-8000-00000000000b" });

    expect((await getSession(session.id))?.owner_id).toBe(OWNER);
  });

  it("gives the project a title from the client's own first sentence", async () => {
    await putSession(finalized());
    const [row] = await getDatabase()
      .select()
      .from(projects)
      .where(eq(projects.id, "e0e0e0e0-0000-4000-8000-00000000000a"));
    expect(row?.title).toBe("A marketplace for handmade crafts");
  });

  it("returns null for a row whose stored document no longer parses", async () => {
    const session = makeSession({ rounds: [makeRound()] });
    await putSession(session);
    // Simulate a document written by an older schema version.
    await getDatabase()
      .update(roundsTable)
      .set({ extraction: { domain: "SaaS" } })
      .where(eq(roundsTable.projectId, session.id));

    expect(await getSession(session.id)).toBeNull();
  });

  it("is null for an id that was never stored", async () => {
    expect(await getSession("00000000-0000-4000-8000-000000000000")).toBeNull();
  });

  it("refuses to store an invalid session", async () => {
    const broken = { ...makeSession(), status: "not-a-status" } as never;
    await expect(putSession(broken)).rejects.toThrow(/invalid session/);
  });
});

describe("titles", () => {
  it.each([
    [
      "A marketplace for handmade crafts. Sellers list items.",
      "A marketplace for handmade crafts",
    ],
    ["Something for my shop", "Something for my shop"],
    ["   \n  spaced   out   brief  ", "spaced out brief"],
    ["", "Untitled scope"],
  ])("%j becomes %j", (raw, title) => {
    expect(deriveTitle(raw)).toBe(title);
  });

  it("truncates a very long first sentence", () => {
    const title = deriveTitle("x".repeat(200));
    expect(title).toHaveLength(78);
    expect(title.endsWith("…")).toBe(true);
  });

  // UX-02: the title typed on the output page is a stored field, not a
  // label derived from the brief every time the page renders.
  it("keeps a rename, and a later write of the session does not undo it", async () => {
    const session = finalized();
    await putSession(session);

    const stored = await renameProject(session.id, "  Craft   marketplace MVP  ");
    expect(stored).toBe("Craft marketplace MVP");
    expect(await projectTitle(session.id)).toBe("Craft marketplace MVP");

    await putSession({ ...session, updated_at: Date.now() });
    expect(await projectTitle(session.id)).toBe("Craft marketplace MVP");
  });

  it("tidies a title the same way the derived one is tidied", async () => {
    const session = finalized();
    await putSession(session);
    expect(await renameProject(session.id, "y".repeat(200))).toHaveLength(78);
  });

  it("has no title for a project that does not exist", async () => {
    expect(await projectTitle("00000000-0000-4000-8000-00000000dead")).toBeNull();
  });
});

describe("share links", () => {
  async function shared() {
    const session = finalized();
    await putSession(session);
    const { token } = await createShareLink({
      sessionId: session.id,
      owner_id: OWNER,
      title: "Craft marketplace MVP",
      final_output: session.final_output!,
    });
    return { session, token };
  }

  it("resolves by token and is the project's active share", async () => {
    const { session, token } = await shared();

    expect(await resolveShareToken(token)).toMatchObject({
      sessionId: session.id,
      owner_id: OWNER,
      title: "Craft marketplace MVP",
    });
    expect((await findActiveShare(session.id))?.token).toBe(token);
  });

  it("makes the newest link the active one", async () => {
    const { session, token: first } = await shared();
    const { token: second } = await createShareLink({
      sessionId: session.id,
      owner_id: OWNER,
      title: "Second link",
      final_output: session.final_output!,
    });

    expect((await findActiveShare(session.id))?.token).toBe(second);
    // The older link still resolves until it is revoked or expires.
    expect(await resolveShareToken(first)).not.toBeNull();
  });

  it("stops resolving once revoked", async () => {
    const { session, token } = await shared();
    await revokeShareLink(token, session.id);

    expect(await resolveShareToken(token)).toBeNull();
    expect(await findActiveShare(session.id)).toBeNull();
  });

  it("ignores an expired link", async () => {
    const { session, token } = await shared();
    await getDatabase()
      .update(shares)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where(eq(shares.token, token));

    expect(await resolveShareToken(token)).toBeNull();
    expect(await findActiveShare(session.id)).toBeNull();
  });

  it("refuses a token that is not shaped like one, without a query", async () => {
    expect(await resolveShareToken("../../etc/passwd")).toBeNull();
    expect(await resolveShareToken("short")).toBeNull();
  });
});

describe("deleting a project takes every related row with it", () => {
  it("removes rounds, shares, versions, approvals and usage", async () => {
    const session = finalized();
    await putSession(session);
    const db = getDatabase();

    await createShareLink({
      sessionId: session.id,
      owner_id: OWNER,
      title: "Link",
      final_output: session.final_output!,
    });
    const [version] = await db
      .insert(versions)
      .values({
        projectId: session.id,
        versionNumber: 1,
        output: session.final_output!,
      })
      .returning();
    await db.insert(approvals).values({
      projectId: session.id,
      versionId: version!.id,
      state: "pending",
    });
    await db.insert(llmUsage).values({
      projectId: session.id,
      label: "extract",
      provider: "gemini",
      model: "gemini-test-main",
      inputTokens: 1200,
      outputTokens: 300,
    });
    await db.insert(auditLog).values({
      action: "project.created",
      subjectType: "project",
      subjectId: session.id,
    });

    await deleteSession(session.id);

    expect(await db.select().from(projects).where(eq(projects.id, session.id))).toEqual(
      [],
    );
    expect(
      await db.select().from(roundsTable).where(eq(roundsTable.projectId, session.id)),
    ).toEqual([]);
    expect(
      await db.select().from(shares).where(eq(shares.projectId, session.id)),
    ).toEqual([]);
    expect(
      await db.select().from(versions).where(eq(versions.projectId, session.id)),
    ).toEqual([]);
    expect(
      await db.select().from(approvals).where(eq(approvals.projectId, session.id)),
    ).toEqual([]);
    expect(
      await db.select().from(llmUsage).where(eq(llmUsage.projectId, session.id)),
    ).toEqual([]);
    // The audit trail is deliberately not cascaded: it records what happened.
    expect(
      await db.select().from(auditLog).where(eq(auditLog.subjectId, session.id)),
    ).toHaveLength(1);
  });

  it("is a no-op for a project that is already gone", async () => {
    await expect(
      deleteSession("00000000-0000-4000-8000-00000000dead"),
    ).resolves.toBeUndefined();
  });
});

describe("the round-trip survives a second write of the same extraction", () => {
  it("keeps the extraction document intact", async () => {
    const extraction = makeExtraction({ domain: "FinTech" });
    const session = makeSession({ rounds: [makeRound({ extraction })] });
    await putSession(session);
    await putSession(session);

    expect((await getSession(session.id))?.rounds[0]?.extraction).toEqual(extraction);
  });
});
