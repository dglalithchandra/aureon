/**
 * Live GitHub relevance evaluation. This intentionally is not part of CI:
 * each case runs extraction plus GitHub README scoring and may spend model
 * credits. Use --dry-run first; draft labels are reported but never presented
 * as validated accuracy.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import { RepoSlugSchema } from "@/lib/schemas/github";
import { mean, ndcgAtK, precisionAtK } from "@/evals/lib/metrics";

const CaseSchema = z.object({
  id: z.string().min(1),
  label_status: z.enum(["draft", "reviewed"]),
  brief: z.string().min(40),
  relevance: z.record(RepoSlugSchema, z.number().int().min(0).max(3)),
  notes: z.string(),
});

function loadEnvFile(path: string): void {
  try {
    for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const split = trimmed.indexOf("=");
      if (split < 0) continue;
      const key = trimmed.slice(0, split).trim();
      let value = trimmed.slice(split + 1).trim();
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }
      if (!process.env[key]) process.env[key] = value;
    }
  } catch {
    // The normal environment validator gives the useful missing-key error.
  }
}

async function main(): Promise<void> {
  loadEnvFile(join(process.cwd(), ".env.local"));
  const cases = z
    .array(CaseSchema)
    .parse(
      JSON.parse(readFileSync(join(process.cwd(), "evals/github-cases.json"), "utf8")),
    );
  const dryRun = process.argv.includes("--dry-run");

  console.log(
    `${dryRun ? "DRY RUN · " : ""}${cases.length} GitHub cases · up to ${cases.length * 3} model calls plus GitHub API requests`,
  );
  if (dryRun) {
    for (const item of cases) console.log(`  ${item.id} [${item.label_status}]`);
    return;
  }

  const [{ runExtraction }, { enrichWithGitHub }] = await Promise.all([
    import("@/lib/pipeline/extract"),
    import("@/lib/pipeline/github-enrich"),
  ]);
  const rows: Array<{ id: string; precision5: number; ndcg5: number; repos: string[] }> =
    [];
  for (const item of cases) {
    const extraction = await runExtraction({ rawText: item.brief });
    const enrichment = await enrichWithGitHub(extraction, item.brief, `eval-${item.id}`);
    const repos = enrichment.matches.map((match) => match.repo.toLowerCase());
    const row = {
      id: item.id,
      precision5: precisionAtK(repos, item.relevance, 5),
      ndcg5: ndcgAtK(repos, item.relevance, 5),
      repos,
    };
    rows.push(row);
    console.log(
      `  ${item.id}: P@5 ${(row.precision5 * 100).toFixed(1)}% · nDCG@5 ${(row.ndcg5 * 100).toFixed(1)}% · ${repos.slice(0, 5).join(", ") || "no matches"}`,
    );
  }

  console.log(
    `Mean: P@5 ${(mean(rows.map((row) => row.precision5)) * 100).toFixed(1)}% · nDCG@5 ${(mean(rows.map((row) => row.ndcg5)) * 100).toFixed(1)}%`,
  );
  const drafts = cases.filter((item) => item.label_status === "draft").length;
  if (drafts > 0) {
    console.log(
      `WARNING: ${drafts}/${cases.length} cases have draft labels. These numbers are diagnostic, not validated accuracy.`,
    );
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
