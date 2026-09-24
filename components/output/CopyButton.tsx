"use client";
import { useState } from "react";
import { Check, Copy } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Copy one section of the scope, as Markdown, without exporting the whole
 * document. The text comes from the same builders the Markdown export uses
 * (lib/export/markdown.ts), so what lands in the clipboard is what a file
 * would have contained.
 */
export function CopyButton({
  text,
  label,
  className,
}: {
  /** Built on click: no point formatting a section nobody copies. */
  text: () => string;
  /** What is being copied, for the screen reader: "Summary". */
  label: string;
  className?: string;
}): React.ReactElement {
  const [state, setState] = useState<"idle" | "copied" | "failed">("idle");

  async function copy(): Promise<void> {
    try {
      await navigator.clipboard.writeText(text());
      setState("copied");
    } catch {
      // Clipboard permission refused, or an insecure origin.
      setState("failed");
    }
    setTimeout(() => setState("idle"), 1800);
  }

  return (
    <button
      type="button"
      onClick={() => void copy()}
      aria-label={`Copy ${label} as Markdown`}
      title={`Copy ${label} as Markdown`}
      data-testid="copy-section"
      className={cn(
        "text-blueprint-muted border-blueprint-line/25 hover:text-blueprint-text inline-flex shrink-0 items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] transition-colors hover:border-[var(--color-blueprint-accent)]/40",
        state === "copied" && "border-emerald-400/40 text-emerald-300",
        state === "failed" && "border-red-400/40 text-red-300",
        className,
      )}
    >
      {state === "copied" ? <Check size={12} /> : <Copy size={12} />}
      <span aria-live="polite">
        {state === "copied" ? "Copied" : state === "failed" ? "Blocked" : "Copy"}
      </span>
    </button>
  );
}
