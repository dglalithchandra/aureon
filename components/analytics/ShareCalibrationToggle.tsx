"use client";
import { useState } from "react";
import { Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Joining the shared calibration pool, which is off until someone turns it
 * on. What the toggle says is what the query does: aggregate numbers and
 * the fixed domain label, never a brief, a note, a module name or a title.
 */
export function ShareCalibrationToggle({
  workspaceId,
  enabled,
}: {
  workspaceId: string;
  enabled: boolean;
}): React.ReactElement {
  const [on, setOn] = useState(enabled);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function toggle(): Promise<void> {
    const next = !on;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/workspaces/${workspaceId}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ shareCalibration: next }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as {
          error?: { message: string };
        } | null;
        setError(body?.error?.message ?? "Could not change that.");
        return;
      }
      setOn(next);
    } catch {
      setError("Could not reach the server.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="border-blueprint-line/20 flex flex-col gap-3 rounded-xl border bg-white/[0.02] p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="text-blueprint-text text-sm font-medium">
            Share anonymous factors with other workspaces
          </p>
          <p className="text-blueprint-muted mt-1 text-xs leading-relaxed">
            Off by default. When it is on, this workspace&apos;s ratios join a pool other
            opted-in workspaces can use, and you can use theirs while you have fewer than
            five projects of your own. Only numbers and the domain label travel: never a
            brief, a note, a module name, a title or a project id.
          </p>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={on}
          aria-label="Share anonymous calibration factors"
          disabled={busy}
          onClick={() => void toggle()}
          data-testid="share-calibration"
          className={cn(
            "inline-flex h-7 w-14 shrink-0 items-center rounded-full border px-1 transition-colors",
            on
              ? "justify-end border-emerald-400/50 bg-emerald-400/20"
              : "border-blueprint-line/40 justify-start bg-white/[0.04]",
            busy && "opacity-60",
          )}
        >
          {busy ? (
            <Loader2 className="text-blueprint-muted animate-spin" size={14} />
          ) : (
            <span
              className={cn(
                "block h-5 w-5 rounded-full",
                on ? "bg-emerald-300" : "bg-blueprint-line/60",
              )}
            />
          )}
        </button>
      </div>
      {error && (
        <p role="alert" className="text-xs text-red-300">
          {error}
        </p>
      )}
    </div>
  );
}
