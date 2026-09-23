import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { POST as createRoute } from "@/app/api/session/route";
import { POST as shareRoute } from "@/app/api/share/route";
import { putSession } from "@/lib/storage/session";
import { getDatabase, setDatabase } from "@/lib/db/client";
import { truncateAll, startTestDatabase } from "../helpers/db";
import { createShareLink } from "@/lib/storage/share";
import { StorageUnavailableError } from "@/lib/errors";
import { buildOwnerCookie, OWNER_COOKIE_NAME } from "@/lib/security/session-cookie";
import {
  makeClientView,
  makeEngineerView,
  makeRound,
  makeSession,
} from "../fixtures/llm";

/** DATA-01: a failed database write is an error, never a silent success. */

/**
 * The real database for reads, a broken one for writes: the case that made
 * DATA-01 dangerous is the write that fails after the read succeeded.
 */
function breakWrites(): void {
  const real = getDatabase();
  const fail = (): never => {
    throw new Error("ECONNRESET (test)");
  };
  setDatabase(
    new Proxy(real, {
      get(target, prop, receiver) {
        if (prop === "insert" || prop === "update" || prop === "delete") return fail;
        if (prop === "transaction") return async () => fail();
        return Reflect.get(target, prop, receiver) as unknown;
      },
    }),
  );
}

const OWNER = "c0ffee00-0000-4000-8000-0000000000aa";
const session = makeSession({
  id: "e0e0e0e0-0000-4000-8000-0000000000aa",
  status: "finalized",
  pipeline_stage: null,
  owner_id: OWNER,
  rounds: [makeRound()],
  final_output: { client: makeClientView(), engineer: makeEngineerView() },
});

beforeEach(async () => {
  await truncateAll();
  await putSession(session);
  breakWrites();
});

afterEach(async () => {
  await startTestDatabase();
});

describe("storage writes fail loudly", () => {
  it("putSession throws STORAGE_UNAVAILABLE", async () => {
    await expect(putSession(session)).rejects.toBeInstanceOf(StorageUnavailableError);
  });

  it("createShareLink throws STORAGE_UNAVAILABLE", async () => {
    await expect(
      createShareLink({
        sessionId: session.id,
        owner_id: OWNER,
        title: "Scope",
        final_output: session.final_output!,
      }),
    ).rejects.toMatchObject({ code: "STORAGE_UNAVAILABLE", statusCode: 503 });
  });

  it("POST /api/session answers 503 STORAGE_UNAVAILABLE", async () => {
    const res = await createRoute(
      new NextRequest("http://localhost/api/session", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          rawText: "We need an internal tool for account managers.",
        }),
      }),
    );
    expect(res.status).toBe(503);
    expect(await res.json()).toMatchObject({ error: { code: "STORAGE_UNAVAILABLE" } });
    // No owner cookie for a session that was never stored.
    expect(res.cookies.get(OWNER_COOKIE_NAME)).toBeUndefined();
  });

  it("POST /api/share answers 503 STORAGE_UNAVAILABLE", async () => {
    const res = await shareRoute(
      new NextRequest("http://localhost/api/share", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          cookie: `${OWNER_COOKIE_NAME}=${buildOwnerCookie(OWNER).value}`,
        },
        body: JSON.stringify({ sessionId: session.id }),
      }),
    );
    expect(res.status).toBe(503);
    expect(await res.json()).toMatchObject({ error: { code: "STORAGE_UNAVAILABLE" } });
  });
});
