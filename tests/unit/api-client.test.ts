import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiError, runSession, submitAnswers } from "@/lib/api/client";
import { makeSession } from "../fixtures/llm";

const SESSION = makeSession({ status: "analyzing", pipeline_stage: "github" });

function respond(status: number, body: unknown): void {
  vi.stubGlobal(
    "fetch",
    vi.fn(
      async () =>
        new Response(JSON.stringify(body), {
          status,
          headers: { "content-type": "application/json" },
        }),
    ),
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("runSession / submitAnswers", () => {
  it("return the session with inProgress=false on 200", async () => {
    respond(200, { session: SESSION });
    await expect(runSession(SESSION.id)).resolves.toEqual({
      session: SESSION,
      inProgress: false,
    });
  });

  it("treat 409 IN_PROGRESS with a session as 'still working', not an error", async () => {
    const body = { error: { code: "IN_PROGRESS", message: "busy" }, session: SESSION };
    respond(409, body);
    await expect(runSession(SESSION.id)).resolves.toEqual({
      session: SESSION,
      inProgress: true,
    });
    respond(409, body);
    await expect(submitAnswers(SESSION.id, [])).resolves.toEqual({
      session: SESSION,
      inProgress: true,
    });
  });

  it("throw when a 409 carries no session", async () => {
    respond(409, { error: { code: "IN_PROGRESS", message: "busy" }, session: null });
    const err = await runSession(SESSION.id).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err).toMatchObject({ code: "IN_PROGRESS", status: 409 });
  });

  it("still throw ApiError for real failures", async () => {
    respond(502, {
      error: { code: "LLM_ERROR", message: "Extraction model call failed" },
    });
    const err = await runSession(SESSION.id).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err).toMatchObject({ code: "LLM_ERROR", status: 502 });
  });
});
