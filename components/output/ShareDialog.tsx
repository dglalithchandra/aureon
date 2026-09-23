"use client";
import { useCallback, useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Check, Copy, Link2Off, Loader2, ShieldCheck, X } from "lucide-react";
import {
  absoluteUrl,
  ApiError,
  createShare,
  listShares,
  revokeShare,
  type ShareListItem,
} from "@/lib/api/client";
import { cn } from "@/lib/utils";

interface ShareDialogProps {
  open: boolean;
  sessionId: string;
  /** The title shown on the output page; stored in the snapshot. */
  title: string;
  onClose(): void;
}

const EXPIRY_CHOICES = [7, 30, 90] as const;
type ExpiryChoice = (typeof EXPIRY_CHOICES)[number];

const WHEN = new Intl.DateTimeFormat("en-US", { dateStyle: "medium" });

export function ShareDialog(props: ShareDialogProps): React.ReactElement {
  // Remount on open transitions so internal state is always derived fresh.
  return (
    <AnimatePresence>
      {props.open && <ShareDialogInner key={`${props.sessionId}-open`} {...props} />}
    </AnimatePresence>
  );
}

/**
 * Share management (UX-01, and blueprint step 13's approval links).
 *
 * Opening this no longer mints a token: it lists the links that exist, and
 * making one is a deliberate act with an expiry chosen for it. A read-only
 * link shows a snapshot; an approval link shows the same snapshot with
 * Approve and Request changes, and names the version being decided on.
 */
function ShareDialogInner({
  sessionId,
  title,
  onClose,
}: ShareDialogProps): React.ReactElement {
  const [links, setLinks] = useState<ShareListItem[]>([]);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expiry, setExpiry] = useState<ExpiryChoice>(30);
  const [copied, setCopied] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setError(null);
    try {
      setLinks(await listShares(sessionId));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not load the links.");
    }
  }, [sessionId]);

  useEffect(() => {
    let cancelled = false;
    // The state lands after the await, never synchronously in the effect.
    async function load(): Promise<void> {
      try {
        const next = await listShares(sessionId);
        if (!cancelled) setLinks(next);
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof ApiError ? err.message : "Could not load the links.");
        }
      } finally {
        if (!cancelled) setBusy(false);
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [sessionId]);

  async function create(mode: "view" | "approval"): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      await createShare(sessionId, {
        title,
        mode,
        expiresInDays: expiry,
        // An approval link is always its own link: it names a version.
        fresh: mode === "approval",
      });
      await refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not create the link.");
    } finally {
      setBusy(false);
    }
  }

  async function revoke(token: string): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      await revokeShare(token);
      await refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not revoke the link.");
    } finally {
      setBusy(false);
    }
  }

  async function copy(url: string, token: string): Promise<void> {
    try {
      await navigator.clipboard.writeText(absoluteUrl(url, window.location.origin));
      setCopied(token);
      setTimeout(() => setCopied(null), 1800);
    } catch {
      /* clipboard refused; the field is selectable */
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
        className="border-blueprint-line/30 bg-blueprint-bg/95 relative mx-4 w-full max-w-lg rounded-2xl border p-6 shadow-2xl"
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
          Share this scope
        </h2>
        <p className="text-blueprint-muted mt-2 text-sm leading-relaxed">
          A link shows a snapshot taken when it was made — later edits are not included.
          An approval link asks the client to approve that snapshot, and locks the version
          they approve.
        </p>

        <div className="mt-5 flex flex-wrap items-center gap-2">
          <label className="text-blueprint-muted text-xs" htmlFor="share-expiry">
            Expires in
          </label>
          <select
            id="share-expiry"
            value={expiry}
            onChange={(e) => setExpiry(Number(e.target.value) as ExpiryChoice)}
            className="border-blueprint-line/25 text-blueprint-text rounded-lg border bg-white/[0.03] px-2 py-1.5 text-xs"
          >
            {EXPIRY_CHOICES.map((days) => (
              <option key={days} value={days}>
                {days} days
              </option>
            ))}
          </select>
          <button
            type="button"
            onClick={() => void create("view")}
            disabled={busy}
            className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--color-blueprint-accent)] px-3 py-1.5 text-xs font-medium text-[var(--color-blueprint-accent)] hover:bg-[var(--color-blueprint-accent)]/15 disabled:opacity-50"
          >
            Create read-only link
          </button>
          <button
            type="button"
            onClick={() => void create("approval")}
            disabled={busy}
            className="inline-flex items-center gap-1.5 rounded-lg bg-[var(--color-blueprint-accent)] px-3 py-1.5 text-xs font-semibold text-black hover:opacity-90 disabled:opacity-50"
          >
            <ShieldCheck size={13} />
            Send for approval
          </button>
        </div>

        <div className="mt-5 flex flex-col gap-3" aria-live="polite">
          {busy && (
            <div className="text-blueprint-muted inline-flex items-center gap-2 text-sm">
              <Loader2 className="animate-spin" size={14} />
              Working…
            </div>
          )}
          {error && (
            <p className="text-sm text-red-300" role="alert">
              {error}
            </p>
          )}
          {!busy && links.length === 0 && (
            <p className="text-blueprint-muted text-sm">
              No links yet. Nothing is shared until you make one.
            </p>
          )}

          {links.map((link) => (
            <div
              key={link.token}
              className="border-blueprint-line/15 flex flex-col gap-2 rounded-xl border bg-white/[0.02] p-3"
            >
              <div className="flex items-center gap-2">
                <input
                  readOnly
                  value={absoluteUrl(link.url, window.location.origin)}
                  onFocus={(e) => e.currentTarget.select()}
                  className="border-blueprint-line/20 bg-blueprint-bg/40 text-blueprint-text min-w-0 flex-1 rounded-md border px-3 py-2 font-mono text-xs outline-none"
                  aria-label={`Link for ${link.mode === "approval" ? "approval" : "viewing"}`}
                />
                <button
                  type="button"
                  onClick={() => void copy(link.url, link.token)}
                  className={cn(
                    "inline-flex h-9 shrink-0 items-center gap-1.5 rounded-md border border-[var(--color-blueprint-accent)] px-3 text-xs font-medium text-[var(--color-blueprint-accent)] hover:bg-[var(--color-blueprint-accent)]/15",
                    copied === link.token && "border-emerald-400 text-emerald-300",
                  )}
                >
                  {copied === link.token ? <Check size={12} /> : <Copy size={12} />}
                  {copied === link.token ? "Copied" : "Copy"}
                </button>
              </div>
              <div className="text-blueprint-muted flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px]">
                <span
                  className={cn(
                    "rounded-full border px-2 py-0.5 font-mono tracking-[0.16em] uppercase",
                    link.mode === "approval"
                      ? "border-[var(--color-blueprint-accent)]/40 text-[var(--color-blueprint-accent)]"
                      : "border-blueprint-line/30",
                  )}
                >
                  {link.mode === "approval"
                    ? `approval · v${link.version_number ?? "?"}`
                    : "read-only"}
                </span>
                <span>Snapshot {WHEN.format(link.created_at)}</span>
                {link.expires_at && <span>Expires {WHEN.format(link.expires_at)}</span>}
                <button
                  type="button"
                  onClick={() => void revoke(link.token)}
                  disabled={busy}
                  className="ml-auto inline-flex items-center gap-1.5 rounded-md border border-red-400/40 px-2 py-1 font-medium text-red-300 hover:bg-red-400/10 disabled:opacity-60"
                >
                  <Link2Off size={11} />
                  Revoke
                </button>
              </div>
            </div>
          ))}
        </div>
      </motion.div>
    </motion.div>
  );
}
