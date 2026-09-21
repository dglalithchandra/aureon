import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { ExtractRequestSchema } from "@/lib/schemas/extraction";
import { runExtraction } from "@/lib/pipeline/extract";
import { AppError, ValidationError, serializeError } from "@/lib/errors";
import { checkRateLimit } from "@/lib/security/rate-limit";
import { requireJsonContentType } from "@/lib/security/route-helpers";
import { logger } from "@/lib/logger";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function getClientIp(req: NextRequest): string {
  const xff = req.headers.get("x-forwarded-for");
  if (xff) return xff.split(",")[0]!.trim();
  return req.headers.get("x-real-ip")?.trim() ?? "anonymous";
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const ctMismatch = requireJsonContentType(req);
  if (ctMismatch) return ctMismatch;

  // Per-route cost limiter — extract is expensive (one Sonnet call). The
  // proxy.ts limiter applies broadly; this one is stricter for /extract.
  const ip = getClientIp(req);
  const rate = await checkRateLimit(`extract:${ip}`);
  if (!rate.success) {
    return NextResponse.json(
      { error: { code: "RATE_LIMITED", message: "Too many requests" } },
      {
        status: 429,
        headers: {
          "Retry-After": String(Math.ceil((rate.reset - Date.now()) / 1000)),
        },
      },
    );
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(serializeError(new ValidationError("Invalid JSON body")), {
      status: 400,
    });
  }

  const parsed = ExtractRequestSchema.safeParse(body);
  if (!parsed.success) {
    const message = parsed.error.issues
      .slice(0, 3)
      .map((i) => `${i.path.join(".")}: ${i.message}`)
      .join("; ");
    return NextResponse.json(serializeError(new ValidationError(message)), {
      status: 400,
    });
  }

  try {
    const result = await runExtraction(parsed.data);
    return NextResponse.json({ extraction: result });
  } catch (err) {
    if (err instanceof AppError) {
      return NextResponse.json(serializeError(err), { status: err.statusCode });
    }
    logger.error("extract.route.unhandled", {
      message: err instanceof Error ? err.message : "unknown",
    });
    return NextResponse.json(serializeError(err), { status: 500 });
  }
}
