import "@/lib/server-only";
import type Anthropic from "@anthropic-ai/sdk";
import { createLlmMessage, PromptModel } from "@/lib/llm/anthropic";
import {
  ExtractModulesToolOutputSchema,
  type ExtractModulesToolOutput,
} from "@/lib/schemas/github";
import { stripHtml, truncateText } from "@/lib/security/sanitize";
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
  const cleanProject = truncateText(stripHtml(projectDescription), PROJECT_DESC_MAX);
  const cleanReadme = truncateText(stripHtml(readme), README_MAX);

  const t0 = Date.now();
  let response;
  try {
    response = await createLlmMessage({
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
    inputTokens: response.usage.input_tokens,
    outputTokens: response.usage.output_tokens,
  });

  const tu = response.content.find(
    (b): b is Extract<typeof b, { type: "tool_use" }> =>
      b.type === "tool_use" && b.name === extractModulesTool.name,
  );
  if (!tu) return null;

  const parsed = ExtractModulesToolOutputSchema.safeParse(tu.input);
  if (!parsed.success) {
    logger.warn("github.extract_modules.zod_failure", {
      issues: parsed.error.issues
        .slice(0, 3)
        .map((i) => `${i.path.join(".")}: ${i.message}`)
        .join("; "),
    });
    return null;
  }

  // Normalize module names: collapse whitespace, title-case-ish dedupe.
  const seen = new Set<string>();
  const modules: string[] = [];
  for (const m of parsed.data.modules) {
    const norm = m.replace(/\s+/g, " ").trim();
    if (!norm) continue;
    const key = norm.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    modules.push(norm);
  }

  return {
    modules,
    similarity_to_project: parsed.data.similarity_to_project,
    why_relevant: parsed.data.why_relevant.trim(),
  };
}
