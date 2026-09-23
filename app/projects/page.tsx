import Link from "next/link";
import { signOut } from "@/lib/auth/auth";
import { getViewerFromCookies } from "@/lib/auth/viewer";
import { listProjects } from "@/lib/projects/list";
import { ProjectList } from "@/components/projects/ProjectList";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const metadata = {
  title: "Your scopes — Aureon",
  robots: { index: false },
};

/**
 * Every scope this viewer can reach: their own, their workspaces', or — while
 * signed out — whatever this browser made. Signing in on a second device
 * shows the same list, which is the whole point of the accounts work.
 */
export default async function ProjectsPage(): Promise<React.ReactElement> {
  const viewer = await getViewerFromCookies();
  const projects = await listProjects(viewer);

  async function signOutAction(): Promise<void> {
    "use server";
    await signOut({ redirectTo: "/" });
  }

  return (
    <main className="mx-auto flex w-full max-w-4xl flex-col gap-8 px-4 py-12 sm:py-16">
      <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <Link
            href="/"
            className="text-blueprint-muted font-mono text-[10px] tracking-[0.18em] uppercase hover:text-[var(--color-blueprint-accent)]"
          >
            ← Aureon
          </Link>
          <h1 className="text-blueprint-text font-display mt-2 text-3xl font-bold sm:text-4xl">
            Your scopes
          </h1>
          <p className="text-blueprint-muted mt-1 text-sm">
            {viewer.email ? (
              <>Signed in as {viewer.email}</>
            ) : (
              <>
                Not signed in — this browser keeps one scope.{" "}
                <Link
                  href="/sign-in"
                  className="text-[var(--color-blueprint-accent)] underline decoration-dotted underline-offset-4"
                >
                  Sign in
                </Link>{" "}
                to keep them all, on every device.
              </>
            )}
          </p>
        </div>

        <div className="flex items-center gap-2">
          <Link
            href="/chat"
            className="rounded-xl bg-[var(--color-blueprint-accent)] px-4 py-2 text-sm font-semibold text-black transition-opacity hover:opacity-90"
          >
            New scope
          </Link>
          {viewer.userId && (
            <form action={signOutAction}>
              <button
                type="submit"
                className="border-blueprint-line/25 text-blueprint-muted hover:text-blueprint-text rounded-xl border px-4 py-2 text-sm"
              >
                Sign out
              </button>
            </form>
          )}
        </div>
      </header>

      <ProjectList projects={projects} />
    </main>
  );
}
