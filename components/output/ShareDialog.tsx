"use client";
import { useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Check, Copy, Link2Off, Loader2, X } from "lucide-react";
import { absoluteUrl, ApiError, createShare, revokeShare } from "@/lib/api/client";
import { cn } from "@/lib/utils";

interface ShareDialogProps {
  open: boolean;
  sessionId: string;
  /** The title shown on the output page; stored in the snapshot. */
  title: string;
  onClose(): void;
}

interface ActiveLink {
  token: string;
  url: string;
  createdAt: number;
}

const SNAPSHOT_DATE = new Intl.DateTimeFormat("en-US", { dateStyle: "long" });

/** The session's active link, or a new snapshot link. */
async function shareLink(sessionId: string, title: string): Promise<ActiveLink> {
  const r = await createShare(sessionId, title);
  return {
    token: r.token,
    url: absoluteUrl(r.url, window.location.origin),
    createdAt: r.created_at,
  };
}

export function ShareDialog(props: ShareDialogProps): React.ReactElement {
  // Remount on open transitions so internal state is always derived fresh.
  return (
    <AnimatePresence>
      {props.open && <ShareDialogInner key={`${props.sessionId}-open`} {...props} />}
    </AnimatePresence>
  );
}

function ShareDialogInner({
  sessionId,
  title,
  onClose,
}: ShareDialogProps): React.ReactElement {
  const [busy, setBusy] = useState(true);
  const [link, setLink] = useState<ActiveLink | null>(null);
  const [revoked, setRevoked] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let cancelled = false;
    shareLink(sessionId, title)
      .then((next) => {
        if (!cancelled) setLink(next);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setError(err instanceof ApiError ? err.message : "Could not create share link.");
      })
      .finally(() => {
        if (!cancelled) setBusy(false);
      });
    return () => {
      cancelled = true;
    };
  }, [sessionId, title]);

  async function copy(): Promise<void> {
    if (!link) return;
    try {
      await navigator.clipboard.writeText(link.url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      /* ignore */
    }
  }

  async function revoke(): Promise<void> {
    if (!link) return;
    setBusy(true);
    setError(null);
    try {
      await revokeShare(link.token);
      setLink(null);
      setRevoked(true);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not revoke the link.");
    } finally {
      setBusy(false);
    }
  }

  async function shareAgain(): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      setLink(await shareLink(sessionId, title));
      setRevoked(false);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not create share link.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <motion.div
      role="dialog"
      aria-modal="true"
      aria-labelledby="share-dialog-title"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
      onClick={onClose}
    >
      <motion.div
        initial={{ scale: 0.96, y: 8, opacity: 0 }}
        animate={{ scale: 1, y: 0, opacity: 1 }}
        exit={{ scale: 0.96, y: 8, opacity: 0 }}
        transition={{ duration: 0.18 }}
        className="border-blueprint-line/30 bg-blueprint-bg/95 relative mx-4 w-full max-w-md rounded-2xl border p-6 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          type="button"
          aria-label="Close"
          onClick={onClose}
          className="text-blueprint-muted hover:text-blueprint-text absolute top-3 right-3 inline-flex h-8 w-8 items-center justify-center rounded-md"
        >
          <X size={16} />
        </button>
        <h2
          id="share-dialog-title"
          className="text-blueprint-text font-display text-xl font-bold"
        >
          Share read-only link
        </h2>
        <p className="text-blueprint-muted mt-2 text-sm">
          Anyone with this link can view a snapshot of the scope for 30 days. Later edits
          are not included: revoke the link and share again to update it.
        </p>

        <div className="mt-5 flex flex-col gap-3" aria-live="polite">
          {busy && (
            <div className="text-blueprint-muted inline-flex items-center gap-2 text-sm">
              <Loader2 className="animate-spin" size={14} />
              {link ? "Revoking link…" : "Creating link…"}
            </div>
          )}
          {error && (
            <p className="text-sm text-red-300" role="alert">
              {error}
            </p>
          )}
          {link && (
            <>
              <div className="flex items-center gap-2">
                <input
                  readOnly
                  value={link.url}
                  onFocus={(e) => e.currentTarget.select()}
                  className="border-blueprint-line/20 bg-blueprint-bg/40 text-blueprint-text flex-1 rounded-md border px-3 py-2 font-mono text-xs outline-none"
                  aria-label="Shareable URL"
                />
                <button
                  type="button"
                  onClick={copy}
                  className={cn(
                    "inline-flex h-9 items-center gap-1.5 rounded-md border border-[var(--color-blueprint-accent)] px-3 text-xs font-medium text-[var(--color-blueprint-accent)] hover:bg-[var(--color-blueprint-accent)]/15",
                    copied && "border-emerald-400 text-emerald-300",
                  )}
                >
                  {copied ? <Check size={12} /> : <Copy size={12} />}
                  {copied ? "Copied" : "Copy"}
                </button>
              </div>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-blueprint-muted text-xs">
                  Snapshot taken {SNAPSHOT_DATE.format(link.createdAt)}.
                </p>
                <button
                  type="button"
                  onClick={revoke}
                  disabled={busy}
                  className="inline-flex items-center gap-1.5 rounded-md border border-red-400/40 px-3 py-1.5 text-xs font-medium text-red-300 hover:bg-red-400/10 disabled:opacity-60"
                >
                  <Link2Off size={12} />
                  Revoke link
                </button>
              </div>
            </>
          )}
          {revoked && !busy && (
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-blueprint-text text-sm">
                Link revoked. Anyone opening it now gets a “not found” page.
              </p>
              <button
                type="button"
                onClick={shareAgain}
                className="inline-flex items-center gap-1.5 rounded-md border border-[var(--color-blueprint-accent)] px-3 py-1.5 text-xs font-medium text-[var(--color-blueprint-accent)] hover:bg-[var(--color-blueprint-accent)]/15"
              >
                Create a new link
              </button>
            </div>
          )}
        </div>
      </motion.div>
    </motion.div>
  );
}
