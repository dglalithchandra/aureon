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
     * Default LLM provider. `anthropic` (Sonnet/Haiku) is the production
     * choice; `openrouter` routes calls through OpenRouter so a free model
     * (e.g. Llama 3.3 70B) can be used during local development.
     * Quality drops noticeably on free models — use only for smoke testing.
     */
    LLM_PROVIDER: z.enum(["anthropic", "openrouter"]).default("anthropic"),
    ANTHROPIC_API_KEY: z.string().min(20).optional(),
    OPENROUTER_API_KEY: z.string().min(20).optional(),
    /** Override the model used when LLM_PROVIDER=openrouter. */
    OPENROUTER_MODEL: z.string().optional(),
    GITHUB_TOKEN: z.string().optional(),
    UPSTASH_REDIS_REST_URL: z.string().url().optional(),
    UPSTASH_REDIS_REST_TOKEN: z.string().min(10).optional(),
  /**
   * 32+ char secret used to HMAC-sign session ownership cookies.
   * In production set a real secret; if absent in dev we derive a stable
   * per-process secret (logged once) to keep DX friendly.
   */
  SESSION_SECRET: z.string().min(32).optional(),
    NODE_ENV: z
      .enum(["development", "production", "test"])
      .default("development"),
  })
  .superRefine((data, ctx) => {
    // Each provider needs its own credential; we don't fail fast at boot
    // because most local commands (typecheck, lint) shouldn't require LLM
    // creds — but we do refuse to issue an LLM call without the right key.
    if (data.LLM_PROVIDER === "anthropic" && !data.ANTHROPIC_API_KEY) {
      ctx.addIssue({
        code: "custom",
        path: ["ANTHROPIC_API_KEY"],
        message:
          "ANTHROPIC_API_KEY required when LLM_PROVIDER=anthropic (the default)",
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
