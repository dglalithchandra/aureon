import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { ExtractionResultStrictSchema } from "@/lib/schemas/extraction";
import { ExtractModulesToolOutputSchema } from "@/lib/schemas/github";
import { QuestionGenToolOutputSchema } from "@/lib/schemas/mcq";
import { ClientViewSchema, EngineerViewSchema } from "@/lib/schemas/output";
import { startMockLlm, type MockLlm } from "../mocks/mock-llm";
import { defaultToolPayload, MOCK_TOOL_NAMES, type MockToolName } from "../fixtures/llm";

/** Checks the test infrastructure itself: fixtures, mock controls, network guard. */

let mock: MockLlm;

beforeAll(async () => {
  mock = await startMockLlm();
});

afterAll(async () => {
  await mock.close();
});

beforeEach(() => {
  mock.reset();
});

interface MockResponse {
  status: number;
  body: {
    status?: string;
    steps?: Array<{ type: string; name: string; arguments: unknown }>;
    error?: { type: string };
  };
}

/** One Interactions request, shaped the way lib/llm/gemini.ts sends them. */
async function post(
  tool: string | null,
  path = "/v1beta/interactions",
): Promise<MockResponse> {
  const res = await fetch(`${mock.url}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      model: "gemini-test-main",
      input: [{ type: "user_input", content: [{ type: "text", text: "hi" }] }],
      generation_config: {
        max_output_tokens: 10,
        tool_choice: tool ? { allowed_tools: { mode: "any", tools: [tool] } } : undefined,
      },
      store: false,
    }),
  });
  return { status: res.status, body: (await res.json()) as MockResponse["body"] };
}

function inputOf(res: MockResponse): unknown {
  return res.body.steps?.[0]?.arguments;
}

describe("default fixtures", () => {
  const schemas: Record<
    MockToolName,
    { safeParse: (v: unknown) => { success: boolean } }
  > = {
    submit_extraction: ExtractionResultStrictSchema,
    generate_clarification_questions: QuestionGenToolOutputSchema,
    submit_client_view: ClientViewSchema,
    submit_engineer_view: EngineerViewSchema,
    extract_modules: ExtractModulesToolOutputSchema,
  };

  it.each(MOCK_TOOL_NAMES.map((t) => [t]))("%s passes its Zod schema", (tool) => {
    expect(schemas[tool].safeParse(defaultToolPayload(tool)).success).toBe(true);
  });
});

describe("mock LLM server", () => {
  it("answers with a function_call step for the forced tool", async () => {
    const res = await post("extract_modules");

    expect(res.status).toBe(200);
    expect(res.body.status).toBe("completed");
    expect(res.body.steps?.[0]).toMatchObject({
      type: "function_call",
      name: "extract_modules",
    });
    expect(inputOf(res)).toEqual(defaultToolPayload("extract_modules"));
    expect(mock.calls).toEqual([
      {
        tool: "extract_modules",
        model: "gemini-test-main",
        maxTokens: 10,
        userText: "hi",
      },
    ]);
  });

  it("rejects unknown tools and unknown routes", async () => {
    expect((await post("no_such_tool")).status).toBe(400);
    expect((await post(null)).status).toBe(400);
    expect((await post("extract_modules", "/v1beta/models")).status).toBe(404);
  });

  it("fails exactly the next N requests with 429", async () => {
    mock.failNext(2);
    const statuses = [
      (await post("extract_modules")).status,
      (await post("extract_modules")).status,
      (await post("extract_modules")).status,
    ];
    expect(statuses).toEqual([429, 429, 200]);
  });

  it("reports truncated output as status incomplete with no call", async () => {
    mock.truncateNext(1);
    const res = await post("extract_modules");
    expect(res.body.status).toBe("incomplete");
    expect(res.body.steps).toEqual([]);
  });

  it("serves queued payloads first, then the override, then the default", async () => {
    mock.override("extract_modules", { modules: ["Override"] });
    mock.enqueue("extract_modules", { modules: ["Queued"] });

    expect(inputOf(await post("extract_modules"))).toEqual({ modules: ["Queued"] });
    expect(inputOf(await post("extract_modules"))).toEqual({ modules: ["Override"] });

    mock.reset();
    expect(inputOf(await post("extract_modules"))).toEqual(
      defaultToolPayload("extract_modules"),
    );
  });

  it("delays responses when asked", async () => {
    mock.setDelay(80);
    const t0 = performance.now();
    await post("extract_modules");
    expect(performance.now() - t0).toBeGreaterThanOrEqual(75);
  });
});

describe("network guard (tests/setup.ts)", () => {
  it("blocks requests to non-loopback hosts", async () => {
    await expect(
      fetch("https://generativelanguage.googleapis.com/v1beta/interactions"),
    ).rejects.toThrow(/Network access is blocked/);
    await expect(
      fetch(new URL("https://api.github.com/search/repositories")),
    ).rejects.toThrow(/Network access is blocked/);
  });
});
