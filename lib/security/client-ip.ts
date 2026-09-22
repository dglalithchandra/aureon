/**
 * Client IP for rate-limit keys. Shared by proxy.ts and the route helpers.
 *
 * On Vercel (VERCEL is set) the platform writes `x-vercel-forwarded-for` and
 * `x-real-ip` itself and overwrites any value the client sent, so those are
 * trustworthy. This is what `@vercel/functions`' `ipAddress()` reads.
 *
 * Elsewhere the client controls `X-Forwarded-For`, so its FIRST entry is never
 * used. Only the LAST entry is taken: the one appended by the reverse proxy
 * directly in front of the app. Self-hosted deployments must therefore sit
 * behind a proxy that appends to (or sets) X-Forwarded-For; without one the
 * header cannot be trusted at all.
 */

function firstEntry(value: string | null): string | null {
  const first = value?.split(",")[0]?.trim();
  return first ? first : null;
}

function lastEntry(value: string | null): string | null {
  const parts = value
    ?.split(",")
    .map((p) => p.trim())
    .filter(Boolean);
  return parts && parts.length > 0 ? parts[parts.length - 1]! : null;
}

export function getClientIp(req: { headers: Headers }): string {
  const h = req.headers;
  if (process.env.VERCEL) {
    return (
      firstEntry(h.get("x-vercel-forwarded-for")) ??
      firstEntry(h.get("x-real-ip")) ??
      "anonymous"
    );
  }
  return (
    lastEntry(h.get("x-forwarded-for")) ?? firstEntry(h.get("x-real-ip")) ?? "anonymous"
  );
}
