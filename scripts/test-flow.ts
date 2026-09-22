/**
 * End-to-end smoke test and timing check (OPS-01).
 *
 *   1. POST /api/session             (create; status=analyzing)
 *   2. POST /api/session/[id]/run    (202: round 0 queued as a job)
 *   3. POST /api/session/[id]/answer (202, while questions remain)
 *   4. POST /api/finalize            (202: client + engineer view jobs)
 *
 * After each 202 the script polls GET /api/session/[id] until the job is
 * done. Every API response is timed (must be < 2 s) and so is every round
 * (POST until the session leaves "analyzing"; p95 must be < 45 s).
 *
 * Usage:
 *   npx next dev --port 3000                       # in another terminal
 *   npx tsx scripts/test-flow.ts                   # one run
 *   npx tsx scripts/test-flow.ts --runs=10         # timing report over 10 runs
 *
 * Env:
 *   ANTHROPIC_API_KEY                required by the server (.env.local or shell)
 *   SCOPEAI_BASE_URL                 optional, e.g. a Vercel preview URL
 *   VERCEL_AUTOMATION_BYPASS_SECRET  optional, to reach a protected preview
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

function loadEnvFile(path: string): void {
  try {
    const text = readFileSync(path, "utf8");
    for (const line of text.split(/\r?\n/)) {
      const t = line.trim();
      if (!t || t.startsWith("#")) continue;
      const eq = t.indexOf("=");
      if (eq < 0) continue;
      const key = t.slice(0, eq).trim();
      let value = t.slice(eq + 1).trim();
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }
      if (!process.env[key]) process.env[key] = value;
    }
  } catch {
    /* ignore */
  }
}

loadEnvFile(join(process.cwd(), ".env.local"));

const BASE = process.env.SCOPEAI_BASE_URL ?? "http://localhost:3000";
const RUNS = Math.max(
  1,
  Number(process.argv.find((a) => a.startsWith("--runs="))?.split("=")[1] ?? 1) || 1,
);
const API_BUDGET_MS = 2_000;
const ROUND_P95_BUDGET_MS = 45_000;
const POLL_MS = 1_000;
const JOB_TIMEOUT_MS = 330_000;

interface Cookie {
  name: string;
  value: string;
}

function parseCookies(setCookieHeaders: string[] | null): Cookie[] {
  if (!setCookieHeaders) return [];
  return setCookieHeaders.map((h) => {
    const first = h.split(";", 1)[0] ?? "";
    const eq = first.indexOf("=");
    return {
      name: first.slice(0, eq),
      value: first.slice(eq + 1),
    };
  });
}

function cookieHeader(cookies: Cookie[]): string {
  return cookies.map((c) => `${c.name}=${c.value}`).join("; ");
}

interface FetchResult<T> {
  status: number;
  data: T;
  cookies: Cookie[];
}

/** Every API response time, for the < 2 s check. */
const apiTimes: Array<{ label: string; ms: number }> = [];
/** Every round, POST until the session left "analyzing". */
const roundTimes: number[] = [];

async function call<T>(
  method: string,
  path: string,
  body: unknown,
  cookies: Cookie[],
): Promise<FetchResult<T>> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Cookie: cookieHeader(cookies),
  };
  const bypass = process.env.VERCEL_AUTOMATION_BYPASS_SECRET;
  if (bypass) headers["x-vercel-protection-bypass"] = bypass;

  const t0 = Date.now();
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  apiTimes.push({
    label: `${method} ${path.replace(/[0-9a-f-]{36}/, ":id")}`,
    ms: Date.now() - t0,
  });

  // Node's undici exposes set-cookie via getSetCookie().
  type ResWithGetSetCookie = Response & {
    headers: Headers & { getSetCookie?: () => string[] };
  };
  const setCookies = (res as ResWithGetSetCookie).headers.getSetCookie?.() ?? null;
  const newCookies = parseCookies(setCookies);
  const merged = [...cookies];
  for (const nc of newCookies) {
    const i = merged.findIndex((c) => c.name === nc.name);
    if (i >= 0) merged[i] = nc;
    else merged.push(nc);
  }
  let data: unknown;
  try {
    data = await res.json();
  } catch {
    data = null;
  }
  return { status: res.status, data: data as T, cookies: merged };
}

const SAMPLE_PROMPT =
  "We need a SaaS analytics platform for ecommerce store owners. Users connect their Shopify or WooCommerce store via OAuth and see dashboards with revenue, top products, and conversion funnels. Stripe billing with monthly Starter ($29) and Pro ($99) tiers, 14-day free trial, team invitations with editor/viewer roles, and CSV export. Stack: Next.js, Postgres, deployed on Vercel. We have $40k budget, want MVP live in 8 weeks. Success means 50 paying customers in 3 months and <2s dashboard load.";

interface Session {
  id: string;
  status: "analyzing" | "awaiting_answers" | "blocker" | "ready" | "finalized" | "error";
  pipeline_stage: string | null;
  current_confidence: number;
  last_error: { code: string; message: string } | null;
  rounds: Array<{
    questions: Array<{ id: string; options: string[] }>;
    answers: Array<unknown>;
  }>;
  final_output: {
    client: { project_summary: string; modules: unknown[] };
    engineer: { module_table: unknown[]; sprint_breakdown: unknown[] };
  } | null;
}

interface SessionResponse {
  session: Session;
}

interface ErrorResponse {
  error?: { code: string; message: string };
}

