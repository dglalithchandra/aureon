import { canonicalModuleKey } from "@/lib/scoring/module-name";
import type { ClientModule, FinalOutput } from "@/lib/schemas/output";
import type { ModuleSize } from "@/lib/schemas/extraction";
import type { MCQAnswer, MCQQuestion, SessionRound } from "@/lib/schemas/mcq";

/**
 * Scope diff (blueprint step 14): what changed between two versions, and
 * which clarification answer is likely to have caused it.
 *
 * Pure — no database, no model — so the same pair of documents always gives
 * the same answer and the tests can state it exactly.
 *
 * Green means added, amber changed, red removed; the renderer reads
 * `change` and picks the colour, so that mapping lives in one place.
 */

export type ChangeKind = "added" | "removed" | "renamed" | "resized" | "changed";

export interface ModuleChange {
  kind: ChangeKind;
  name: string;
  /** Set for a rename: what it used to be called. */
  previousName?: string;
  /** Set for a resize. */
  fromSize?: ModuleSize;
  toSize?: ModuleSize;
}

export interface TextChange {
  kind: "added" | "removed";
  text: string;
}

export interface ConfidenceChange {
  from: number;
  to: number;
  delta: number;
}

export interface ScopeDiff {
  modules: ModuleChange[];
  assumptions: TextChange[];
  openItems: TextChange[];
  confidence: ConfidenceChange;
  /** True when the plain-English summary was rewritten. */
  summaryChanged: boolean;
  /** Nothing at all changed between the two documents. */
  identical: boolean;
}

/* ──────────────────────────────────────────────────────────────
 *  Modules
 * ────────────────────────────────────────────────────────────── */

function words(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((word) => word.length > 2);
}

/** Jaccard overlap of two descriptions, 0-1. */
export function descriptionSimilarity(a: string, b: string): number {
  return overlap(a, b).ratio;
}

function overlap(a: string, b: string): { ratio: number; shared: number } {
  const left = new Set(words(a));
  const right = new Set(words(b));
  if (left.size === 0 || right.size === 0) return { ratio: 0, shared: 0 };
  let shared = 0;
  for (const word of left) if (right.has(word)) shared++;
  return { ratio: shared / (left.size + right.size - shared), shared };
}

/**
 * A module that left and a module that arrived are the same module renamed
 * when their descriptions still mostly agree. Below this they are treated as
 * one module removed and another added, which is the honest reading.
 *
 * The word count matters as well as the ratio: two three-word descriptions
 * can overlap almost entirely and still be about different things.
 */
const RENAME_SIMILARITY = 0.5;
const RENAME_MIN_SHARED_WORDS = 4;

function byKey(modules: ClientModule[]): Map<string, ClientModule> {
  const map = new Map<string, ClientModule>();
  for (const entry of modules) map.set(canonicalModuleKey(entry.name), entry);
  return map;
}

export function diffModules(
  before: ClientModule[],
  after: ClientModule[],
): ModuleChange[] {
  const left = byKey(before);
  const right = byKey(after);
  const changes: ModuleChange[] = [];

  const removed: ClientModule[] = [];
  for (const [key, entry] of left) {
    const match = right.get(key);
    if (!match) {
      removed.push(entry);
      continue;
    }
    if (match.size !== entry.size) {
      changes.push({
        kind: "resized",
        name: match.name,
        fromSize: entry.size,
        toSize: match.size,
      });
    }
  }

  const added: ClientModule[] = [];
  for (const [key, entry] of right) if (!left.has(key)) added.push(entry);

  // Pair what left with what arrived: the best description match above the
  // threshold is a rename, everything else is a plain add or remove.
  const takenAdds = new Set<ClientModule>();
  for (const gone of removed) {
    let best: { module: ClientModule; score: number } | null = null;
    for (const arrival of added) {
      if (takenAdds.has(arrival)) continue;
      const { ratio, shared } = overlap(gone.description, arrival.description);
      if (
        ratio >= RENAME_SIMILARITY &&
        shared >= RENAME_MIN_SHARED_WORDS &&
        (!best || ratio > best.score)
      ) {
        best = { module: arrival, score: ratio };
      }
    }
    if (best) {
      takenAdds.add(best.module);
      changes.push({
        kind: "renamed",
        name: best.module.name,
        previousName: gone.name,
        ...(best.module.size !== gone.size
          ? { fromSize: gone.size, toSize: best.module.size }
          : {}),
      });
    } else {
      changes.push({ kind: "removed", name: gone.name });
    }
  }
  for (const arrival of added) {
    if (!takenAdds.has(arrival)) changes.push({ kind: "added", name: arrival.name });
  }

  const order: Record<ChangeKind, number> = {
    added: 0,
    renamed: 1,
    resized: 2,
    changed: 3,
    removed: 4,
  };
  return changes.sort(
    (a, b) => order[a.kind] - order[b.kind] || a.name.localeCompare(b.name),
  );
}

