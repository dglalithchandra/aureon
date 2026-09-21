import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { ExtractionResultStrictSchema } from "@/lib/schemas/extraction";
import { ExtractModulesToolOutputSchema } from "@/lib/schemas/github";
import { QuestionGenToolOutputSchema } from "@/lib/schemas/mcq";
import { ClientViewSchema, EngineerViewSchema } from "@/lib/schemas/output";
import { startMockAnthropic, type MockAnthropic } from "../mocks/mock-anthropic";
import { defaultToolPayload, MOCK_TOOL_NAMES, type MockToolName } from "../fixtures/llm";

/** Checks the test infrastructure itself: fixtures, mock controls, network guard. */

let mock: MockAnthropic;

beforeAll(async () => {
  mock = await startMockAnthropic();
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
    content?: Array<{ type: string; name: string; input: unknown }>;
    error?: { type: string };
  };
}

async function post(tool: string | null, path = "/v1/messages"): Promise<MockResponse> {
  const res = await fetch(`${mock.url}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      model: "claude-test",
      max_tokens: 10,
      tool_choice: tool ? { type: "tool", name: tool } : undefined,
      messages: [{ role: "user", content: "hi" }],
    }),
  });
  return { status: res.status, body: (await res.json()) as MockResponse["body"] };
}

function inputOf(res: MockResponse): unknown {
  return res.body.content?.[0]?.input;
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

describe("mock Anthropic server", () => {
  it("answers with a tool_use block for the tool in tool_choice", async () => {
    const res = await post("extract_modules");

    expect(res.status).toBe(200);
    expect(res.body.content?.[0]).toMatchObject({
      type: "tool_use",
      name: "extract_modules",
    });
    expect(inputOf(res)).toEqual(defaultToolPayload("extract_modules"));
    expect(mock.calls).toEqual([
      { tool: "extract_modules", model: "claude-test", userText: "hi" },
    ]);
  });

  it("rejects unknown tools and unknown routes", async () => {
    expect((await post("no_such_tool")).status).toBe(400);
    expect((await post(null)).status).toBe(400);
    expect((await post("extract_modules", "/v1/complete")).status).toBe(404);
  });

  it("fails exactly the next N requests with 529", async () => {
    mock.failNext(2);
    const statuses = [
      (await post("extract_modules")).status,
      (await post("extract_modules")).status,
      (await post("extract_modules")).status,
    ];
    expect(statuses).toEqual([529, 529, 200]);
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
    await expect(fetch("https://api.anthropic.com/v1/messages")).rejects.toThrow(
      /Network access is blocked/,
    );
    await expect(
      fetch(new URL("https://api.github.com/search/repositories")),
    ).rejects.toThrow(/Network access is blocked/);
  });
});