let pass = 0;
let fail = 0;
function check(name: string, cond: boolean, detail?: string): void {
  if (cond) {
    pass++;
    console.log(`  ✓ ${name}`);
  } else {
    fail++;
    console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

function abort(message: string): never {
  console.error(`  FAILED: ${message}`);
  process.exit(1);
}

/** Poll the session until `done` holds (the job finished). */
async function waitFor(
  id: string,
  cookies: Cookie[],
  done: (s: Session) => boolean,
): Promise<Session> {
  const deadline = Date.now() + JOB_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const res = await call<SessionResponse & ErrorResponse>(
      "GET",
      `/api/session/${id}`,
      undefined,
      cookies,
    );
    if (res.status === 200 && done(res.data.session)) return res.data.session;
    await new Promise((r) => setTimeout(r, POLL_MS));
  }
  abort(`session ${id} did not finish within ${JOB_TIMEOUT_MS / 1000}s`);
}

/** POST a round (run or answer), expect 202, and time it until it is done. */
async function round(
  label: string,
  path: string,
  body: unknown,
  cookies: Cookie[],
  id: string,
): Promise<Session> {
  const t0 = Date.now();
  const res = await call<SessionResponse & ErrorResponse>("POST", path, body, cookies);
  check(`${label} answered 202`, res.status === 202, `got ${res.status}`);
  if (res.status !== 202) abort(`${res.data?.error?.code} ${res.data?.error?.message}`);
  const session = await waitFor(id, cookies, (s) => s.status !== "analyzing");
  const ms = Date.now() - t0;
  roundTimes.push(ms);
  if (session.status === "error") abort(`round failed: ${session.last_error?.message}`);
  console.log(
    `  ${label}: ${ms}ms · status=${session.status} · conf=${session.current_confidence}`,
  );
  return session;
}

async function runFlow(): Promise<void> {
  console.log("Step 1 · POST /api/session");
  const r1 = await call<SessionResponse & ErrorResponse>(
    "POST",
    "/api/session",
    { rawText: SAMPLE_PROMPT },
    [],
  );
  if (r1.status !== 200)
    abort(`${r1.status} ${r1.data?.error?.code} — ${r1.data?.error?.message}`);
  check(
    "session cookie set",
    r1.cookies.some((c) => c.name === "scopeai_session"),
  );
  check("created session is analyzing", r1.data.session.status === "analyzing");
  const cookies = r1.cookies;
  const id = r1.data.session.id;

  console.log("Step 2 · POST /api/session/[id]/run");
  let session = await round("round 0", `/api/session/${id}/run`, undefined, cookies, id);

  // Step 3 — answer rounds until ready or rounds exhausted.
  let safety = 4;
  while (
    (session.status === "awaiting_answers" || session.status === "blocker") &&
    safety-- > 0
  ) {
    const last = session.rounds[session.rounds.length - 1];
    if (!last) break;
    console.log(`Step 3.${4 - safety} · POST /api/session/[id]/answer`);
    const answers = last.questions.map((q) => ({
      question_id: q.id,
      // Pick the first option for each question — good enough for smoke test.
      selected_options: q.options.slice(0, 1),
      custom_text: null,
    }));
    session = await round(
      `round ${session.rounds.length}`,
      `/api/session/${id}/answer`,
      { answers },
      cookies,
      id,
    );
  }

  if (session.status !== "ready" && session.status !== "finalized") {
    abort(`loop exited with non-ready status: ${session.status}`);
  }

  console.log("Step 4 · POST /api/finalize");
  const t3 = Date.now();
  const r3 = await call<SessionResponse & ErrorResponse>(
    "POST",
    "/api/finalize",
    { sessionId: id },
    cookies,
  );
  check("finalize answered 202", r3.status === 202, `got ${r3.status}`);
  if (r3.status !== 202) abort(`${r3.data?.error?.code} ${r3.data?.error?.message}`);
  const done = await waitFor(id, cookies, (s) => s.pipeline_stage !== "finalizing");
  console.log(`  finalized in ${Date.now() - t3}ms`);
  const output = done.final_output;
  if (!output) abort(`finalize failed: ${done.last_error?.message}`);
  check("client.project_summary present", output.client.project_summary.length > 0);
  check("client.modules non-empty", output.client.modules.length > 0);
  check("engineer.module_table non-empty", output.engineer.module_table.length > 0);
  check(
    "engineer.sprint_breakdown non-empty",
    output.engineer.sprint_breakdown.length > 0,
  );
}

function percentile(values: number[], p: number): number {
  const sorted = [...values].sort((a, b) => a - b);
  return (
    sorted[Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)] ?? 0
  );
}

async function main(): Promise<void> {
  console.log(`Base URL: ${BASE} · runs: ${RUNS}`);
  for (let run = 1; run <= RUNS; run++) {
    if (RUNS > 1) console.log(`\n── run ${run}/${RUNS} ──`);
    await runFlow();
  }

  const slowest = apiTimes.reduce((a, b) => (b.ms > a.ms ? b : a), { label: "-", ms: 0 });
  const slow = apiTimes.filter((t) => t.ms >= API_BUDGET_MS);
  const p95 = percentile(roundTimes, 95);
  console.log("\nTiming");
  console.log(
    `  API responses: ${apiTimes.length}, slowest ${slowest.ms}ms (${slowest.label})`,
  );
  console.log(
    `  rounds: ${roundTimes.length}, p50 ${percentile(roundTimes, 50)}ms, p95 ${p95}ms`,
  );
  check(
    `every API response < ${API_BUDGET_MS}ms`,
    slow.length === 0,
    `${slow.length} slower`,
  );
  check(`round p95 < ${ROUND_P95_BUDGET_MS}ms`, p95 < ROUND_P95_BUDGET_MS, `${p95}ms`);

  console.log(`\n== ${pass} passed, ${fail} failed ==`);
  if (fail > 0) process.exit(1);
}

main().catch((err: unknown) => {
  console.error("FAILED:", err instanceof Error ? err.message : err);
  if (err instanceof Error && err.stack) console.error(err.stack);
  process.exit(1);
});
