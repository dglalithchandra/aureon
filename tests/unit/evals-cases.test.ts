import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { EvalCaseSchema, type EvalCase } from "@/evals/lib/types";
import { domainFamily } from "@/evals/lib/metrics";
import { SCOPING } from "@/lib/config/scoping";

/**
 * The labelled set behind evals/run.ts. These tests do not call a model: they
 * check that every case file is valid, that the mix the harness was asked for
 * is actually there, and that no label contradicts itself.
 */

const CASES_DIR = fileURLToPath(new URL("../../evals/cases/", import.meta.url));

const files = readdirSync(CASES_DIR).filter((f) => f.endsWith(".json"));
const cases: Array<{ file: string; parsed: EvalCase }> = files.map((file) => ({
  file,
  parsed: EvalCaseSchema.parse(JSON.parse(readFileSync(join(CASES_DIR, file), "utf8"))),
}));
const tagged = (tag: string): EvalCase[] =>
  cases.map((c) => c.parsed).filter((c) => c.tags.includes(tag as EvalCase["tags"][0]));

describe("every case file is valid", () => {
  it.each(cases.map((c) => [c.file] as const))("%s parses", (file) => {
    const raw = JSON.parse(readFileSync(join(CASES_DIR, file), "utf8"));
    expect(EvalCaseSchema.safeParse(raw).success).toBe(true);
  });

  it("names its file after its id", () => {
    for (const { file, parsed } of cases) expect(file).toBe(`${parsed.id}.json`);
  });

  it("labels all nine parameters", () => {
    for (const { parsed } of cases) {
      for (const p of SCOPING.parameters) {
        expect(parsed.expected.parameters[p.id]).toBeDefined();
      }
    }
  });
});

describe("the set covers what the harness was asked for", () => {
  it("has 30 cases", () => {
    expect(cases).toHaveLength(30);
  });

  it.each([
    ["thin", 5],
    ["blocker", 3],
    ["long", 3],
    ["indian-language", 3],
    ["injection", 2],
  ])("has at least %i %s cases", (tag, count) => {
    expect(tagged(tag).length).toBeGreaterThanOrEqual(count as number);
  });

  it("gives every long case more than 20,000 characters", () => {
    for (const c of tagged("long")) expect(c.text.length).toBeGreaterThan(20_000);
  });

  it("covers the nine domain families", () => {
    const families = new Set(
      cases
        .map((c) => c.parsed.expected.domain)
        .filter((d): d is string => d !== null)
        .map((d) => domainFamily(d)),
    );
    expect([...families].sort()).toEqual([
      "cms",
      "ecommerce",
      "edtech",
      "fintech",
      "healthcare",
      "internal-tools",
      "marketplace",
      "mobile",
      "saas",
    ]);
  });

  it("writes an expected domain the family matcher can place", () => {
    for (const { parsed } of cases) {
      if (parsed.expected.domain === null) continue;
      expect(domainFamily(parsed.expected.domain)).not.toBeNull();
    }
  });
});

describe("no label contradicts itself", () => {
  it("sets blocker exactly when P-01 or P-03 is MISSING", () => {
    for (const { parsed } of cases) {
      const p = parsed.expected.parameters;
      expect(parsed.expected.blocker).toBe(
        p["P-01"] === "MISSING" || p["P-03"] === "MISSING",
      );
    }
  });

  it("expects no modules from a blocker case", () => {
    for (const c of tagged("blocker")) {
      expect(c.expected.must_have_modules).toEqual([]);
    }
  });

  it("gives every injection case a payload to look for", () => {
    for (const c of tagged("injection")) {
      expect(c.expected.forbidden_strings.length).toBeGreaterThan(0);
      // The payload has to be in the input, or the case proves nothing.
      for (const needle of c.expected.forbidden_strings) {
        expect(c.text.toLowerCase()).toContain(needle.toLowerCase());
      }
    }
  });

  it("keeps a thin case thin", () => {
    for (const c of tagged("thin")) expect(c.text.length).toBeLessThan(120);
  });

  it("explains itself in notes", () => {
    for (const { parsed } of cases) expect(parsed.notes.length).toBeGreaterThan(40);
  });
});

describe("label status", () => {
  it("is draft until the owner reviews it", () => {
    // Flip a case to "reviewed" in its file once the labels are confirmed;
    // the report counts both and says so at the top.
    const statuses = new Set(cases.map((c) => c.parsed.label_status));
    for (const status of statuses) expect(["draft", "reviewed"]).toContain(status);
  });
});
