"use client";
import { Reorder, useDragControls } from "framer-motion";
import { GripVertical, BadgeCheck } from "lucide-react";
import { SectionEditor } from "@/components/output/SectionEditor";
import type { ClientModule } from "@/lib/schemas/output";
import { cn } from "@/lib/utils";

const SIZE_BADGE: Record<ClientModule["size"], string> = {
  SMALL: "bg-emerald-400/10 text-emerald-300 border-emerald-400/30",
  MEDIUM:
    "bg-[var(--color-blueprint-accent)]/10 text-[var(--color-blueprint-accent)] border-[var(--color-blueprint-accent)]/30",
  LARGE: "bg-amber-400/10 text-amber-300 border-amber-400/30",
};

interface ModuleCardProps {
  module: ClientModule;
  readOnly?: boolean;
  onChange?(next: ClientModule): void;
}

export function ModuleCard({
  module,
  readOnly,
  onChange,
}: ModuleCardProps): React.ReactElement {
  const drag = useDragControls();

  return (
    <Reorder.Item
      value={module}
      dragListener={false}
      dragControls={drag}
      whileHover={readOnly ? undefined : { y: -2, transition: { duration: 0.18 } }}
      whileDrag={{ scale: 1.02 }}
      className={cn(
        "border-blueprint-line/20 relative flex flex-col gap-3 rounded-xl border bg-white/[0.025] p-5 backdrop-blur-md transition-shadow",
        !readOnly && "hover:shadow-[0_0_24px_rgba(236,72,153,0.22)]",
      )}
    >
      <header className="flex items-start gap-3">
        {!readOnly && (
          <button
            type="button"
            aria-label="Reorder module"
            onPointerDown={(e) => drag.start(e)}
            className="text-blueprint-muted hover:text-blueprint-text mt-1 cursor-grab touch-none active:cursor-grabbing"
          >
            <GripVertical size={16} />
          </button>
        )}
        <div className="min-w-0 flex-1">
          <SectionEditor
            ariaLabel="Module name"
            value={module.name}
            disabled={readOnly}
            maxLength={80}
            onConfirm={(next) => onChange && onChange({ ...module, name: next })}
            inputClassName="font-display text-lg font-bold"
            className="text-blueprint-text font-display text-lg font-bold"
          />
        </div>
        <span
          className={cn(
            "shrink-0 rounded-full border px-2 py-0.5 font-mono text-[10px] tracking-[0.18em] uppercase",
            SIZE_BADGE[module.size],
          )}
        >
          {module.size.toLowerCase()}
        </span>
      </header>

      <SectionEditor
        ariaLabel="Module description"
        value={module.description}
        disabled={readOnly}
        multiline
        maxLength={400}
        onConfirm={(next) => onChange && onChange({ ...module, description: next })}
        className="text-blueprint-muted text-sm"
      />

      {module.github_validated && (
        <div className="text-blueprint-muted inline-flex items-center gap-1.5 text-[11px]">
          <BadgeCheck size={13} className="text-[var(--color-blueprint-accent)]" />
          Validated against similar open-source projects
        </div>
      )}
    </Reorder.Item>
  );
}
