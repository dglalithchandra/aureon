import { NextRequest } from "next/server";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { POST as clarifyRoute } from "@/app/api/session/[id]/clarify/route";
import { POST as finalizeRoute } from "@/app/api/finalize/route";
import { getSession, putSession } from "@/lib/storage/session";
import { getVersion, listVersions } from "@/lib/versions/store";
import { buildSessionCookie, SESSION_COOKIE_NAME } from "@/lib/security/session-cookie";
import type { Session } from "@/lib/schemas/mcq";
import { startMockLlm, type MockLlm } from "../mocks/mock-llm";
import { drainJobs, resetJobQueue } from "../mocks/job-queue";
import { truncateAll } from "../helpers/db";
import { makeClientView, makeRound, makeSession } from "../fixtures/llm";

/**
 * UX-02 item 4: answering an open item from the output page runs a new round
 * and a new generation, and blueprint step 14's version history records it as
 * a clarification rather than a hand edit.
 */

vi.mock("@/lib/jobs/transport", () => import("../mocks/job-queue"));

const SESSION_ID = "b1b1b1b1-0000-4000-8000-00000000000b";

let mock: MockLlm;
let ip = 0;

beforeAll(async () => {
  mock = await startMockLlm();
  process.env.GEMINI_BASE_URL = mock.url;
});

afterAll(async () => {
  await mock.close();
});

beforeEach(async () => {
  mock.reset();
  resetJobQueue();
  await truncateAll();
});

function post(path: string, sessionId: string, body: unknown): NextRequest {
  ip++;
  return new NextRequest(`http://localhost${path}`, {
    method: "POST",
    headers: {
      cookie: `${SESSION_COOKIE_NAME}=${buildSessionCookie(sessionId).value}`,
      "content-type": "application/json",
      "x-forwarded-for": `198.51.105.${ip}`,
    },
    body: JSON.stringify(body),
  });
}

const params = { params: Promise.resolve({ id: SESSION_ID }) };

async function stored(): Promise<Session> {
  const session = await getSession(SESSION_ID);
  if (!session) throw new Error("session missing");
  return session;
}

/** A session that has been through a round and is ready to generate. */
async function ready(): Promise<void> {
  await putSession(
    makeSession({
      id: SESSION_ID,
      raw_input: "An internal tool for account managers to look after client accounts.",
      status: "ready",
      pipeline_stage: null,
      current_confidence: 72,
      rounds: [makeRound({ round_number: 0 })],
    }),
  );
}

function clarify(question: string, answer: string) {
  return clarifyRoute(
    post(`/api/session/${SESSION_ID}/clarify`, SESSION_ID, { question, answer }),
    params,
  );
}

function finalize(override = false) {
  return finalizeRoute(
    post("/api/finalize", SESSION_ID, { sessionId: SESSION_ID, override }),
  );
}

describe("clarifying a finished scope", () => {
  it("runs a new round, regenerates, and writes a clarified version", async () => {
    await ready();
    expect((await finalize()).status).toBe(202);
    await drainJobs();
    const first = await stored();
    expect(first.status).toBe("finalized");
    expect(first.final_output).not.toBeNull();
    expect((await listVersions(SESSION_ID)).map((v) => v.reason)).toEqual(["generated"]);

    // The model answers differently now that it has been told the budget —
    // otherwise the regenerated document would be the one already stored.
    mock.override("submit_client_view", {
      ...makeClientView(),
      project_summary:
        "An internal tool for account managers, budgeted at 40,000 dollars.",
      open_items: [],
    });

    const res = await clarify("Confirm the budget.", "40,000 dollars over eight weeks.");
    expect(res.status).toBe(202);

    const queued = await stored();
    expect(queued.status).toBe("analyzing");
    expect(queued.rounds[0]?.added_description).toContain("40,000 dollars");
    // The old document stays until a new one replaces it.
    expect(queued.final_output).toEqual(first.final_output);

    await drainJobs();
    const rounded = await stored();
    expect(rounded.status).not.toBe("analyzing");
    expect(rounded.rounds).toHaveLength(2);

    expect((await finalize(true)).status).toBe(202);
    await drainJobs();
    const after = await stored();
    expect(after.status).toBe("finalized");
    expect(after.final_output?.client.project_summary).toContain("40,000 dollars");

    const versions = await listVersions(SESSION_ID);
    expect(versions.map((v) => v.reason)).toEqual(["generated", "clarified"]);
    expect(versions[1]?.versionNumber).toBe(2);
    expect((await getVersion(SESSION_ID, 2))?.output.client.open_items).toEqual([]);
  });

  it("refuses while a round is already running", async () => {
    await putSession(
      makeSession({
        id: SESSION_ID,
        status: "analyzing",
        rounds: [makeRound({ round_number: 0 })],
      }),
    );
    const res = await clarify("", "More detail.");
    expect(res.status).toBe(400);
    expect((await stored()).rounds[0]?.added_description).toBeNull();
  });

  it("refuses an empty answer", async () => {
    await ready();
    expect((await clarify("Budget?", "   ")).status).toBe(400);
  });

  it("refuses a browser that does not own the session", async () => {
    await ready();
    const res = await clarifyRoute(
      new NextRequest(`http://localhost/api/session/${SESSION_ID}/clarify`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-forwarded-for": "198.51.106.9",
        },
        body: JSON.stringify({ question: "", answer: "Mine now." }),
      }),
      params,
    );
    expect(res.status).toBe(401);
  });
});
