import "@/lib/server-only";
import { Octokit } from "@octokit/rest";
import { getServerEnv } from "@/lib/env";

/**
 * Octokit singleton. Token-less by default (60 req/hr). When GITHUB_TOKEN
 * is set, rate limit jumps to 5000/hr and search to 30 req/min — still
 * tight, which is why the enrichment pipeline budgets requests carefully.
 */

let client: Octokit | null = null;

export function getOctokit(): Octokit {
  if (client) return client;
  const env = getServerEnv();
  client = new Octokit({
    auth: env.GITHUB_TOKEN,
    userAgent: "scopeai/0.1",
    request: { timeout: 10_000 },
  });
  return client;
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
