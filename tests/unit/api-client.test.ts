import { afterEach, describe, expect, it, vi } from "vitest";
import {
  absoluteUrl,
  ApiError,
  createShare,
  finalizeSession,
  revokeShare,
  runSession,
  submitAnswers,
} from "@/lib/api/client";
import { makeClientView, makeEngineerView, makeSession } from "../fixtures/llm";

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

describe("finalizeSession (OPS-01)", () => {
  const output = { client: makeClientView(), engineer: makeEngineerView() };
  const finalizing = makeSession({
    status: "ready",
    pipeline_stage: "finalizing",
    draft_output: { client: null, engineer: null, pending: ["client", "engineer"] },
  });

  it("returns the output when the session was already finalized (200)", async () => {
    respond(200, { output, cached: true });
    await expect(finalizeSession(SESSION.id)).resolves.toEqual({ output });
  });

  it("returns the session when the view jobs were queued (202)", async () => {
    respond(202, { session: finalizing });
    await expect(finalizeSession(SESSION.id)).resolves.toEqual({
      output: null,
      session: finalizing,
      inProgress: false,
    });
  });

  it("treats 409 with a session as already generating", async () => {
    respond(409, {
      error: { code: "IN_PROGRESS", message: "busy" },
      session: finalizing,
    });
    await expect(finalizeSession(SESSION.id)).resolves.toMatchObject({
      inProgress: true,
    });
  });
});

describe("share links", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("absoluteUrl uses NEXT_PUBLIC_APP_URL when it is set", () => {
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://aureon.example.com");
    expect(absoluteUrl("/share/abc", "http://localhost:3000")).toBe(
      "https://aureon.example.com/share/abc",
    );
  });

  it("absoluteUrl falls back to the page origin", () => {
    vi.stubEnv("NEXT_PUBLIC_APP_URL", undefined);
    expect(absoluteUrl("/share/abc", "http://localhost:3217")).toBe(
      "http://localhost:3217/share/abc",
    );
  });

  it("createShare sends the title, mode and expiry, and returns the snapshot time", async () => {
    respond(200, { token: "t".repeat(43), url: "/share/x", created_at: 5, reused: true });
    await expect(createShare(SESSION.id, { title: "My scope" })).resolves.toMatchObject({
      created_at: 5,
      reused: true,
      mode: "view",
    });
    const init = vi.mocked(fetch).mock.calls[0]?.[1];
    expect(JSON.parse(String(init?.body))).toEqual({
      sessionId: SESSION.id,
      title: "My scope",
      mode: "view",
      expiresInDays: 30,
      fresh: false,
    });
  });

  it("createShare asks for an approval link when told to", async () => {
    respond(200, {
      token: "t".repeat(43),
      url: "/share/x",
      created_at: 5,
      reused: false,
      mode: "approval",
      version_number: 3,
    });
    await expect(
      createShare(SESSION.id, { mode: "approval", expiresInDays: 7, fresh: true }),
    ).resolves.toMatchObject({ mode: "approval", version_number: 3 });
    const init = vi.mocked(fetch).mock.calls[0]?.[1];
    expect(JSON.parse(String(init?.body))).toMatchObject({
      mode: "approval",
      expiresInDays: 7,
      fresh: true,
    });
  });

  it("revokeShare sends DELETE and throws the server's error", async () => {
    respond(200, { revoked: true });
    await expect(revokeShare("tok")).resolves.toBeUndefined();
    expect(vi.mocked(fetch).mock.calls[0]).toMatchObject([
      "/api/share/tok",
      { method: "DELETE" },
    ]);

    respond(401, {
      error: { code: "UNAUTHORIZED", message: "Session ownership required" },
    });
    await expect(revokeShare("tok")).rejects.toMatchObject({ status: 401 });
  });
});
