"use client";
import { useState } from "react";
import { motion } from "framer-motion";
import { ConfidenceBadge } from "@/components/output/ConfidenceBadge";
import { ClientView } from "@/components/output/ClientView";
import { EngineerView } from "@/components/output/EngineerView";
import { ExportMenu } from "@/components/output/ExportMenu";
import type { FinalOutput } from "@/lib/schemas/output";
import { cn } from "@/lib/utils";

type Tab = "client" | "engineer";

interface ReadOnlyOutputProps {
  output: FinalOutput;
}

export function ReadOnlyOutput({ output }: ReadOnlyOutputProps): React.ReactElement {
  const [tab, setTab] = useState<Tab>("client");

  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-2">
          <TabButton active={tab === "client"} onClick={() => setTab("client")}>
            Client View
          </TabButton>
          <TabButton active={tab === "engineer"} onClick={() => setTab("engineer")}>
            Engineer View
          </TabButton>
        </div>
        <div className="flex items-center gap-3">
          <ConfidenceBadge badge={output.client.confidence_badge} size="sm" />
          <ExportMenu
            output={output}
            activeTab={tab}
            printTargetId="readonly-print-target"
          />
        </div>
      </div>

      <div id="readonly-print-target" className="min-w-0">
        <motion.div
          key={tab}
          initial={{ opacity: 0, x: 8 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ duration: 0.2 }}
        >
          {tab === "client" ? (
            <ClientView view={output.client} readOnly />
          ) : (
            <EngineerView view={output.engineer} />
          )}
        </motion.div>
      </div>
    </div>
  );
}

function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick(): void;
  children: React.ReactNode;
}): React.ReactElement {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "rounded-full border px-4 py-1.5 text-sm transition-colors",
        active
          ? "border-[var(--color-blueprint-accent)] bg-[var(--color-blueprint-accent)]/15 text-[var(--color-blueprint-accent)]"
          : "border-blueprint-line/20 text-blueprint-muted hover:text-blueprint-text",
      )}
    >
      {children}
    </button>
  );
}
