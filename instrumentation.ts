/**
 * Runs once when a Next.js server instance starts, before it handles
 * requests. In production it validates the server environment, so a missing
 * required setting (for example Upstash, DATA-01) stops the server at startup
 * instead of surfacing later as sessions that randomly disappear.
 */
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  if (process.env.NODE_ENV !== "production") return;
  const { getServerEnv } = await import("@/lib/env");
  getServerEnv();
}
