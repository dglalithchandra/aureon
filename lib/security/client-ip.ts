/**
 * Best-effort client IP for rate-limit keys: the first X-Forwarded-For entry,
 * then X-Real-IP, then "anonymous". Shared by proxy.ts and the route helpers.
 *
 * Both headers are client-controllable unless the hosting platform overwrites
 * them, so treat the result as a hint, not an identity.
 */
export function getClientIp(req: { headers: Headers }): string {
  const forwarded = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  if (forwarded) return forwarded;
  const realIp = req.headers.get("x-real-ip")?.trim();
  if (realIp) return realIp;
  return "anonymous";
}
