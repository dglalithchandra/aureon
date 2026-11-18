import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { RepoSlugSchema } from "@/lib/schemas/github";

const CaseSchema = z.object({
  id: z.string().min(1),
  label_status: z.enum(["draft", "reviewed"]),
  brief: z.string().min(40),
  relevance: z.record(RepoSlugSchema, z.number().int().min(0).max(3)),
  notes: z.string().min(20),
});

describe("GitHub relevance labels", () => {
  const cases = z
    .array(CaseSchema)
    .min(3)
    .parse(
      JSON.parse(readFileSync(join(process.cwd(), "evals", "github-cases.json"), "utf8")),
    );

  it("covers multiple product families with positive and negative judgments", () => {
    expect(new Set(cases.map((item) => item.id)).size).toBe(cases.length);
    for (const item of cases) {
      const grades = Object.values(item.relevance);
      expect(grades.some((grade) => grade >= 2)).toBe(true);
      expect(grades.some((grade) => grade === 0)).toBe(true);
    }
  });

  it("does not represent draft judgments as human-reviewed accuracy", () => {
    expect(cases.every((item) => item.label_status === "draft")).toBe(true);
  });
});
