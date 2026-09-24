import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { checkRateLimit, RATE_LIMITS } from "@/lib/security/rate-limit";
import { getClientIp } from "@/lib/security/client-ip";
import { buildCsp, newNonce } from "@/lib/security/csp";

export const config = {
  // Everything except the build output and the favicon: the API for rate
  // limiting, every page for the Content-Security-Policy (SEC-03).
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};

const API_PATH = /^\/api\//;

/**
 * One id per request, so a log line, an error report and the response a
 * user is looking at can be lined up afterwards (OBS-01). A caller's own
 * `x-request-id` is kept, which is what a platform or a load test sets.
 */
function requestId(req: NextRequest): string {
  return req.headers.get("x-request-id") ?? crypto.randomUUID();
}

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
  const id = requestId(req);
  // A page gets the policy and nothing else; rate limiting is for the API.
  if (!API_PATH.test(req.nextUrl.pathname)) return withCsp(req, id);
  if (JOB_PATH.test(req.nextUrl.pathname)) return withRequestId(req, id);
  const ip = getClientIp(req);
  const bucket = isPollRequest(req) ? "poll" : "api";
  const { limit, windowSeconds } = RATE_LIMITS[bucket];
  const result = await checkRateLimit(`${bucket}:${ip}`, limit, windowSeconds);

  const headers = new Headers({
    "X-RateLimit-Limit": String(result.limit),
    "X-RateLimit-Remaining": String(result.remaining),
    "X-RateLimit-Reset": String(result.reset),
    "X-Request-Id": id,
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

  const res = withRequestId(req, id);
  headers.forEach((v, k) => res.headers.set(k, v));
  return res;
}

/** The id on the way in (for the route) and on the way out (for the user). */
function withRequestId(req: NextRequest, id: string): NextResponse {
  const requestHeaders = new Headers(req.headers);
  requestHeaders.set("x-request-id", id);
  const res = NextResponse.next({ request: { headers: requestHeaders } });
  res.headers.set("X-Request-Id", id);
  return res;
}

/**
 * The page response, carrying a Content-Security-Policy with a nonce made
 * for this request. Next.js reads the nonce back out of the policy and puts
 * it on every script it renders, so no inline script needs to be trusted by
 * being inline (SEC-03).
 */
function withCsp(req: NextRequest, id: string): NextResponse {
  const nonce = newNonce();
  const policy = buildCsp({ nonce, dev: process.env.NODE_ENV === "development" });

  const requestHeaders = new Headers(req.headers);
  requestHeaders.set("x-nonce", nonce);
  requestHeaders.set("x-request-id", id);
  requestHeaders.set("Content-Security-Policy", policy);

  const res = NextResponse.next({ request: { headers: requestHeaders } });
  res.headers.set("Content-Security-Policy", policy);
  res.headers.set("X-Request-Id", id);
  return res;
}
