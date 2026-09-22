import { NextRequest } from "next/server";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { proxy } from "@/proxy";
import { GET as getSessionRoute } from "@/app/api/session/[id]/route";
import { POST as runRoute } from "@/app/api/session/[id]/run/route";
import { putSession } from "@/lib/storage/session";
import { buildSessionCookie, SESSION_COOKIE_NAME } from "@/lib/security/session-cookie";
import type { Session } from "@/lib/schemas/mcq";
import { makeRound, makeSession } from "../fixtures/llm";

/**
 * Drives proxy.ts and the real route handlers in-process, the way Next calls
 * them: proxy first, then the route. In-memory buckets live on globalThis, so
 * each test uses its own client IP.
 */

const SESSION_ID = "a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d";
let session: Session;

beforeAll(async () => {
  // Waiting on the user, so /run returns it unchanged without calling the LLM.
  session = makeSession({
    id: SESSION_ID,
    status: "awaiting_answers",
    pipeline_stage: null,
    rounds: [makeRound()],
  });
  await putSession(session);
});

afterEach(() => {
  delete process.env.VERCEL;
});

function request(
  method: "GET" | "POST",
  path: string,
  headers: Record<string, string>,
): NextRequest {
  return new NextRequest(`http://localhost${path}`, {
    method,
    headers: {
      cookie: `${SESSION_COOKIE_NAME}=${buildSessionCookie(SESSION_ID).value}`,
      ...headers,
    },
  });
}

const params = { params: Promise.resolve({ id: SESSION_ID }) };

describe("BUG-01: polling does not trip the rate limiter", () => {
  it("40 status polls in a minute from one IP all return 200", async () => {
    const statuses: number[] = [];
    for (let i = 0; i < 40; i++) {
      const req = request("GET", `/api/session/${SESSION_ID}`, {
        "x-forwarded-for": "198.51.100.40",
      });
      const gate = await proxy(req);
      statuses.push(
        gate.status === 429 ? 429 : (await getSessionRoute(req, params)).status,
      );
    }
    expect(statuses).toEqual(Array(40).fill(200));
  });

  it("the poll bucket still caps at 120 per minute", async () => {
    let last = 0;
    for (let i = 0; i < 121; i++) {
      const req = request("GET", `/api/session/${SESSION_ID}`, {
        "x-forwarded-for": "198.51.100.41",
      });
      last = (await proxy(req)).status;
      if (i < 120) expect(last).not.toBe(429);
    }
    expect(last).toBe(429);
  });
});

describe("LLM routes keep a strict per-route limit", () => {
  it("the 7th /run call within 60 s returns 429", async () => {
    const statuses: number[] = [];
    for (let i = 0; i < 7; i++) {
      const req = request("POST", `/api/session/${SESSION_ID}/run`, {
        "x-forwarded-for": "198.51.100.42",
      });
      const gate = await proxy(req);
      statuses.push(gate.status === 429 ? 429 : (await runRoute(req, params)).status);
    }
    expect(statuses).toEqual([200, 200, 200, 200, 200, 200, 429]);
  });
});

describe("SEC-02: spoofed X-Forwarded-For does not create new buckets", () => {
  async function hitApi(n: number, headersFor: (i: number) => Record<string, string>) {
    const statuses: number[] = [];
    for (let i = 0; i < n; i++) {
      statuses.push((await proxy(request("POST", "/api/share", headersFor(i)))).status);
    }
    return statuses;
  }

  it("on Vercel, requests share the platform IP's bucket", async () => {
    process.env.VERCEL = "1";
    const statuses = await hitApi(31, (i) => ({
      "x-forwarded-for": `10.0.${i}.1`, // spoofed by the client, differs every time
      "x-vercel-forwarded-for": "203.0.113.60",
      "x-real-ip": "203.0.113.60",
    }));
    expect(statuses.slice(0, 30).every((s) => s !== 429)).toBe(true);
    expect(statuses[30]).toBe(429);
  });

  it("behind a proxy, only the entry the proxy appended counts", async () => {
    const statuses = await hitApi(31, (i) => ({
      "x-forwarded-for": `10.1.${i}.1, 203.0.113.61`,
    }));
    expect(statuses.slice(0, 30).every((s) => s !== 429)).toBe(true);
    expect(statuses[30]).toBe(429);
  });
});
