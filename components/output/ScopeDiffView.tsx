import { ArrowRight, Minus, PenLine, Plus } from "lucide-react";
import type { AttributedChange, ModuleChange, ScopeDiff } from "@/lib/versions/diff";
import { cn } from "@/lib/utils";

/**
 * What changed between two versions (blueprint step 14).
 *
 * Green added, amber changed, red removed — the mapping lives here so every
 * row of the page reads the same way, and each change carries the
 * clarification answers that mention it.
 */

const TONE = {
  added: "border-emerald-400/40 bg-emerald-400/5 text-emerald-300",
  changed: "border-amber-400/40 bg-amber-400/5 text-amber-300",
  removed: "border-red-500/40 bg-red-500/5 text-red-300",
} as const;

type Tone = keyof typeof TONE;

function toneOf(kind: string): Tone {
  if (kind === "added") return "added";
  if (kind === "removed") return "removed";
  return "changed";
}

function ChangeIcon({ tone }: { tone: Tone }): React.ReactElement {
  if (tone === "added") return <Plus size={13} />;
  if (tone === "removed") return <Minus size={13} />;
  return <PenLine size={13} />;
}

function moduleLabel(change: ModuleChange): React.ReactNode {
  if (change.kind === "renamed") {
    return (
      <>
        <span className="line-through opacity-70">{change.previousName}</span>
        <ArrowRight size={12} className="mx-1 inline" />
        {change.name}
        {change.fromSize && change.toSize && (
          <span className="ml-2 font-mono text-[10px] tracking-[0.16em] uppercase opacity-80">
            {change.fromSize} → {change.toSize}
          </span>
        )}
      </>
    );
  }
  if (change.kind === "resized") {
    return (
      <>
        {change.name}
        <span className="ml-2 font-mono text-[10px] tracking-[0.16em] uppercase opacity-80">
          {change.fromSize} → {change.toSize}
        </span>
      </>
    );
  }
  return change.name;
}

function Row({
  tone,
  children,
  answers,
}: {
  tone: Tone;
  children: React.ReactNode;
  answers: AttributedChange["answers"];
}): React.ReactElement {
  return (
    <li className={cn("rounded-xl border px-4 py-3 text-sm", TONE[tone])}>
      <div className="flex items-start gap-2">
        <span className="mt-0.5 shrink-0">
          <ChangeIcon tone={tone} />
        </span>
        <div className="min-w-0">
          <p className="break-words">{children}</p>
          {answers.length > 0 && (
            <ul className="text-blueprint-muted mt-2 flex flex-col gap-1 text-[11px]">
              {answers.map((answer, i) => (
                <li key={i}>
                  <span className="font-mono tracking-[0.14em] uppercase opacity-70">
                    round {answer.roundNumber}
                  </span>{" "}
                  — “{answer.question}” → {answer.answer}
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </li>
  );
}

export function ScopeDiffView({
  diff,
  attributed,
}: {
  diff: ScopeDiff;
  attributed: AttributedChange[];
}): React.ReactElement {
  const answersFor = (subject: unknown): AttributedChange["answers"] =>
    attributed.find((entry) => entry.change === subject)?.answers ?? [];

  if (diff.identical) {
    return (
      <p className="border-blueprint-line/20 text-blueprint-muted rounded-2xl border bg-white/[0.02] p-6 text-sm">
        These two versions are the same document.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-8">
      <section className="border-blueprint-line/20 flex flex-wrap items-center gap-6 rounded-2xl border bg-white/[0.025] px-6 py-5">
        <div className="flex flex-col">
          <span className="text-blueprint-muted font-mono text-[10px] tracking-[0.18em] uppercase">
            Confidence
          </span>
          <span className="text-blueprint-text font-display text-2xl font-bold tabular-nums">
            {diff.confidence.from} → {diff.confidence.to}
          </span>
        </div>
        <span
          className={cn(
            "rounded-full border px-3 py-1 font-mono text-xs tabular-nums",
            diff.confidence.delta > 0
              ? TONE.added
              : diff.confidence.delta < 0
                ? TONE.removed
                : TONE.changed,
          )}
        >
          {diff.confidence.delta > 0 ? "+" : ""}
          {diff.confidence.delta}
        </span>
        {diff.summaryChanged && (
          <span className={cn("rounded-full border px-3 py-1 text-xs", TONE.changed)}>
            Summary rewritten
          </span>
        )}
      </section>

      {diff.modules.length > 0 && (
        <section>
          <h2 className="text-blueprint-text font-display mb-3 text-xl font-bold">
            Modules
          </h2>
          <ul className="flex flex-col gap-2">
            {diff.modules.map((change, i) => (
              <Row
                key={`${change.kind}-${change.name}-${i}`}
                tone={toneOf(change.kind)}
                answers={answersFor(change)}
              >
                {moduleLabel(change)}
              </Row>
            ))}
          </ul>
        </section>
      )}

      {diff.assumptions.length > 0 && (
        <section>
          <h2 className="text-blueprint-text font-display mb-3 text-xl font-bold">
            Assumptions
          </h2>
          <ul className="flex flex-col gap-2">
            {diff.assumptions.map((change, i) => (
              <Row key={i} tone={toneOf(change.kind)} answers={answersFor(change)}>
                {change.text}
              </Row>
            ))}
          </ul>
        </section>
      )}

      {diff.openItems.length > 0 && (
        <section>
          <h2 className="text-blueprint-text font-display mb-3 text-xl font-bold">
            Open items
          </h2>
          <ul className="flex flex-col gap-2">
            {diff.openItems.map((change, i) => (
              <Row key={i} tone={toneOf(change.kind)} answers={answersFor(change)}>
                {change.text}
              </Row>
            ))}
          </ul>
        </section>
      )}

      <p className="text-blueprint-muted text-xs leading-relaxed">
        The answers under a change are the ones that mention it. The pipeline does not
        record which answer caused which edit, so treat them as a pointer to the
        conversation, not as proof.
      </p>
    </div>
  );
}
