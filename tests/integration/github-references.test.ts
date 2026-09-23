import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { generateEngineerView, generateClientView } from "@/lib/pipeline/finalize";
import { ClientViewSchema, EngineerViewSchema } from "@/lib/schemas/output";
import { GITHUB_REPO_URL_RE, GitHubMatchSchema } from "@/lib/schemas/github";
import { GitHubReferenceSchema } from "@/lib/schemas/output";
import { scoreModules } from "@/lib/scoring/modules";
import type { Session } from "@/lib/schemas/mcq";
import { startMockLlm, type MockLlm } from "../mocks/mock-llm";
import {
  makeEnrichment,
  makeEngineerView,
  makeExtraction,
  makeMatch,
  makeRound,
  makeSession,
} from "../fixtures/llm";

/** GOAL-02: references come from the round's matches. SEC-05: only real URLs. */

let mock: MockLlm;

beforeAll(async () => {
  mock = await startMockLlm();
  process.env.GEMINI_BASE_URL = mock.url;
});

afterAll(async () => {
  await mock.close();
});

beforeEach(() => {
  mock.reset();
});

const MATCHES = [
  makeMatch({ repo: "acme/one", similarity: 0.4 }),
  makeMatch({ repo: "acme/two", similarity: 0.95, why_relevant: "Closest match" }),
  makeMatch({ repo: "acme/three", similarity: 0.8 }),
  makeMatch({ repo: "acme/four", similarity: 0.7 }),
  makeMatch({ repo: "acme/five", similarity: 0.6 }),
  makeMatch({ repo: "acme/six", similarity: 0.5 }),
];

function sessionWith(matches = MATCHES): Session {
  const enrichment = makeEnrichment(matches);
  const extraction = scoreModules(makeExtraction({ domain: "SaaS" }), enrichment);
  return makeSession({
    status: "ready",
    pipeline_stage: null,
    rounds: [makeRound({ extraction, github_enrichment: enrichment })],
  });
}

describe("engineer.github_references are built from the matches (GOAL-02)", () => {
  it("keeps the 5 most similar matches and drops what the model invented", async () => {
    const view = await generateEngineerView(sessionWith());

    // The fixture's model output claims a repo that does not exist.
    expect(view.github_references.map((r) => r.repo)).not.toContain(
      "made-up/nonexistent-repo",
    );
    expect(view.github_references.map((r) => r.repo)).toEqual([
      "acme/two",
      "acme/three",
      "acme/four",
      "acme/five",
      "acme/six",
    ]);

    // Every reference is one of this round's matches.
    const known = new Set(MATCHES.map((m) => m.repo));
    for (const ref of view.github_references) {
      expect(known.has(ref.repo)).toBe(true);
      expect(ref.url).toMatch(GITHUB_REPO_URL_RE);
    }
    expect(view.github_references[0]!.why_relevant).toBe("Closest match");
    expect(EngineerViewSchema.safeParse(view).success).toBe(true);
  });

  it("is empty when the round found no matches", async () => {
    const view = await generateEngineerView(sessionWith([]));
    expect(view.github_references).toEqual([]);
  });

  it("falls back to a plain sentence when a match has no rationale", async () => {
    const view = await generateEngineerView(
      sessionWith([
        makeMatch({ repo: "acme/quiet", similarity: 0.42, why_relevant: "" }),
      ]),
    );
    expect(view.github_references[0]!.why_relevant).toBe(
      "Similar project (similarity 0.42)",
    );
  });
});

describe("module confidence reaches both views (blueprint step 07)", () => {
  it("fills the client cards and the engineer table from the scored round", async () => {
    const session = sessionWith();
    const [client, engineer] = await Promise.all([
      generateClientView(session),
      generateEngineerView(session),
    ]);

    const auth = client.modules.find((m) => m.name === "Auth")!;
    expect(auth.confidence).toBeGreaterThan(0);
    expect(auth.seen_in.map((r) => r.repo)).toContain("acme/one");
    expect(engineer.module_table[0]!.confidence).toBe(auth.confidence);
    expect(ClientViewSchema.safeParse(client).success).toBe(true);
  });

  it("leaves modules the round never scored at null", async () => {
    const session = makeSession({
      status: "ready",
      pipeline_stage: null,
      rounds: [makeRound()],
    });
    const client = await generateClientView(session);
    expect(client.modules[0]!.confidence).toBeNull();
    expect(client.modules[0]!.seen_in).toEqual([]);
  });
});

describe("only real GitHub URLs are stored (SEC-05)", () => {
  const reference = (url: string) => ({
    repo: "acme/one",
    url,
    why_relevant: "Similar project",
  });
  const engineerWith = (url: string) => ({
    ...makeEngineerView(),
    github_references: [reference(url)],
  });

  it.each([
    "javascript:alert(document.domain)",
    "data:text/html,<script>alert(1)</script>",
    "vbscript:msgbox(1)",
    "https://evil.com/acme/one",
    "https://github.com.evil.com/acme/one",
    "http://github.com/acme/one",
    "https://github.com/acme/one/issues/1",
    "https://github.com/acme",
  ])("refuses to store %j", (url) => {
    // The reference itself is invalid …
    expect(GitHubReferenceSchema.safeParse(reference(url)).success).toBe(false);
    // … so a document carrying it loads with no references at all.
    expect(EngineerViewSchema.parse(engineerWith(url)).github_references).toEqual([]);
    // And an enrichment match with that URL never gets stored either.
    expect(GitHubMatchSchema.safeParse({ ...makeMatch(), url }).success).toBe(false);
  });

  it.each(["https://github.com/acme/one", "https://github.com/acme/one/"])(
    "accepts %j",
    (url) => {
      expect(GitHubReferenceSchema.safeParse(reference(url)).success).toBe(true);
      expect(EngineerViewSchema.parse(engineerWith(url)).github_references).toHaveLength(
        1,
      );
    },
  );

  it("keeps the rest of an older document whose references are unusable", () => {
    const parsed = EngineerViewSchema.safeParse({
      ...makeEngineerView(),
      github_references: ["javascript:alert(1)"],
    });
    expect(parsed.success).toBe(true);
    expect(parsed.data?.github_references).toEqual([]);
    expect(parsed.data?.module_table.length).toBeGreaterThan(0);
  });
});
