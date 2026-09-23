import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  clearDraft,
  draftKey,
  readDraft,
  sameOutput,
  writeDraft,
} from "@/lib/output/draft-store";
import { moduleId, newModuleId, type FinalOutput } from "@/lib/schemas/output";
import { makeClientView, makeEngineerView } from "../fixtures/llm";

/** UX-02: the 10-second autosave, and BUG-09's stable module ids. */

class MemoryStorage {
  private map = new Map<string, string>();
  getItem(key: string): string | null {
    return this.map.get(key) ?? null;
  }
  setItem(key: string, value: string): void {
    this.map.set(key, value);
  }
  removeItem(key: string): void {
    this.map.delete(key);
  }
}

const SESSION = "12345678-1234-4abc-8def-1234567890ab";

function output(): FinalOutput {
  return { client: makeClientView(), engineer: makeEngineerView() };
}

beforeEach(() => {
  vi.stubGlobal("window", { localStorage: new MemoryStorage() });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("the local draft", () => {
  it("comes back the way it went in", () => {
    const doc = output();
    writeDraft(SESSION, doc);
    const stored = readDraft(SESSION);

    expect(stored?.output).toEqual(doc);
    expect(stored?.savedAt).toBeGreaterThan(0);
  });

  it("is scoped to one project", () => {
    writeDraft(SESSION, output());
    expect(readDraft("other-project")).toBeNull();
    expect(draftKey(SESSION)).toContain(SESSION);
  });

  it("is nothing before anything is written", () => {
    expect(readDraft(SESSION)).toBeNull();
  });

  it("is dropped when it no longer fits the schema", () => {
    window.localStorage.setItem(
      draftKey(SESSION),
      JSON.stringify({ savedAt: Date.now(), output: { client: { name: "nope" } } }),
    );
    expect(readDraft(SESSION)).toBeNull();
  });

  it("is dropped when it is not even JSON", () => {
    window.localStorage.setItem(draftKey(SESSION), "{{{");
    expect(readDraft(SESSION)).toBeNull();
  });

  it("goes away when asked", () => {
    writeDraft(SESSION, output());
    clearDraft(SESSION);
    expect(readDraft(SESSION)).toBeNull();
  });

  it("survives storage being unavailable", () => {
    vi.stubGlobal("window", {
      localStorage: {
        getItem() {
          throw new Error("denied");
        },
        setItem() {
          throw new Error("denied");
        },
        removeItem() {
          throw new Error("denied");
        },
      },
    });
    expect(() => writeDraft(SESSION, output())).not.toThrow();
    expect(readDraft(SESSION)).toBeNull();
    expect(() => clearDraft(SESSION)).not.toThrow();
  });

  it("tells two documents apart so an unchanged draft is not offered", () => {
    const doc = output();
    expect(sameOutput(doc, structuredClone(doc))).toBe(true);
    expect(
      sameOutput(doc, { ...doc, client: { ...doc.client, project_summary: "Other." } }),
    ).toBe(false);
  });
});

describe("module ids", () => {
  it("uses the stored id when there is one", () => {
    expect(moduleId({ id: "mod-7", name: "Auth" })).toBe("mod-7");
  });

  it("derives the same id every time for a document without one", () => {
    expect(moduleId({ name: "Payment Processing" })).toBe(
      moduleId({ name: "payment processing" }),
    );
  });

  it("gives two modules with different names different ids", () => {
    expect(moduleId({ name: "Auth" })).not.toBe(moduleId({ name: "Billing" }));
  });

  it("never returns an empty key", () => {
    expect(moduleId({ name: "…" })).not.toBe("");
    expect(moduleId({ id: "   ", name: "Auth" })).toBe(moduleId({ name: "Auth" }));
  });

  it("hands out a fresh id for a module added by hand", () => {
    const ids = new Set(Array.from({ length: 50 }, () => newModuleId()));
    expect(ids.size).toBe(50);
    for (const id of ids) expect(id.length).toBeLessThanOrEqual(64);
  });
});
