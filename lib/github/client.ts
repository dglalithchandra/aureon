import "@/lib/server-only";
import { AsyncLocalStorage } from "node:async_hooks";
import { Octokit } from "@octokit/rest";
import { getServerEnv } from "@/lib/env";

/**
 * Octokit singleton. Token-less by default (60 req/hr). When GITHUB_TOKEN
 * is set, rate limit jumps to 5000/hr and search to 30 req/min — still
 * tight, which is why the enrichment pipeline budgets requests carefully.
 */

let client: Octokit | null = null;

/**
 * Per-enrichment request accounting (PERF-01). `reserved` is taken before a
 * call is made, so parallel fetches cannot overshoot the budget; `sent` is
 * counted by an Octokit hook on every request that actually goes out.
 */
interface RequestBudget {
  limit: number;
  reserved: number;
  sent: number;
}

const budgetStore = new AsyncLocalStorage<RequestBudget>();

export function getOctokit(): Octokit {
  if (client) return client;
  const env = getServerEnv();
  client = new Octokit({
    auth: env.GITHUB_TOKEN,
    userAgent: "aureon/0.1",
    request: { timeout: 10_000 },
  });
  client.hook.before("request", () => {
    const budget = budgetStore.getStore();
    if (budget) budget.sent++;
  });
  return client;
}

/**
 * Run `work` with a GitHub request budget. Returns its result and the
 * number of requests it actually sent.
 */
export async function withGitHubBudget<T>(
  limit: number,
  work: () => Promise<T>,
): Promise<{ result: T; requests: number }> {
  const budget: RequestBudget = { limit, reserved: 0, sent: 0 };
  const result = await budgetStore.run(budget, work);
  return { result, requests: budget.sent };
}

/**
 * Reserve one request from the current budget. False when it is used up:
 * the caller skips the call. Always true outside withGitHubBudget.
 */
export function reserveGitHubRequest(): boolean {
  const budget = budgetStore.getStore();
  if (!budget) return true;
  if (budget.reserved >= budget.limit) return false;
  budget.reserved++;
  return true;
}

/**
 * True for HTTP errors that mean "GitHub blocked us, but the rest of the
 * pipeline should still produce a result." On these, the enrichment layer
 * returns an empty enrichment object instead of bubbling.
 */
export function isRetryableOrRateLimited(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const status = (err as { status?: unknown }).status;
  if (typeof status !== "number") return false;
  return status === 403 || status === 429 || status >= 500;
}

/** Requests sent so far under the current withGitHubBudget (0 outside it). */
export function gitHubRequestsSent(): number {
  return budgetStore.getStore()?.sent ?? 0;
}
