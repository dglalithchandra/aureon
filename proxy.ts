import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { checkRateLimit } from "@/lib/security/rate-limit";

export const config = {
  matcher: ["/api/:path*"],
};

function getClientIp(req: NextRequest): string {
  const xff = req.headers.get("x-forwarded-for");
  if (xff) return xff.split(",")[0]!.trim();
  const realIp = req.headers.get("x-real-ip");
  if (realIp) return realIp.trim();
  return "anonymous";
}

export async function proxy(req: NextRequest): Promise<NextResponse> {
  const ip = getClientIp(req);
  const result = await checkRateLimit(`ip:${ip}`);

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
