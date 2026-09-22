import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { checkRateLimit, RATE_LIMITS } from "@/lib/security/rate-limit";
import { getClientIp } from "@/lib/security/client-ip";

export const config = {
  matcher: ["/api/:path*"],
};

const POLL_PATH =
  /^\/api\/(?:session\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}(?:\/events)?|health)$/i;

/**
 * QStash delivers jobs from a few shared IPs, so an IP bucket would throttle
 * every user's jobs together. The job endpoint checks the QStash signature
 * instead.
 */
const JOB_PATH = /^\/api\/jobs\//;

/**
 * Status polls and the session event stream are cheap (storage reads), so
 * they get their own large bucket; everything else shares a smaller one. The
 * LLM routes add a strict per-route limit on top (see RATE_LIMITS.llmRoute).
 */
function isPollRequest(req: NextRequest): boolean {
  return req.method === "GET" && POLL_PATH.test(req.nextUrl.pathname);
}

export async function proxy(req: NextRequest): Promise<NextResponse> {
  if (JOB_PATH.test(req.nextUrl.pathname)) return NextResponse.next();
  const ip = getClientIp(req);
  const bucket = isPollRequest(req) ? "poll" : "api";
  const { limit, windowSeconds } = RATE_LIMITS[bucket];
  const result = await checkRateLimit(`${bucket}:${ip}`, limit, windowSeconds);

  const headers = new Headers({
    "X-RateLimit-Limit": String(result.limit),
    "X-RateLimit-Remaining": String(result.remaining),
    "X-RateLimit-Reset": String(result.reset),
  });

  if (!result.success) {
    headers.set("Retry-After", String(Math.ceil((result.reset - Date.now()) / 1000)));
    return new NextResponse(
      JSON.stringify({
        error: { code: "RATE_LIMITED", message: "Too many requests" },
      }),
      {
        status: 429,
        headers: {
          ...Object.fromEntries(headers.entries()),
          "Content-Type": "application/json",
        },
      },
    );
  }

  const res = NextResponse.next();
  headers.forEach((v, k) => res.headers.set(k, v));
  return res;
}
