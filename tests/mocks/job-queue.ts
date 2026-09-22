import { runJob } from "@/lib/jobs/run";
import type { Job, JobOutcome } from "@/lib/jobs/types";

/**
 * In-memory stand-in for lib/jobs/transport (QStash / after()). Route tests
 * swap it in with
 *
 *   vi.mock("@/lib/jobs/transport", () => import("../mocks/job-queue"));
 *
 * so a 202 route only records its jobs; the test then runs them with
 * drainJobs(), exactly as POST /api/jobs/[type] would.
 */

export const queuedJobs: Job[] = [];
let failures = 0;

export async function sendJobs(jobs: Job[]): Promise<void> {
  if (failures > 0) {
    failures--;
    throw new Error("queue unavailable (test)");
  }
  queuedJobs.push(...jobs);
}

/** Make the next `n` sendJobs calls fail, as if QStash were down. */
export function failNextSend(n = 1): void {
  failures = n;
}

/** Run every queued job in order and return their outcomes. */
export async function drainJobs(): Promise<JobOutcome[]> {
  const outcomes: JobOutcome[] = [];
  while (queuedJobs.length > 0) outcomes.push(await runJob(queuedJobs.shift()!));
  return outcomes;
}

export function resetJobQueue(): void {
  queuedJobs.length = 0;
  failures = 0;
}
