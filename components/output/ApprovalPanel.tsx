"use client";
import { useState } from "react";
import { CheckCircle2, Loader2, MessageSquareWarning } from "lucide-react";
import { cn } from "@/lib/utils";

interface ApprovalPanelProps {
  token: string;
  versionNumber: number | null;
  /** Set when this version has already been approved. */
  approvedLabel?: string | null;
}

type Decision = "approved" | "changes_requested";

/**
 * What the client sees on an approval link (blueprint step 13).
 *
 * No account, and no power beyond this: the link can record a decision and
 * nothing else. The document above it is the snapshot taken when the link
 * was made, so what is approved is exactly what was read.
 */
export function ApprovalPanel({
  token,
  versionNumber,
  approvedLabel,
}: ApprovalPanelProps): React.ReactElement {
  const [choice, setChoice] = useState<Decision | null>(null);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [comment, setComment] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<{ state: Decision; label: string | null } | null>(
    approvedLabel ? { state: "approved", label: approvedLabel } : null,
  );

  async function submit(decision: Decision): Promise<void> {
    if (!name.trim()) {
      setError("Please add your name, so the team knows who decided.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/share/${encodeURIComponent(token)}/decision`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ decision, name, email: email || undefined, comment }),
      });
      const body = (await res.json()) as {
        state?: Decision;
        version?: { label: string | null } | null;
        error?: { message: string };
      };
      if (!res.ok) {
        setError(body.error?.message ?? "Could not record that. Please try again.");
        return;
      }
      setDone({ state: body.state ?? decision, label: body.version?.label ?? null });
    } catch {
      setError("Could not reach the server. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  if (done) {
    return (
      <section
        aria-live="polite"
        className={cn(
          "rounded-2xl border p-6",
          done.state === "approved"
            ? "border-emerald-400/40 bg-emerald-400/5"
            : "border-amber-400/40 bg-amber-400/5",
        )}
      >
        <h2
          className={cn(
            "font-display flex items-center gap-2 text-lg font-bold",
            done.state === "approved" ? "text-emerald-300" : "text-amber-300",
          )}
        >
          {done.state === "approved" ? (
            <CheckCircle2 size={18} />
          ) : (
            <MessageSquareWarning size={18} />
          )}
          {done.state === "approved" ? "Approved" : "Changes requested"}
        </h2>
        <p className="text-blueprint-muted mt-2 text-sm leading-relaxed">
          {done.state === "approved"
            ? `${done.label ?? "This version"} is locked. The team can see who approved it and when; nothing in it can change from here.`
            : "Your note has gone to the team. They will follow up with a new version."}
        </p>
      </section>
    );
  }

  return (
    <section className="border-blueprint-line/25 rounded-2xl border bg-white/[0.02] p-6">
      <h2 className="text-blueprint-text font-display text-lg font-bold">
        Does this look right?
      </h2>
      <p className="text-blueprint-muted mt-2 text-sm leading-relaxed">
        You are reviewing {versionNumber ? `version ${versionNumber}` : "this version"} of
        the scope above. Approving locks it as the agreed version; asking for changes
        sends your note to the team.
      </p>

      <div className="mt-5 grid gap-3 sm:grid-cols-2">
        <label className="flex flex-col gap-1.5">
          <span className="text-blueprint-muted font-mono text-[10px] tracking-[0.18em] uppercase">
            Your name
          </span>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
            maxLength={120}
            autoComplete="name"
            className="border-blueprint-line/30 text-blueprint-text rounded-lg border bg-white/[0.03] px-3 py-2 text-sm focus:border-[var(--color-blueprint-accent)]/60 focus:outline-none"
          />
        </label>
        <label className="flex flex-col gap-1.5">
          <span className="text-blueprint-muted font-mono text-[10px] tracking-[0.18em] uppercase">
            Email (optional)
          </span>
          <input
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            type="email"
            maxLength={200}
            autoComplete="email"
            className="border-blueprint-line/30 text-blueprint-text rounded-lg border bg-white/[0.03] px-3 py-2 text-sm focus:border-[var(--color-blueprint-accent)]/60 focus:outline-none"
          />
        </label>
      </div>

      <label className="mt-3 flex flex-col gap-1.5">
        <span className="text-blueprint-muted font-mono text-[10px] tracking-[0.18em] uppercase">
          Comment {choice === "changes_requested" && "(what should change?)"}
        </span>
        <textarea
          value={comment}
          onChange={(e) => setComment(e.target.value)}
          rows={3}
          maxLength={2000}
          className="border-blueprint-line/30 text-blueprint-text rounded-lg border bg-white/[0.03] px-3 py-2 text-sm focus:border-[var(--color-blueprint-accent)]/60 focus:outline-none"
        />
      </label>

      {error && (
        <p className="mt-3 text-sm text-red-300" role="alert">
          {error}
        </p>
      )}

      <div className="mt-4 flex flex-wrap gap-2">
        <button
          type="button"
          disabled={busy}
          onClick={() => {
            setChoice("approved");
            void submit("approved");
          }}
          className="inline-flex items-center gap-2 rounded-xl bg-emerald-400 px-4 py-2.5 text-sm font-semibold text-black hover:opacity-90 disabled:opacity-50"
        >
          {busy && choice === "approved" ? (
            <Loader2 className="animate-spin" size={14} />
          ) : (
            <CheckCircle2 size={14} />
          )}
          Approve
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() => {
            setChoice("changes_requested");
            void submit("changes_requested");
          }}
          className="border-blueprint-line/30 text-blueprint-text inline-flex items-center gap-2 rounded-xl border px-4 py-2.5 text-sm font-medium hover:border-amber-400/50 disabled:opacity-50"
        >
          {busy && choice === "changes_requested" ? (
            <Loader2 className="animate-spin" size={14} />
          ) : (
            <MessageSquareWarning size={14} />
          )}
          Request changes
        </button>
      </div>

      <p className="text-blueprint-muted mt-4 text-xs leading-relaxed">
        We record your name, the time and — so two decisions can be told apart — a one-way
        hash of your network address. Your address itself is not stored.
      </p>
    </section>
  );
}
