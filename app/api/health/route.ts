import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Liveness probe. Returns 200 with no env / no session / no headers that
 * could leak deployment shape. Safe to expose publicly.
 *
 * The version is wired to package.json at build time via process.env.npm_package_version
 * and falls back to "0.0.0" if absent.
 */
export function GET(): NextResponse {
  return NextResponse.json(
    {
      ok: true,
      version: process.env.npm_package_version ?? "0.0.0",
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
