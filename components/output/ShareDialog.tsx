"use client";
import { useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Check, Copy, Loader2, X } from "lucide-react";
import { ApiError, createShare } from "@/lib/api/client";
import { cn } from "@/lib/utils";

interface ShareDialogProps {
  open: boolean;
  sessionId: string;
  onClose(): void;
}

export function ShareDialog(props: ShareDialogProps): React.ReactElement {
  // Remount on open transitions so internal state is always derived fresh.
  return (
    <AnimatePresence>
      {props.open && (
        <ShareDialogInner key={`${props.sessionId}-open`} {...props} />
      )}
    </AnimatePresence>
  );
}

function ShareDialogInner({
  sessionId,
  onClose,
}: ShareDialogProps): React.ReactElement {
  const [loading, setLoading] = useState(true);
  const [url, setUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let cancelled = false;
    createShare(sessionId)
      .then((r) => {
        if (cancelled) return;
        const absolute = `${window.location.origin}${r.url}`;
        setUrl(absolute);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setError(
          err instanceof ApiError
            ? err.message
            : "Could not create share link.",
        );
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [sessionId]);

  async function copy(): Promise<void> {
    if (!url) return;
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      /* ignore */
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
          Anyone with this link can view the scope. Edits require the
          owner&apos;s session cookie. Link expires in 30 days.
        </p>

        <div className="mt-5 flex flex-col gap-2">
          {loading && (
            <div className="text-blueprint-muted inline-flex items-center gap-2 text-sm">
              <Loader2 className="animate-spin" size={14} />
              Creating link…
            </div>
          )}
          {error && (
            <p className="text-red-300 text-sm" role="alert">
              {error}
            </p>
          )}
          {url && (
            <div className="flex items-center gap-2">
              <input
                readOnly
                value={url}
                onFocus={(e) => e.currentTarget.select()}
                className="border-blueprint-line/20 bg-blueprint-bg/40 text-blueprint-text flex-1 rounded-md border px-3 py-2 font-mono text-xs outline-none"
                aria-label="Shareable URL"
              />
              <button
                type="button"
                onClick={copy}
                className={cn(
                  "border-[var(--color-blueprint-accent)] text-[var(--color-blueprint-accent)] hover:bg-[var(--color-blueprint-accent)]/15 inline-flex h-9 items-center gap-1.5 rounded-md border px-3 text-xs font-medium",
                  copied && "border-emerald-400 text-emerald-300",
                )}
              >
                {copied ? <Check size={12} /> : <Copy size={12} />}
                {copied ? "Copied" : "Copy"}
              </button>
            </div>
          )}
        </div>
      </motion.div>
    </motion.div>
  );
}
