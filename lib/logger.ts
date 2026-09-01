/**
 * Tiny structured logger. Wraps console with a JSON output shape so it can
 * be swapped for pino or Vercel's logger later without changing call sites.
 *
 * Never log secrets, full prompts, or raw user input. Log shapes only.
 */

type Level = "debug" | "info" | "warn" | "error";

interface LogEntry {
  level: Level;
  msg: string;
  ts: string;
  [key: string]: unknown;
}

const IS_DEV = process.env.NODE_ENV !== "production";

function emit(level: Level, msg: string, meta?: Record<string, unknown>): void {
  const entry: LogEntry = { level, msg, ts: new Date().toISOString(), ...meta };
  const payload = JSON.stringify(entry);
  if (level === "error") {
    // In dev, route error-level logs through console.warn. Next.js 16's
    // dev overlay intercepts console.error and pops a full-screen red modal
    // even when the error is already caught and surfaced to the user via a
    // dismissible banner. console.warn keeps the log visible in the terminal
    // + browser console without hijacking the screen. Production still uses
    // console.error so log aggregators (Vercel, Datadog) classify it right.
    if (IS_DEV) console.warn(payload);
    else console.error(payload);
  } else if (level === "warn") {
    console.warn(payload);
  } else {
    // eslint-disable-next-line no-console
    console.log(payload);
  }
}

export const logger = {
  debug: (msg: string, meta?: Record<string, unknown>) =>
    process.env.NODE_ENV !== "production" && emit("debug", msg, meta),
  info: (msg: string, meta?: Record<string, unknown>) => emit("info", msg, meta),
  warn: (msg: string, meta?: Record<string, unknown>) => emit("warn", msg, meta),
  error: (msg: string, meta?: Record<string, unknown>) => emit("error", msg, meta),
};
