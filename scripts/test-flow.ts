/**
 * End-to-end smoke test.
 *
 *   1. POST /api/session             (create; status=analyzing)
 *   2. POST /api/session/[id]/run    (round 0)
 *   3. POST /api/session/[id]/answer (if questions present)
 *   4. POST /api/finalize            (when status=ready)
 *
 * Usage:
 *   npx next dev --port 3000           # in another terminal
 *   npx tsx scripts/test-flow.ts       # default base URL is http://localhost:3000
 *
 * Env:
 *   ANTHROPIC_API_KEY  required (set in .env.local or shell)
 *   SCOPEAI_BASE_URL   optional, override base URL
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

async function call<T>(
  method: string,
  path: string,
  body: unknown,
  cookies: Cookie[],
): Promise<FetchResult<T>> {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      Cookie: cookieHeader(cookies),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
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

interface SessionResponse {
  session: {
    id: string;
    status: "analyzing" | "awaiting_answers" | "blocker" | "ready" | "finalized";
    current_confidence: number;
    rounds: Array<{
      questions: Array<{ id: string; options: string[] }>;
      answers: Array<unknown>;
    }>;
  };
}

interface FinalizeResponse {
  output: {
    client: { project_summary: string; modules: unknown[] };
    engineer: { module_table: unknown[]; sprint_breakdown: unknown[] };
  };
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

async function main(): Promise<void> {
  console.log(`Base URL: ${BASE}`);
  console.log("Step 1 · POST /api/session");

  const t0 = Date.now();
  const r1 = await call<SessionResponse & ErrorResponse>(
    "POST",
    "/api/session",
    { rawText: SAMPLE_PROMPT },
    [],
  );
  if (r1.status !== 200) {
    console.error(
      `  FAILED: ${r1.status} ${r1.data?.error?.code} — ${r1.data?.error?.message}`,
    );
    process.exit(1);
  }
  check("status 200", r1.status === 200);
  check("session id present", typeof r1.data.session.id === "string");
  check(
    "session cookie set",
    r1.cookies.some((c) => c.name === "scopeai_session"),
  );
  check("created session is analyzing", r1.data.session.status === "analyzing");
  let cookies = r1.cookies;

  // Step 2 — creating a session no longer runs the pipeline; /run does.
  console.log("Step 2 · POST /api/session/[id]/run");
  const rRun = await call<SessionResponse & ErrorResponse>(
    "POST",
    `/api/session/${r1.data.session.id}/run`,
    undefined,
    cookies,
  );
  check("run status 200", rRun.status === 200);
  if (rRun.status !== 200) {
    console.error(`  ${rRun.data?.error?.code} ${rRun.data?.error?.message}`);
    process.exit(1);
  }
  let session = rRun.data.session;
  cookies = rRun.cookies;
  console.log(
    `  domain analyzed in ${Date.now() - t0}ms · status=${session.status} · conf=${session.current_confidence}`,
  );

  // Step 3 — answer rounds until ready or rounds exhausted.
  let safety = 4;
  while (
    (session.status === "awaiting_answers" || session.status === "blocker") &&
    safety-- > 0
  ) {
    console.log(`Step 3.${4 - safety} · answering round`);
    const round = session.rounds[session.rounds.length - 1];
    if (!round) break;
    const answers = round.questions.map((q) => ({
      question_id: q.id,
      // Pick the first option for each question — good enough for smoke test.
      selected_options: q.options.slice(0, 1),
      custom_text: null,
    }));
    const r2 = await call<SessionResponse & ErrorResponse>(
      "POST",
      `/api/session/${session.id}/answer`,
      { answers },
      cookies,
    );
    check(`round ${4 - safety} status 200`, r2.status === 200);
    if (r2.status !== 200) {
      console.error(`  ${r2.data?.error?.code} ${r2.data?.error?.message}`);
      process.exit(1);
    }
    session = r2.data.session;
    cookies = r2.cookies;
    console.log(`  status=${session.status} · conf=${session.current_confidence}`);
  }

  if (session.status !== "ready" && session.status !== "finalized") {
    console.error(`  Loop exited with non-ready status: ${session.status}`);
    process.exit(1);
  }

  // Step 4 — finalize.
  console.log("Step 4 · POST /api/finalize");
  const t3 = Date.now();
  const r3 = await call<FinalizeResponse & ErrorResponse>(
    "POST",
    "/api/finalize",
    { sessionId: session.id },
    cookies,
  );
  check("finalize 200", r3.status === 200);
  if (r3.status !== 200) {
    console.error(`  ${r3.data?.error?.code} ${r3.data?.error?.message}`);
    process.exit(1);
  }
  console.log(`  finalized in ${Date.now() - t3}ms`);
  check(
    "client.project_summary present",
    typeof r3.data.output?.client?.project_summary === "string" &&
      r3.data.output.client.project_summary.length > 0,
  );
  check(
    "client.modules non-empty",
    Array.isArray(r3.data.output?.client?.modules) &&
      r3.data.output.client.modules.length > 0,
  );
  check(
    "engineer.module_table non-empty",
    Array.isArray(r3.data.output?.engineer?.module_table) &&
      r3.data.output.engineer.module_table.length > 0,
  );
  check(
    "engineer.sprint_breakdown non-empty",
    Array.isArray(r3.data.output?.engineer?.sprint_breakdown) &&
      r3.data.output.engineer.sprint_breakdown.length > 0,
  );

  console.log(`\n== ${pass} passed, ${fail} failed ==`);
  if (fail > 0) process.exit(1);
}

main().catch((err: unknown) => {
  console.error("FAILED:", err instanceof Error ? err.message : err);
  if (err instanceof Error && err.stack) console.error(err.stack);
  process.exit(1);
});
