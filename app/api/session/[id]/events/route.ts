import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { sessionEventStream } from "@/lib/storage/session-events";
import { requireSessionOwner, validateUuid } from "@/lib/security/route-helpers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface RouteParams {
  params: Promise<{ id: string }>;
}

/**
 * Server-Sent Events: the owned session, re-sent whenever it changes
 * (OPS-01). Replaces most status polling while a job is running; the stream
 * closes after 55 s and the browser's EventSource reconnects by itself.
 */
export async function GET(req: NextRequest, { params }: RouteParams): Promise<Response> {
  const { id } = await params;
  if (!validateUuid(id)) {
    return NextResponse.json(
      { error: { code: "VALIDATION_ERROR", message: "Invalid session id" } },
      { status: 400 },
    );
  }

  const unauthorized = requireSessionOwner(req, id);
  if (unauthorized) return unauthorized;

  return new Response(sessionEventStream(id, { signal: req.signal }), {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      // Stop proxies (nginx and the like) from buffering the stream.
      "X-Accel-Buffering": "no",
    },
  });
}
