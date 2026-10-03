"use client";
import { useState } from "react";
import Link from "next/link";
import { Check, Loader2 } from "lucide-react";
import type { ActualModule, StoredActuals } from "@/lib/schemas/actuals";
import type { ModuleSize } from "@/lib/schemas/extraction";
import { cn } from "@/lib/utils";

/**
 * What the project actually cost, recorded by the person who ran it.
 *
 * Nothing here is inferred: every field is something a human knows and the
 * app does not. The estimate it is compared against is shown beside each
 * input, because a number typed without the prediction in view is a number
 * typed against nothing.
 */

const SIZES: ModuleSize[] = ["SMALL", "MEDIUM", "LARGE"];

const ACCURACY_LABELS: Record<number, string> = {
  1: "Nothing like the scope",
  2: "Large parts were wrong",
  3: "Roughly right",
  4: "Right, with small gaps",
  5: "The scope was right",
};

interface ActualsFormProps {
  projectId: string;
  projectTitle: string;
  estimate: {
    sprints: number;
    teamSize: number;
    points: number;
  };
  modules: Array<{ name: string; estimatedSize: ModuleSize }>;
  existing: StoredActuals | null;
}

export function ActualsForm({
  projectId,
  projectTitle,
  estimate,
  modules,
  existing,
}: ActualsFormProps): React.ReactElement {
  const [weeks, setWeeks] = useState(
    String(existing?.actualWeeks ?? estimate.sprints * 2),
  );
  const [teamSize, setTeamSize] = useState(
    String(existing?.actualTeamSize ?? estimate.teamSize),
  );
  const [accuracy, setAccuracy] = useState(existing?.scopeAccuracy ?? 3);
  const [note, setNote] = useState(existing?.note ?? "");
  const [rows, setRows] = useState<ActualModule[]>(() => {
    // Matched by name, not by position: the scope's module list can change
    // between one recording and the next, and row 3 is not a module.
    const previous = new Map(existing?.modules.map((m) => [m.name, m]) ?? []);
    return modules.map((m) => {
      const was = previous.get(m.name);
      return {
        name: m.name,
        estimatedSize: m.estimatedSize,
        actualSize: was?.actualSize ?? m.estimatedSize,
        actualSprints: was?.actualSprints ?? 0,
      };
    });
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  function updateRow(index: number, patch: Partial<ActualModule>): void {
    setRows((current) =>
      current.map((row, i) => (i === index ? { ...row, ...patch } : row)),
    );
  }

  async function submit(): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/projects/${projectId}/actuals`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({
          actualWeeks: Number(weeks),
          actualTeamSize: Number(teamSize),
          scopeAccuracy: accuracy,
          note,
          modules: rows,
        }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as {
          error?: { message: string };
        } | null;
        setError(body?.error?.message ?? "Could not record that.");
        return;
      }
      setDone(true);
    } catch {
      setError("Could not reach the server.");
    } finally {
      setBusy(false);
    }
  }

  if (done) {
    return (
      <section
        aria-live="polite"
        data-testid="actuals-saved"
        className="rounded-2xl border border-emerald-400/40 bg-emerald-400/5 p-6"
      >
        <h2 className="font-display flex items-center gap-2 text-lg font-bold text-emerald-300">
          <Check size={18} />
          Recorded
        </h2>
        <p className="text-blueprint-muted mt-2 text-sm leading-relaxed">
          {projectTitle} is now part of your calibration. Once five projects have been
          recorded, new estimates are adjusted by what they actually took —{" "}
          <Link href="/analytics" className="underline">
            see how the estimates are doing
          </Link>
          .
        </p>
      </section>
    );
  }

  return (
    <form
      className="flex flex-col gap-8"
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
    >
      <section className="flex flex-col gap-4">
        <h2 className="text-blueprint-text font-display text-xl font-bold">
          The project overall
        </h2>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field
            label="Weeks it actually took"
            hint={`Estimated ${estimate.sprints} sprints (${estimate.sprints * 2} weeks)`}
          >
            <input
              type="number"
              min={1}
              max={260}
              required
              value={weeks}
              onChange={(e) => setWeeks(e.target.value)}
              className={inputClass}
            />
          </Field>
          <Field label="People on it" hint={`Estimated a team of ${estimate.teamSize}`}>
            <input
              type="number"
              min={1}
              max={60}
              required
              value={teamSize}
              onChange={(e) => setTeamSize(e.target.value)}
              className={inputClass}
            />
          </Field>
        </div>

        <fieldset className="flex flex-col gap-2">
          <legend className="text-blueprint-muted font-mono text-[10px] tracking-[0.18em] uppercase">
            Scope accuracy
          </legend>
          <div className="flex flex-wrap gap-2">
            {[1, 2, 3, 4, 5].map((value) => (
              <label
                key={value}
                className={cn(
                  "cursor-pointer rounded-full border px-3 py-1.5 text-xs",
                  accuracy === value
                    ? "border-[var(--color-blueprint-accent)] bg-[var(--color-blueprint-accent)]/15 text-[var(--color-blueprint-accent)]"
                    : "border-blueprint-line/30 text-blueprint-muted",
                )}
              >
                <input
                  type="radio"
                  name="accuracy"
                  className="sr-only"
                  checked={accuracy === value}
                  onChange={() => setAccuracy(value)}
                />
                {value} — {ACCURACY_LABELS[value]}
              </label>
            ))}
          </div>
        </fieldset>

        <Field label="What the scope missed" hint="Optional, and kept in this workspace">
          <textarea
            rows={3}
            maxLength={2000}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            className={cn(inputClass, "resize-none")}
          />
        </Field>
      </section>

      {rows.length > 0 && (
        <section className="flex flex-col gap-4">
          <h2 className="text-blueprint-text font-display text-xl font-bold">
            Per module
          </h2>
          <div className="border-blueprint-line/20 overflow-x-auto rounded-xl border">
            <table className="w-full text-left text-sm">
              <thead className="text-blueprint-muted bg-blueprint-line/5 font-mono text-[10px] tracking-[0.18em] uppercase">
                <tr>
                  <th className="px-4 py-3 font-medium">Module</th>
                  <th className="px-4 py-3 font-medium">Estimated</th>
                  <th className="px-4 py-3 font-medium">Actually</th>
                  <th className="px-4 py-3 font-medium">Sprints</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row, i) => (
                  <tr key={row.name} className="border-blueprint-line/10 border-t">
                    <td className="text-blueprint-text px-4 py-2 font-medium">
                      {row.name}
                    </td>
                    <td className="text-blueprint-muted px-4 py-2 font-mono text-xs">
                      {row.estimatedSize.toLowerCase()}
                    </td>
                    <td className="px-4 py-2">
                      <select
                        aria-label={`Actual size of ${row.name}`}
                        value={row.actualSize}
                        onChange={(e) =>
                          updateRow(i, { actualSize: e.target.value as ModuleSize })
                        }
                        className="border-blueprint-line/30 text-blueprint-text rounded-md border bg-white/[0.03] px-2 py-1 text-xs capitalize"
                      >
                        {SIZES.map((size) => (
                          <option key={size} value={size} className="bg-blueprint-bg">
                            {size.toLowerCase()}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td className="px-4 py-2">
                      <input
                        type="number"
                        min={0}
                        max={100}
                        step={0.5}
                        aria-label={`Sprints ${row.name} actually took`}
                        value={row.actualSprints}
                        onChange={(e) =>
                          updateRow(i, { actualSprints: Number(e.target.value) })
                        }
                        className="border-blueprint-line/30 text-blueprint-text w-20 rounded-md border bg-white/[0.03] px-2 py-1 text-xs"
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="text-blueprint-muted text-xs leading-relaxed">
            Leave a module at 0 sprints if you cannot separate its time out; it is left
            out of the per-size calibration rather than counted as free.
          </p>
        </section>
      )}

      {error && (
        <p role="alert" className="text-sm text-red-300">
          {error}
        </p>
      )}

      <div className="flex items-center gap-3">
        <button
          type="submit"
          disabled={busy}
          className="inline-flex items-center gap-2 rounded-full border border-[var(--color-blueprint-accent)] bg-[var(--color-blueprint-accent)]/10 px-5 py-2.5 text-sm font-medium text-[var(--color-blueprint-accent)] hover:bg-[var(--color-blueprint-accent)]/20 disabled:opacity-50"
        >
          {busy ? <Loader2 className="animate-spin" size={14} /> : <Check size={14} />}
          {existing ? "Update the record" : "Record actuals"}
        </button>
        <Link href={`/output/${projectId}`} className="text-blueprint-muted text-sm">
          Back to the scope
        </Link>
      </div>
    </form>
  );
}

const inputClass =
  "border-blueprint-line/30 text-blueprint-text w-full rounded-lg border bg-white/[0.03] px-3 py-2 text-sm outline-none focus-visible:border-[var(--color-blueprint-accent)]";

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}): React.ReactElement {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-blueprint-muted font-mono text-[10px] tracking-[0.18em] uppercase">
        {label}
      </span>
      {children}
      {hint && <span className="text-blueprint-muted text-[11px]">{hint}</span>}
    </label>
  );
}
