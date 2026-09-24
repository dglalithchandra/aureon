import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import {
  extractDocumentText,
  MAX_UPLOAD_BYTES,
  type ImportKind,
} from "@/lib/import/extract";
import { USER_CONTENT_BUDGET_BYTES } from "@/lib/text/budget";
import { gateRateLimit, getClientIp, jsonError } from "@/lib/security/route-helpers";
import { RATE_LIMITS } from "@/lib/security/rate-limit";
import { ValidationError } from "@/lib/errors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Turn an uploaded requirements document into text the user can read,
 * correct and then submit as a brief.
 *
 * Nothing is stored. The file is read from the request body in memory, the
 * text is returned, and the bytes go when the request does — there is no
 * write to the database, to Redis or to disk anywhere in this path. The
 * session is created later, by the normal POST /api/session, from whatever
 * text the user actually approved.
 *
 * Parsing a file is CPU work on someone else's bytes, so it has a bucket of
 * its own (RATE_LIMITS.upload) on top of the proxy's per-IP limit, and the
 * extractor enforces a size cap, a page cap and a timeout.
 */

interface ImportResponse {
  text: string;
  kind: ImportKind;
  pages: number | null;
  bytes: number;
  truncated: boolean;
  overBudget: boolean;
  /** So the client can word its own warning without hardcoding the number. */
  limitBytes: number;
  fileName: string;
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const contentType = req.headers.get("content-type") ?? "";
  if (!contentType.toLowerCase().includes("multipart/form-data")) {
    return NextResponse.json(
      {
        error: {
          code: "VALIDATION_ERROR",
          message: "Send the file as multipart/form-data",
        },
      },
      { status: 415 },
    );
  }

  const ip = getClientIp(req);
  const { limit, windowSeconds } = RATE_LIMITS.upload;
  const limited = await gateRateLimit(`import:${ip}`, limit, windowSeconds);
  if (limited) return limited;

  try {
    const form = await req.formData();
    const file = form.get("file");
    if (!(file instanceof File)) {
      throw new ValidationError("No file in that upload.");
    }
    // Checked before reading the body into memory as well as inside the
    // extractor, so an oversized upload is refused as early as it can be.
    if (file.size > MAX_UPLOAD_BYTES) {
      throw new ValidationError(
        `That file is ${(file.size / (1024 * 1024)).toFixed(1)} MB and the limit is 5 MB.`,
      );
    }

    const extracted = await extractDocumentText({
      fileName: file.name,
      mimeType: file.type,
      bytes: new Uint8Array(await file.arrayBuffer()),
    });

    const body: ImportResponse = {
      ...extracted,
      limitBytes: USER_CONTENT_BUDGET_BYTES,
      fileName: file.name,
    };
    return NextResponse.json(body);
  } catch (err) {
    return jsonError(err, 500, req);
  }
}
