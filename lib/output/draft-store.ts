import { FinalOutputSchema, type FinalOutput } from "@/lib/schemas/output";

/**
 * The 10-second autosave of unsaved output edits (UX-02).
 *
 * It writes to this browser, not to the server: every saved edit becomes an
 * immutable version (blueprint step 14), and a version every ten seconds
 * would bury the real ones. So the draft waits here until the owner presses
 * Save, and the page offers it back after a crash or a closed tab.
 *
 * Anything stored is re-validated on read — a draft written by an older
 * schema is dropped rather than trusted.
 */

export interface StoredDraft {
  savedAt: number;
  output: FinalOutput;
}

export function draftKey(sessionId: string): string {
  return `aureon:draft:${sessionId}`;
}

export function readDraft(sessionId: string): StoredDraft | null {
  if (typeof window === "undefined") return null;
  let raw: string | null;
  try {
    raw = window.localStorage.getItem(draftKey(sessionId));
  } catch {
    return null; // Private mode, or storage disabled.
  }
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as { savedAt?: unknown; output?: unknown };
    const output = FinalOutputSchema.safeParse(parsed.output);
    if (!output.success) return null;
    const savedAt = typeof parsed.savedAt === "number" ? parsed.savedAt : 0;
    return { savedAt, output: output.data };
  } catch {
    return null;
  }
}

export function writeDraft(sessionId: string, output: FinalOutput): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(
      draftKey(sessionId),
      JSON.stringify({ savedAt: Date.now(), output }),
    );
  } catch {
    /* quota or private mode — the draft is a convenience, not a promise */
  }
}

export function clearDraft(sessionId: string): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(draftKey(sessionId));
  } catch {
    /* ignore */
  }
}

/** Same document? Used to decide whether a stored draft is worth offering. */
export function sameOutput(a: FinalOutput, b: FinalOutput): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}
