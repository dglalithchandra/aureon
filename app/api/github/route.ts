import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { z } from "zod";
import { ExtractionResultSchema } from "@/lib/schemas/extraction";
import { GitHubEnrichmentSchema } from "@/lib/schemas/github";
import { enrichWithGitHub } from "@/lib/pipeline/github-enrich";
import { AppError, ValidationError, serializeError } from "@/lib/errors";
import { checkRateLimit } from "@/lib/security/rate-limit";
import { requireJsonContentType } from "@/lib/security/route-helpers";
import { cacheGet, cacheSet, hashKey } from "@/lib/storage/cache";
import { logger } from "@/lib/logger";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const CACHE_TTL_SECONDS = 24 * 60 * 60;

const RequestSchema = z.object({
  rawText: z.string().min(1).max(50_000),
  extraction: ExtractionResultSchema,
});

function getClientIp(req: NextRequest): string {
  const xff = req.headers.get("x-forwarded-for");
  if (xff) return xff.split(",")[0]!.trim();
  return req.headers.get("x-real-ip")?.trim() ?? "anonymous";
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const ctMismatch = requireJsonContentType(req);
  if (ctMismatch) return ctMismatch;

  const ip = getClientIp(req);
  const rate = await checkRateLimit(`github:${ip}`);
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
    return NextResponse.json(
      serializeError(new ValidationError("Invalid JSON body")),
      { status: 400 },
    );
  }

  const parsed = RequestSchema.safeParse(body);
  if (!parsed.success) {
    const message = parsed.error.issues
      .slice(0, 3)
      .map((i) => `${i.path.join(".")}: ${i.message}`)
      .join("; ");
    return NextResponse.json(
      serializeError(new ValidationError(message)),
      { status: 400 },
    );
  }

  // Cache key: domain + sorted module names + top-3 keywords from P-03.
  // Keep this stable so unrelated metadata changes do not bust the cache.
  const { extraction, rawText } = parsed.data;
  const moduleNames = extraction.modules.map((m) => m.name).sort().join("|");
  const keywordsFromP03 =
    extraction.parameters.find((p) => p.id === "P-03")?.evidence ?? "";
  const cacheSource = `${extraction.domain}::${moduleNames}::${keywordsFromP03.slice(0, 200)}`;
  const cacheKey = `github:${hashKey(cacheSource)}`;

  try {
    const cached = await cacheGet<unknown>(cacheKey);
    if (cached) {
      const validated = GitHubEnrichmentSchema.safeParse(cached);
      if (validated.success) {
        logger.info("github.route.cache_hit", { cacheKey });
        return NextResponse.json(
          { enrichment: validated.data, cached: true },
          { headers: { "Cache-Control": "private, s-maxage=86400" } },
        );
      }
      logger.warn("github.route.cache_invalid", { cacheKey });
    }

    const enrichment = await enrichWithGitHub(extraction, rawText);
    await cacheSet(cacheKey, enrichment, CACHE_TTL_SECONDS);
    return NextResponse.json(
      { enrichment, cached: false },
      { headers: { "Cache-Control": "private, s-maxage=86400" } },
    );
  } catch (err) {
    if (err instanceof AppError) {
      return NextResponse.json(serializeError(err), { status: err.statusCode });
    }
    logger.error("github.route.unhandled", {
      message: err instanceof Error ? err.message : "unknown",
    });
    return NextResponse.json(serializeError(err), { status: 500 });
  }
}
