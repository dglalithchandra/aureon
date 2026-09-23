"use client";
import { Reorder, useDragControls } from "framer-motion";
import { GripVertical } from "lucide-react";
import { SectionEditor } from "@/components/output/SectionEditor";
import { ModuleConfidenceChip, SeenInRepos } from "@/components/output/ModuleConfidence";
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
  /**
   * Off for a card that is not inside a Reorder.Group — the candidate list,
   * which is a separate section. framer-motion throws if a Reorder.Item has
   * no group above it.
   */
  draggable?: boolean;
  onChange?(next: ClientModule): void;
}

export function ModuleCard({
  module,
  readOnly,
  draggable = true,
  onChange,
}: ModuleCardProps): React.ReactElement {
  const drag = useDragControls();
  const reorderable = draggable && !readOnly;

  const className = cn(
    "border-blueprint-line/20 relative flex flex-col gap-3 rounded-xl border bg-white/[0.025] p-5 backdrop-blur-md transition-shadow",
    !readOnly && "hover:shadow-[0_0_24px_rgba(236,72,153,0.22)]",
  );

  const body = (
    <>
      <header className="flex items-start gap-3">
        {reorderable && (
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
        <ModuleConfidenceChip confidence={module.confidence} />
        {readOnly ? (
          <span
            className={cn(
              "shrink-0 rounded-full border px-2 py-0.5 font-mono text-[10px] tracking-[0.18em] uppercase",
              SIZE_BADGE[module.size],
            )}
          >
            {module.size.toLowerCase()}
          </span>
        ) : (
          // Size drives the estimate (step 10), so correcting it here changes
          // the sprint count on the next finalize.
          <select
            aria-label={`Size of ${module.name}`}
            value={module.size}
            onChange={(e) =>
              onChange?.({ ...module, size: e.target.value as ClientModule["size"] })
            }
            className={cn(
              "shrink-0 rounded-full border px-2 py-0.5 font-mono text-[10px] tracking-[0.18em] uppercase",
              SIZE_BADGE[module.size],
            )}
          >
            {(["SMALL", "MEDIUM", "LARGE"] as const).map((size) => (
              <option key={size} value={size} className="bg-blueprint-bg">
                {size.toLowerCase()}
              </option>
            ))}
          </select>
        )}
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

      <SeenInRepos seenIn={module.seen_in} validated={module.github_validated} />
    </>
  );

  if (!reorderable) {
    return <div className={className}>{body}</div>;
  }

  return (
    <Reorder.Item
      value={module}
      dragListener={false}
      dragControls={drag}
      whileHover={{ y: -2, transition: { duration: 0.18 } }}
      whileDrag={{ scale: 1.02 }}
      className={className}
    >
      {body}
    </Reorder.Item>
  );
}
