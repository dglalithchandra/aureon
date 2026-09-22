import { z } from "zod";

/**
 * Background jobs (OPS-01). A route validates the request, takes the
 * session's single-flight lock and queues one of these; the job does the
 * LLM work and releases the lock when it is done.
 *
 *   round             → runRound (the /run and /answer routes)
 *   finalize-client   → the client view   } both queued by /finalize,
 *   finalize-engineer → the engineer view } each saved as soon as it lands
 */
export const JobTypeSchema = z.enum(["round", "finalize-client", "finalize-engineer"]);
export type JobType = z.infer<typeof JobTypeSchema>;

export const JobSchema = z.object({
  type: JobTypeSchema,
  sessionId: z.string().uuid(),
  /** Token of the session lock the route acquired and handed to the job. */
  lockToken: z.string().uuid(),
});
export type Job = z.infer<typeof JobSchema>;

/** What happened to a delivered job (logged, and returned by the endpoint). */
export type JobOutcome =
  | "completed"
  | "failed"
  | "waiting"
  | "duplicate"
  | "stale"
  | "not_found";
