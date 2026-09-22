import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type * as NextServer from "next/server";
import type { Job } from "@/lib/jobs/types";

// Capture what the app hands to QStash, to after() and to runJob.
const captured = vi.hoisted(() => ({
  clientOptions: [] as unknown[],
  batches: [] as unknown[][],
  afterCallbacks: [] as Array<() => unknown>,
  ran: [] as unknown[],
}));

vi.mock("@upstash/qstash", () => ({
  Client: class {
    constructor(options: unknown) {
      captured.clientOptions.push(options);
    }
    async batchJSON(requests: unknown[]) {
      captured.batches.push(requests);
      return requests.map((_, i) => ({ messageId: `msg_${i}`, url: "https://example" }));
    }
  },
}));

vi.mock("next/server", async (importOriginal) => ({
  ...(await importOriginal<typeof NextServer>()),
  after: (callback: () => unknown) => {
    captured.afterCallbacks.push(callback);
  },
}));

vi.mock("@/lib/jobs/run", () => ({
  runJob: async (job: unknown) => {
    captured.ran.push(job);
    return "completed";
  },
}));

const QSTASH_ENV = [
  "QSTASH_TOKEN",
  "QSTASH_CURRENT_SIGNING_KEY",
  "QSTASH_NEXT_SIGNING_KEY",
  "JOBS_BASE_URL",
  "VERCEL_AUTOMATION_BYPASS_SECRET",
];

const job = (type: Job["type"]): Job => ({
  type,
  sessionId: "e1b2c3d4-e5f6-4a7b-8c9d-000000000001",
  lockToken: "f1b2c3d4-e5f6-4a7b-8c9d-000000000001",
});

/** A fresh transport module, so getServerEnv() re-reads process.env. */
async function loadTransport() {
  vi.resetModules();
  return import("@/lib/jobs/transport");
}

beforeEach(() => {
  captured.clientOptions.length = 0;
  captured.batches.length = 0;
  captured.afterCallbacks.length = 0;
  captured.ran.length = 0;
});

afterEach(() => {
  for (const key of QSTASH_ENV) delete process.env[key];
});

describe("sendJobs", () => {
  it("without QSTASH_TOKEN runs each job in-process after the response", async () => {
    const { sendJobs } = await loadTransport();
    await sendJobs([job("round")], "http://localhost:3000");

    expect(captured.batches).toHaveLength(0);
    expect(captured.ran).toHaveLength(0); // not before the response is sent
    await Promise.all(captured.afterCallbacks.map((cb) => cb()));
    expect(captured.ran).toEqual([job("round")]);
  });

  it("with QSTASH_TOKEN publishes one batch to /api/jobs/[type] on the request origin", async () => {
    process.env.QSTASH_TOKEN = "qstash-test-token-0000";
    process.env.QSTASH_CURRENT_SIGNING_KEY = "sig_test_current_0000";
    process.env.QSTASH_NEXT_SIGNING_KEY = "sig_test_next_00000000";
    process.env.VERCEL_AUTOMATION_BYPASS_SECRET = "bypass-secret";

    const { sendJobs } = await loadTransport();
    await sendJobs(
      [job("finalize-client"), job("finalize-engineer")],
      "https://aureon-git-preview.vercel.app",
    );

    expect(captured.clientOptions[0]).toMatchObject({
      token: "qstash-test-token-0000",
      devMode: false,
    });
    expect(captured.batches).toHaveLength(1);
    expect(captured.batches[0]).toEqual([
      {
        url: "https://aureon-git-preview.vercel.app/api/jobs/finalize-client",
        body: job("finalize-client"),
        headers: { "x-vercel-protection-bypass": "bypass-secret" },
        retries: 3,
        timeout: 300,
        deduplicationId: "f1b2c3d4-e5f6-4a7b-8c9d-000000000001-finalize-client",
      },
      expect.objectContaining({
        url: "https://aureon-git-preview.vercel.app/api/jobs/finalize-engineer",
      }),
    ]);
    expect(captured.afterCallbacks).toHaveLength(0);
  });

  it("prefers JOBS_BASE_URL over the request origin", async () => {
    process.env.QSTASH_TOKEN = "qstash-test-token-0000";
    process.env.QSTASH_CURRENT_SIGNING_KEY = "sig_test_current_0000";
    process.env.QSTASH_NEXT_SIGNING_KEY = "sig_test_next_00000000";
    process.env.JOBS_BASE_URL = "https://aureon.example.com/";

    const { sendJobs } = await loadTransport();
    await sendJobs([job("round")], "http://internal-host");

    expect(captured.batches[0]).toEqual([
      expect.objectContaining({
        url: "https://aureon.example.com/api/jobs/round",
        headers: {},
      }),
    ]);
  });
});