/* ──────────────────────────────────────────────────────────────
 *  Lists and the whole document
 * ────────────────────────────────────────────────────────────── */

export function diffList(before: string[], after: string[]): TextChange[] {
  const left = new Set(before);
  const right = new Set(after);
  return [
    ...after
      .filter((text) => !left.has(text))
      .map((text) => ({ kind: "added" as const, text })),
    ...before
      .filter((text) => !right.has(text))
      .map((text) => ({ kind: "removed" as const, text })),
  ];
}

export function diffScopes(before: FinalOutput, after: FinalOutput): ScopeDiff {
  const modules = diffModules(before.client.modules, after.client.modules);
  const assumptions = diffList(before.client.assumptions, after.client.assumptions);
  const openItems = diffList(before.client.open_items, after.client.open_items);
  const from = before.client.confidence_badge.score;
  const to = after.client.confidence_badge.score;
  const summaryChanged = before.client.project_summary !== after.client.project_summary;

  return {
    modules,
    assumptions,
    openItems,
    confidence: { from, to, delta: to - from },
    summaryChanged,
    identical:
      modules.length === 0 &&
      assumptions.length === 0 &&
      openItems.length === 0 &&
      from === to &&
      !summaryChanged,
  };
}

/* ──────────────────────────────────────────────────────────────
 *  Why it changed
 * ────────────────────────────────────────────────────────────── */

export interface AnswerReference {
  roundNumber: number;
  question: string;
  answer: string;
}

export interface AttributedChange {
  change: ModuleChange | TextChange;
  /** The clarification answers that mention what changed. */
  answers: AnswerReference[];
}

/** Every answer a session holds, flattened with its question. */
export function answersOf(rounds: SessionRound[]): AnswerReference[] {
  const list: AnswerReference[] = [];
  for (const round of rounds) {
    for (const answer of round.answers) {
      const question = round.questions.find(
        (q: MCQQuestion) => q.id === (answer as MCQAnswer).question_id,
      );
      const text = [answer.selected_options.join(", "), answer.custom_text ?? ""]
        .filter(Boolean)
        .join(" — ");
      if (!text) continue;
      list.push({
        roundNumber: round.round_number,
        question: question?.question ?? "(question not stored)",
        answer: text,
      });
    }
  }
  if (rounds.some((round) => round.added_description)) {
    for (const round of rounds) {
      if (!round.added_description) continue;
      list.push({
        roundNumber: round.round_number,
        question: "Added description",
        answer: round.added_description,
      });
    }
  }
  return list;
}

/** The subject of a change, as words to look for in an answer. */
function subjectOf(change: ModuleChange | TextChange): string {
  return "text" in change ? change.text : `${change.name} ${change.previousName ?? ""}`;
}

/**
 * Which answers plausibly caused a change: those that mention it.
 *
 * A heuristic, and labelled as one in the UI — the pipeline does not record
 * a causal link between an answer and a module, so the honest thing is to
 * show the answers that talk about the same thing and let the reader judge.
 */
export function attributeChange(
  change: ModuleChange | TextChange,
  answers: AnswerReference[],
  limit = 3,
): AnswerReference[] {
  const subject = new Set(words(subjectOf(change)));
  if (subject.size === 0) return [];

  const scored = answers
    .map((answer) => {
      const haystack = new Set(words(`${answer.question} ${answer.answer}`));
      let shared = 0;
      for (const word of subject) if (haystack.has(word)) shared++;
      return { answer, score: shared / subject.size };
    })
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score);

  return scored.slice(0, limit).map((entry) => entry.answer);
}

/** Every change in a diff, each with the answers that mention it. */
export function attributeDiff(
  diff: ScopeDiff,
  rounds: SessionRound[],
): AttributedChange[] {
  const answers = answersOf(rounds);
  const changes: Array<ModuleChange | TextChange> = [
    ...diff.modules,
    ...diff.assumptions,
    ...diff.openItems,
  ];
  return changes.map((change) => ({
    change,
    answers: attributeChange(change, answers),
  }));
}
