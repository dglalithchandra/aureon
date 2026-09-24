"use client";
import { useEffect, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Download,
  FileSpreadsheet,
  FileText,
  FileType2,
  Link2,
  Printer,
} from "lucide-react";
import { clientToMarkdown, engineerToMarkdown } from "@/lib/export/markdown";
import { sanitizeClonedColors } from "@/lib/export/oklab-to-rgb";
import type { FinalOutput } from "@/lib/schemas/output";

interface ExportMenuProps {
  output: FinalOutput;
  /**
   * The project, when the reader is looking at their own. The Word and CSV
   * exports are built on the server — they need the workspace branding, the
   * version number and the approval state — so they appear only here, not
   * on a share link, where the reader has a token and no project access.
   */
  projectId?: string;
  /** Either 'client' or 'engineer'; used for naming and active-tab PDF. */
  activeTab: "client" | "engineer";
  /** ID of the DOM element to print as PDF (the currently active tab). */
  printTargetId: string;
  /** Open the share dialog. */
  onShare?: () => void;
  /** When true, hide the Share button (e.g. on the read-only public view). */
  shareDisabled?: boolean;
}

export function ExportMenu({
  output,
  projectId,
  activeTab,
  printTargetId,
  onShare,
  shareDisabled,
}: ExportMenuProps): React.ReactElement {
  const [open, setOpen] = useState(false);
  const [pdfBusy, setPdfBusy] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent): void => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [open]);

  function downloadMarkdown(): void {
    const md =
      activeTab === "client"
        ? clientToMarkdown(output.client)
        : engineerToMarkdown(output.engineer);
    const filename = `aureon-${activeTab}.md`;
    const blob = new Blob([md], { type: "text/markdown;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    setOpen(false);
  }

  /**
   * The server builds these, so the browser only has to ask for them. A
   * plain navigation would lose the download when the response is an error
   * page, so the link is followed in a hidden anchor either way.
   */
  function serverExport(format: string): void {
    if (!projectId) return;
    setOpen(false);
    const a = document.createElement("a");
    a.href = `/api/projects/${projectId}/export?format=${format}`;
    a.rel = "noopener";
    document.body.appendChild(a);
    a.click();
    a.remove();
  }

  async function exportPdf(): Promise<void> {
    setOpen(false);
    setPdfBusy(true);
    try {
      // html2pdf.js is shipped via dynamic import so it never lands in the
      // initial bundle. The library only ever runs in the browser — no LLM
      // content flows back through the server.
      const target = document.getElementById(printTargetId);
      if (!target) {
        console.error(`PDF target not found: #${printTargetId}`);
        return;
      }
      const mod = (await import("html2pdf.js")) as
        | { default: (el: HTMLElement) => Html2PdfChain }
        | ((el: HTMLElement) => Html2PdfChain);
      const factory = typeof mod === "function" ? mod : mod.default;
      await factory(target)
        .set({
          margin: [12, 12, 12, 12],
          filename: `aureon-${activeTab}.pdf`,
          image: { type: "jpeg", quality: 0.95 },
          html2canvas: {
            scale: 2,
            backgroundColor: "#0a0518",
            // Tailwind v4 emits oklch(); html2canvas can't parse it and
            // throws. Rewrite every resolved oklab/oklch color to rgb in
            // the clone before the canvas renderer reads it.
            onclone: (clonedDoc: Document) => sanitizeClonedColors(clonedDoc),
          },
          jsPDF: { unit: "mm", format: "a4", orientation: "portrait" },
          pagebreak: { mode: ["avoid-all", "css", "legacy"] },
        })
        .save();
    } finally {
      setPdfBusy(false);
    }
  }

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        className="border-blueprint-line/30 bg-blueprint-line/5 text-blueprint-text inline-flex items-center gap-2 rounded-full border px-4 py-2 text-sm font-medium hover:border-[var(--color-blueprint-accent)]/50"
      >
        <Download size={14} />
        Export
      </button>
      <AnimatePresence>
        {open && (
          <motion.ul
            role="menu"
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.15 }}
            className="border-blueprint-line/30 bg-blueprint-bg/95 absolute right-0 z-30 mt-2 w-56 overflow-hidden rounded-lg border shadow-xl backdrop-blur-md"
          >
            <MenuItem onClick={downloadMarkdown}>
              <FileText size={14} />
              Download Markdown
            </MenuItem>
            <MenuItem onClick={exportPdf} disabled={pdfBusy}>
              <Printer size={14} />
              {pdfBusy ? "Generating PDF…" : "Export PDF"}
            </MenuItem>
            {projectId && (
              <>
                <MenuItem
                  onClick={() =>
                    serverExport(activeTab === "client" ? "docx-client" : "docx-engineer")
                  }
                >
                  <FileType2 size={14} />
                  Download Word (.docx)
                </MenuItem>
                <MenuItem onClick={() => serverExport("jira-csv")}>
                  <FileSpreadsheet size={14} />
                  Jira CSV (issues)
                </MenuItem>
                <MenuItem onClick={() => serverExport("linear-csv")}>
                  <FileSpreadsheet size={14} />
                  Linear CSV (issues)
                </MenuItem>
              </>
            )}
            {onShare && (
              <MenuItem
                onClick={() => {
                  setOpen(false);
                  onShare();
                }}
                disabled={shareDisabled}
              >
                <Link2 size={14} />
                Create share link
              </MenuItem>
            )}
          </motion.ul>
        )}
      </AnimatePresence>
    </div>
  );
}

interface Html2PdfChain {
  set(options: Record<string, unknown>): Html2PdfChain;
  save(): Promise<void>;
}

function MenuItem({
  children,
  onClick,
  disabled,
}: {
  children: React.ReactNode;
  onClick(): void;
  disabled?: boolean;
}): React.ReactElement {
  return (
    <li>
      <button
        type="button"
        role="menuitem"
        onClick={onClick}
        disabled={disabled}
        className="hover:bg-blueprint-line/10 text-blueprint-text disabled:text-blueprint-muted flex w-full items-center gap-2 px-3 py-2.5 text-left text-sm disabled:cursor-not-allowed"
      >
        {children}
      </button>
    </li>
  );
}
