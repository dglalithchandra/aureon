import "@/lib/server-only";
import type Anthropic from "@anthropic-ai/sdk";
import { PromptModel } from "@/lib/llm/anthropic";
import { callToolWithRepair } from "@/lib/llm/structured";
import {
  ExtractModulesToolOutputSchema,
  ReadmeModuleNameSchema,
  type ExtractModulesToolOutput,
} from "@/lib/schemas/github";
import { promptText } from "@/lib/text/prompt-safe";
import { logger } from "@/lib/logger";
import { BudgetExceededError } from "@/lib/errors";

const PROJECT_DESC_MAX = 4_000;
const README_MAX = 6_000;

const extractModulesTool: Anthropic.Tool = {
  name: "extract_modules",
  description:
    "Identify the major modules / pages / top-level features described in a GitHub repository's README, rate how similar that repo is to the target project, and explain in one sentence why it matched.",
  input_schema: {
    type: "object",
    required: ["modules", "similarity_to_project", "why_relevant"],
    properties: {
      modules: {
        type: "array",
        maxItems: 40,
        description:
          "Module names. Use canonical short names like 'Auth', 'Dashboard', 'Billing', 'Notifications', 'API Keys', 'Webhooks', 'Admin Panel'. One word or short phrase. No punctuation.",
        items: { type: "string", maxLength: 80 },
      },
      similarity_to_project: {
        type: "number",
        minimum: 0,
        maximum: 1,
        description:
          "How conceptually similar this repo is to the target project, 0-1. Score on shared problem domain and feature overlap, not stack.",
      },
      why_relevant: {
        type: "string",
        maxLength: 280,
        description:
          "ONE concise sentence (no period at end) explaining why this repo is similar to the target. Cite the shared problem domain and the most overlapping feature. Bad: 'It's a SaaS app.' Good: 'Same shopify-OAuth dashboard pattern with Stripe billing and per-team RBAC.'",
      },
    },
  },
};

const SYSTEM_PROMPT = `You analyze open-source GitHub repositories to extract reusable module patterns.

You receive: (1) the target software project description and (2) one repo's README text. Your output is a list of major modules described in the README plus a similarity score for how relevant the repo is to the target project.

Rules:
  - Use canonical short module names. Map vendor-specific names to standard ones (e.g. "Stripe Webhooks" → "Webhooks", "Tenant Manager" → "Multi-tenancy").
  - Skip: language/framework names, infra (Docker/K8s), build tools, license/contributor sections, screenshots, badges.
  - 5-15 modules per repo is typical. Never exceed 40.
  - Similarity 0-1: 0 = totally unrelated, 1 = same concept and same feature scope. Most legitimate matches are 0.4-0.8.
  - Always call the extract_modules tool exactly once. No free-form text.`;

export async function extractModulesFromReadme(
  projectDescription: string,
  readme: string,
): Promise<ExtractModulesToolOutput | null> {
  const cleanProject = promptText(projectDescription, PROJECT_DESC_MAX);
  const cleanReadme = promptText(readme, README_MAX);

  const t0 = Date.now();
  let outcome;
  try {
    outcome = await callToolWithRepair({
      label: "github.extract_modules",
      toolName: extractModulesTool.name,
      parse: (input) => ExtractModulesToolOutputSchema.safeParse(input),
      params: {
        model: PromptModel.HAIKU,
        max_tokens: 1024,
        system: SYSTEM_PROMPT,
        tools: [extractModulesTool],
        tool_choice: { type: "tool", name: extractModulesTool.name },
        messages: [
          {
            role: "user",
            content: `<target_project>\n${cleanProject}\n</target_project>\n\n<repo_readme>\n${cleanReadme}\n</repo_readme>\n\nCall extract_modules now.`,
          },
        ],
      },
    });
  } catch (err) {
    // The budget error must reach the route as a 503, not become an LLMError.
    if (err instanceof BudgetExceededError) throw err;
    const message = err instanceof Error ? err.message : "unknown";
    logger.warn("github.extract_modules.failure", { message });
    return null;
  }

  logger.info("github.extract_modules.completed", {
    durationMs: Date.now() - t0,
    attempts: outcome.attempts,
    inputTokens: outcome.response.usage.input_tokens,
    outputTokens: outcome.response.usage.output_tokens,
  });

  if (!outcome.ok) {
    // Still invalid after the repair retry: skip this README.
    logger.warn("github.extract_modules.invalid_output", { issues: outcome.issues });
    return null;
  }

  // Normalize module names: collapse whitespace, dedupe case-insensitively,
  // and keep only plain labels — a README is untrusted text (SEC-04).
  const seen = new Set<string>();
  const modules: string[] = [];
  let rejected = 0;
  for (const m of outcome.data.modules) {
    const parsed = ReadmeModuleNameSchema.safeParse(m.replace(/\s+/g, " "));
    if (!parsed.success) {
      rejected++;
      continue;
    }
    const key = parsed.data.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    modules.push(parsed.data);
  }
  if (rejected > 0) logger.warn("github.extract_modules.name_rejected", { rejected });

  return {
    modules,
    similarity_to_project: outcome.data.similarity_to_project,
    why_relevant: outcome.data.why_relevant.trim(),
  };
}
