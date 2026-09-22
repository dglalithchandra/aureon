import { describe, expect, it } from "vitest";
import { EXTRACTION_SYSTEM_PROMPT } from "@/lib/llm/prompts/extract";
import {
  CLIENT_VIEW_SYSTEM_PROMPT,
  ENGINEER_VIEW_SYSTEM_PROMPT,
} from "@/lib/llm/prompts/finalize";
import { MCQ_SYSTEM_PROMPT } from "@/lib/llm/prompts/mcq";

describe("product name in LLM prompts", () => {
  it.each([
    ["extraction", EXTRACTION_SYSTEM_PROMPT],
    ["client view", CLIENT_VIEW_SYSTEM_PROMPT],
    ["engineer view", ENGINEER_VIEW_SYSTEM_PROMPT],
    ["clarification", MCQ_SYSTEM_PROMPT],
  ])("the %s prompt says Aureon, not the old name", (_label, prompt) => {
    expect(prompt).toContain("Aureon");
    expect(prompt).not.toMatch(/ScopeAI|ScopeBuilder/);
  });
});
