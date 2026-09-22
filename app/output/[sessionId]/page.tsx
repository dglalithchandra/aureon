import { cookies } from "next/headers";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Home, MessageSquarePlus } from "lucide-react";
import { getSession } from "@/lib/storage/session";
import { SESSION_COOKIE_NAME, verifySessionCookie } from "@/lib/security/session-cookie";
import { FinalizeGate } from "@/components/output/FinalizeGate";
import { BlueprintGrid } from "@/components/landing/BlueprintGrid";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface PageProps {
  params: Promise<{ sessionId: string }>;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function OutputPage({
  params,
}: PageProps): Promise<React.ReactElement> {
  const { sessionId } = await params;
  if (!UUID_RE.test(sessionId)) notFound();

  const jar = await cookies();
  const cookie = jar.get(SESSION_COOKIE_NAME)?.value;
  if (!verifySessionCookie(cookie, sessionId)) {
    return <UnauthorizedView />;
  }

  const session = await getSession(sessionId);
  if (!session) {
    // Session disappeared (server restart, hot reload in dev, or 24h TTL hit).
    // Show a branded inline view that explains the situation and offers a
    // direct path back to a fresh chat — better than a dead-end 404.
    return <SessionExpiredView />;
  }

  const initialTitle = deriveTitle(session.raw_input);

  return <FinalizeGate session={session} initialTitle={initialTitle} />;
}

function deriveTitle(rawInput: string): string {
  const trimmed = rawInput.trim().split(/\n|\.|!|\?/)[0] ?? "";
  const cleaned = trimmed.replace(/\s+/g, " ").trim();
  if (!cleaned) return "Untitled scope";
  return cleaned.length > 80 ? cleaned.slice(0, 77) + "…" : cleaned;
}

function UnauthorizedView(): React.ReactElement {
  return (
    <main className="bg-blueprint-bg flex min-h-[100dvh] items-center justify-center px-6 text-center">
      <div className="max-w-md">
        <p className="text-blueprint-muted font-mono text-[10px] tracking-[0.3em] uppercase">
          401 · unauthorized
        </p>
        <h1 className="text-blueprint-text font-display mt-3 text-2xl font-bold">
          You don&apos;t own this session.
        </h1>
        <p className="text-blueprint-muted mt-3 text-sm">
          The owner needs to share a public link with you. They can generate one from the
          export menu.
        </p>
        <Link
          href="/chat"
          className="mt-6 inline-flex items-center gap-2 text-sm text-[var(--color-blueprint-accent)] hover:underline"
        >
          Start a new scope →
        </Link>
      </div>
    </main>
  );
}

function SessionExpiredView(): React.ReactElement {
  return (
    <main className="bg-blueprint-bg relative isolate flex min-h-[100dvh] items-center justify-center overflow-hidden px-6 text-center">
      <BlueprintGrid intensity="subtle" drift={false} />
      <div
        className="aurora pointer-events-none absolute inset-0 opacity-50"
        aria-hidden
      />
      <div className="relative z-10 max-w-lg">
        <p className="font-mono text-[10px] tracking-[0.3em] text-[var(--color-blueprint-accent)] uppercase">
          Aureon · session expired
        </p>
        <h1 className="text-blueprint-text font-display mt-4 text-3xl font-bold sm:text-4xl">
          That session is gone.
        </h1>
        <p className="text-blueprint-muted mt-4 text-sm leading-relaxed sm:text-base">
          Sessions live in memory for 24 hours. Yours was wiped — most likely the dev
          server was restarted, or the link has been sitting open for a while. Start a
          fresh one and you&apos;ll be back here in a few minutes.
        </p>
        <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
          <Link
            href="/chat"
            className="inline-flex items-center gap-2 rounded-full border border-[var(--color-blueprint-accent)] bg-[var(--color-blueprint-accent)]/10 px-5 py-2.5 text-sm font-medium text-[var(--color-blueprint-accent)] shadow-[0_0_30px_rgba(236,72,153,0.35)] hover:bg-[var(--color-blueprint-accent)]/20"
          >
            <MessageSquarePlus size={14} />
            Start a new scope
          </Link>
          <Link
            href="/"
            className="border-blueprint-line/30 bg-blueprint-line/5 text-blueprint-text inline-flex items-center gap-2 rounded-full border px-5 py-2.5 text-sm hover:border-[var(--color-blueprint-accent)]/50"
          >
            <Home size={14} />
            Back home
          </Link>
        </div>
      </div>
    </main>
  );
}
