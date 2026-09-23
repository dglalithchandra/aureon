import { z } from "zod";

/**
 * Validated, typed environment variables.
 *
 * Server-only. Importing this from any client component is a type error
 * because `serverEnv` is referenced under a guard. If you need a client-side
 * env value, expose it via `NEXT_PUBLIC_*` and add it to `clientEnv` below.
 *
 * Validation runs once on first import. If a required variable is missing
 * the process throws — surfacing config errors at boot rather than at
 * request time.
 */

const serverSchema = z
  .object({
    /**
     * Default LLM provider. `gemini` is the production choice; `openrouter`
     * routes calls through OpenRouter so another free model can be used
     * during local development. Quality drops noticeably on free models —
     * use only for smoke testing.
     */
    LLM_PROVIDER: z.enum(["gemini", "openrouter"]).default("gemini"),
    /** Google AI Studio key (https://aistudio.google.com/apikey). */
    GEMINI_API_KEY: z.string().min(20).optional(),
    /** Model for the pipeline: extraction, questions, both documents. */
    GEMINI_MODEL: z.string().min(1).default("gemini-3.8-flash"),
    /** Cheaper model for small mechanical jobs (README module names). */
    GEMINI_FAST_MODEL: z.string().min(1).default("gemini-3.5-flash-lite"),
    /** Override the API origin. Tests point this at their mock server. */
    GEMINI_BASE_URL: z.string().url().optional(),
    OPENROUTER_API_KEY: z.string().min(20).optional(),
    /** Override the model used when LLM_PROVIDER=openrouter. */
    OPENROUTER_MODEL: z.string().optional(),
    GITHUB_TOKEN: z.string().optional(),
    /**
     * Postgres connection string (Neon's pooled endpoint, or any Postgres).
     * Required in production: projects, shares and accounts live here.
     */
    DATABASE_URL: z.string().url().optional(),
    /**
     * Auth.js. AUTH_SECRET signs the session cookie and the magic-link
     * tokens; the rest turn a sign-in method on. With none of them set the
     * app still runs, anonymously — which is what the tests do.
     */
    AUTH_SECRET: z.string().min(32).optional(),
    AUTH_URL: z.string().url().optional(),
    AUTH_GOOGLE_ID: z.string().optional(),
    AUTH_GOOGLE_SECRET: z.string().optional(),
    /**
     * Magic links are sent over an HTTPS email API (lib/auth/email.ts), not
     * SMTP. EMAIL_API_URL defaults to Resend's endpoint; any API that takes
     * {from, to, subject, html, text} with a bearer token works.
     */
    EMAIL_API_KEY: z.string().optional(),
    EMAIL_API_URL: z.string().url().optional(),
    EMAIL_FROM: z.string().optional(),
    UPSTASH_REDIS_REST_URL: z.string().url().optional(),
    UPSTASH_REDIS_REST_TOKEN: z.string().min(10).optional(),
    /**
     * Set to 1 to run production without Upstash (DATA-01). Sessions, shares,
     * locks and rate limits then live in one process's memory, so this is
     * only safe for a single long-running instance (e.g. local next start).
     */
    ALLOW_MEMORY_STORE: z.enum(["0", "1"]).optional(),
    /**
     * 32+ char secret used to HMAC-sign session ownership cookies.
     * In production set a real secret; if absent in dev we derive a stable
     * per-process secret (logged once) to keep DX friendly.
     */
    SESSION_SECRET: z.string().min(32).optional(),
    /**
     * Upstash QStash (OPS-01): when QSTASH_TOKEN is set, pipeline work is
     * queued through QStash and delivered to POST /api/jobs/[type], which
     * checks the signature with the two signing keys. Without it, jobs run
     * in-process via after() — fine for local dev, not durable.
     */
    QSTASH_TOKEN: z.string().min(10).optional(),
    QSTASH_URL: z.string().url().optional(),
    QSTASH_CURRENT_SIGNING_KEY: z.string().min(10).optional(),
    QSTASH_NEXT_SIGNING_KEY: z.string().min(10).optional(),
    /**
     * Public base URL QStash calls back (e.g. https://aureon.vercel.app).
     * Defaults to the origin of the request that queued the job.
     */
    JOBS_BASE_URL: z.string().url().optional(),
    /**
     * Bearer token Vercel's cron scheduler sends. Without it the retention
     * job refuses to run, so a missing secret cannot become an open endpoint.
     */
    CRON_SECRET: z.string().min(16).optional(),
    /** Set by Vercel when "Protection Bypass for Automation" is enabled. */
    VERCEL_AUTOMATION_BYPASS_SECRET: z.string().min(1).optional(),
    /** Global cap on LLM calls per UTC day, across all users (cost guard). */
    LLM_DAILY_CALL_LIMIT: z.coerce.number().int().min(1).default(2000),
    NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
  })
  .superRefine((data, ctx) => {
    // Each provider needs its own credential; we don't fail fast at boot
    // because most local commands (typecheck, lint) shouldn't require LLM
    // creds — but we do refuse to issue an LLM call without the right key.
    if (data.LLM_PROVIDER === "gemini" && !data.GEMINI_API_KEY) {
      ctx.addIssue({
        code: "custom",
        path: ["GEMINI_API_KEY"],
        message: "GEMINI_API_KEY required when LLM_PROVIDER=gemini (the default)",
      });
    }
    // Without a database there is nowhere to keep projects, shares or
    // accounts, and nothing to fall back on.
    if (data.NODE_ENV === "production" && !data.DATABASE_URL) {
      ctx.addIssue({
        code: "custom",
        path: ["DATABASE_URL"],
        message: "DATABASE_URL is required in production",
      });
    }
    // Serverless instances do not share memory: without Redis, locks and
    // rate limits would be per-instance (DATA-01).
    if (
      data.NODE_ENV === "production" &&
      data.ALLOW_MEMORY_STORE !== "1" &&
      !(data.UPSTASH_REDIS_REST_URL && data.UPSTASH_REDIS_REST_TOKEN)
    ) {
      ctx.addIssue({
        code: "custom",
        path: ["UPSTASH_REDIS_REST_URL"],
        message:
          "UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN are required in production (set ALLOW_MEMORY_STORE=1 to run a single instance on in-memory storage)",
      });
    }
    // A queued job must be verifiable, so QStash needs both signing keys.
    if (
      data.QSTASH_TOKEN &&
      (!data.QSTASH_CURRENT_SIGNING_KEY || !data.QSTASH_NEXT_SIGNING_KEY)
    ) {
      ctx.addIssue({
        code: "custom",
        path: ["QSTASH_CURRENT_SIGNING_KEY"],
        message:
          "QSTASH_CURRENT_SIGNING_KEY and QSTASH_NEXT_SIGNING_KEY are required when QSTASH_TOKEN is set",
      });
    }
    // A sign-in method without AUTH_SECRET would hand out unsigned cookies.
    if (
      data.NODE_ENV === "production" &&
      (data.AUTH_GOOGLE_ID ?? data.EMAIL_API_KEY) &&
      !data.AUTH_SECRET
    ) {
      ctx.addIssue({
        code: "custom",
        path: ["AUTH_SECRET"],
        message:
          "AUTH_SECRET is required once a sign-in method is configured (32+ random characters)",
      });
    }
    if (data.LLM_PROVIDER === "openrouter" && !data.OPENROUTER_API_KEY) {
      ctx.addIssue({
        code: "custom",
        path: ["OPENROUTER_API_KEY"],
        message: "OPENROUTER_API_KEY required when LLM_PROVIDER=openrouter",
      });
    }
  });

const clientSchema = z.object({
  NEXT_PUBLIC_APP_URL: z.string().url().optional(),
});

type ServerEnv = z.infer<typeof serverSchema>;
type ClientEnv = z.infer<typeof clientSchema>;

let cachedServer: ServerEnv | null = null;

export function getServerEnv(): ServerEnv {
  if (typeof window !== "undefined") {
    throw new Error("getServerEnv() called on the client");
  }
  if (cachedServer) return cachedServer;

  const parsed = serverSchema.safeParse(process.env);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `  - ${i.path.join(".")}: ${i.message}`)
      .join("\n");
    throw new Error(`Invalid server environment:\n${issues}`);
  }
  cachedServer = parsed.data;
  return cachedServer;
}

export function getClientEnv(): ClientEnv {
  return clientSchema.parse({
    NEXT_PUBLIC_APP_URL: process.env.NEXT_PUBLIC_APP_URL,
  });
}

export function hasUpstash(): boolean {
  const env = getServerEnv();
  return Boolean(env.UPSTASH_REDIS_REST_URL && env.UPSTASH_REDIS_REST_TOKEN);
}
