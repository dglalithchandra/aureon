import { CheckCircle2, ShieldAlert } from "lucide-react";
import type { OutputConsistencyReport } from "@/lib/schemas/output";

export function ConsistencyBanner({
  report,
}: {
  report: OutputConsistencyReport | undefined;
}): React.ReactElement | null {
  if (!report || report.issues.length === 0) return null;
  const blocking = report.issues.filter((issue) => issue.severity === "blocking");
  const repaired = report.issues.filter((issue) => issue.severity === "repaired");
  const warnings = report.issues.filter((issue) => issue.severity === "warning");
  const unsafe = blocking.length > 0;
  const needsReview = !unsafe && warnings.length > 0;
  const Icon = unsafe || needsReview ? ShieldAlert : CheckCircle2;

  return (
    <section
      aria-labelledby="consistency-heading"
      role={unsafe ? "alert" : "status"}
      className={
        unsafe
          ? "mx-auto mt-6 max-w-7xl rounded-xl border border-red-400/40 bg-red-400/[0.07] px-4 py-3 text-red-200 sm:px-6"
          : needsReview
            ? "mx-auto mt-6 max-w-7xl rounded-xl border border-amber-400/40 bg-amber-400/[0.06] px-4 py-3 text-amber-200 sm:px-6"
            : "mx-auto mt-6 max-w-7xl rounded-xl border border-emerald-400/30 bg-emerald-400/[0.05] px-4 py-3 text-emerald-200 sm:px-6"
      }
    >
      <div className="flex items-start gap-3">
        <Icon size={17} className="mt-0.5 shrink-0" aria-hidden="true" />
        <div className="min-w-0">
          <h2 id="consistency-heading" className="text-sm font-semibold">
            {unsafe
              ? "A hard constraint still conflicts"
              : needsReview
                ? "Manual edits need cross-view review"
                : "Client and engineer views aligned"}
          </h2>
          <p className="mt-1 text-xs leading-relaxed opacity-90">
            {unsafe
              ? "The scope remains a review draft and its confidence has been capped. Resolve the item below before approval."
              : needsReview
                ? "Review the client and engineering views together before sharing or approval."
                : `${repaired.length} deterministic correction${repaired.length === 1 ? " was" : "s were"} applied without another AI call.`}
          </p>
          <details className="mt-2 text-xs">
            <summary className="cursor-pointer font-medium">
              View diagnostic details
            </summary>
            <ul className="mt-2 space-y-1.5 pl-4">
              {report.issues.map((issue, index) => (
                <li key={`${issue.code}-${index}`} className="list-disc leading-relaxed">
                  {issue.message}
                </li>
              ))}
            </ul>
          </details>
        </div>
      </div>
    </section>
  );
}
