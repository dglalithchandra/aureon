import { describe, expect, it } from "vitest";
import { canonicalModuleKey, mergeGitHubSignals } from "@/lib/pipeline/merge";
import type { ModuleCandidate } from "@/lib/schemas/extraction";
import type { GitHubEnrichment } from "@/lib/schemas/github";
import { makeExtraction } from "../fixtures/llm";

function enrichment(module_frequency: Record<string, number>): GitHubEnrichment {
  return { matches: [], module_frequency, query_used: "q", variants: [] };
}

function mod(name: string): ModuleCandidate {
  return {
    name,
    description: `${name} module`,
    size: "SMALL",
    source_signal: "Mentioned in brief",
    github_validated: false,
  };
}

describe("mergeGitHubSignals", () => {
  it("returns the extraction untouched when there is no module frequency", () => {
    const extraction = makeExtraction();
    expect(mergeGitHubSignals(extraction, enrichment({}))).toBe(extraction);
  });

  it("marks existing modules as validated, ignoring case, punctuation and plurals", () => {
    const extraction = makeExtraction({
      modules: [mod("Notification"), mod("API-Keys"), mod("Reporting")],
    });

    const merged = mergeGitHubSignals(
      extraction,
      enrichment({ notifications: 0.4, "api keys": 0.3 }),
    );

    expect(merged.modules.map((m) => [m.name, m.github_validated])).toEqual([
      ["Notification", true],
      ["API-Keys", true],
      ["Reporting", false],
    ]);
  });

  it("adds new modules only when their weight reaches 1.0, strongest first", () => {
    const merged = mergeGitHubSignals(
      makeExtraction({ modules: [mod("Auth")] }),
      enrichment({ Webhooks: 1.0, Billing: 1.6, Search: 0.99 }),
    );

    expect(merged.modules.map((m) => m.name)).toEqual(["Auth", "Billing", "Webhooks"]);
    const billing = merged.modules[1]!;
    expect(billing.github_validated).toBe(true);
    expect(billing.size).toBe("LARGE"); // payment/billing size hint
    expect(billing.source_signal).toContain("weight 1.60");
    expect(merged.modules[2]!.size).toBe("SMALL"); // no hint → SMALL
  });

  it("keeps the highest-weighted spelling when two names share a key", () => {
    const merged = mergeGitHubSignals(
      makeExtraction({ modules: [] }),
      enrichment({ Webhook: 0.5, Webhooks: 1.2 }),
    );
    expect(merged.modules.map((m) => m.name)).toEqual(["Webhooks"]);
  });

  it("caps the module list at 40", () => {
    const existing = Array.from({ length: 39 }, (_, i) => mod(`Existing ${i}`));
    const merged = mergeGitHubSignals(
      makeExtraction({ modules: existing }),
      enrichment({ Alpha: 2, Beta: 1.5, Gamma: 1.2 }),
    );
    expect(merged.modules).toHaveLength(40);
    expect(merged.modules.at(-1)?.name).toBe("Alpha");
  });

  it("does not mutate its inputs", () => {
    const extraction = makeExtraction({ modules: [mod("Notification")] });
    const before = structuredClone(extraction);
    mergeGitHubSignals(extraction, enrichment({ Notifications: 1.5, Billing: 2 }));
    expect(extraction).toEqual(before);
  });
});

describe("canonicalModuleKey", () => {
  it.each([
    ["Notifications", "notification"],
    ["notification", "notification"],
    ["API-Keys", "apikey"],
    ["api keys", "apikey"],
    ["Admin Panel", "adminpanel"],
    ["SMS", "sms"], // too short to strip a plural "s"
    ["Bus", "bus"],
  ])("maps %j to %j", (name, key) => {
    expect(canonicalModuleKey(name)).toBe(key);
  });
});
