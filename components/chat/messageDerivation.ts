import type { Session } from "@/lib/schemas/mcq";
import type { ChatMessage } from "@/components/chat/MessageBubble";
import { SCOPING } from "@/lib/config/scoping";

/** Shown while the session waits for a fuller description (BUG-05). */
export const NEEDS_INPUT_PROMPT =
  "Please describe the goal and main features in a few sentences";

/** Shown instead once the session has used every round it is allowed.  */
export const ROUNDS_EXHAUSTED_PROMPT = `This session has used all ${SCOPING.maxTotalRounds} rounds without a clear goal. Start a new scope with a fuller description.`;

/**
 * True when the chat asked for a fuller description and the session still
 * has a round left to spend on it (BUG-05). The input box unlocks only then.
 */
export function isAwaitingDescription(session: Session | null): boolean {
  return (
    session?.status === "needs_input" && session.rounds.length < SCOPING.maxTotalRounds
  );
}

/**
 * Derive the chat thread from a Session. The session is the single source of
 * truth — every reload reproduces the same messages.
 *
 * Layout per round:
 *   round 0:
 *     - user_input: the raw input
 *     - pipeline_status: "Domain X · confidence Y"
 *     - assistant_message: a one-sentence summary the LLM produced (gap or reasoning)
 *     - any answers from this round become user_input messages on subsequent rounds
 *   round N>=1:
 *     - user_input: structured rendering of the answers submitted to round N-1
 *     - pipeline_status + assistant_message
 *
 * Pending MCQ questions are NOT in the messages array — they are returned
 * separately so the MessageList can render the interactive MCQCard directly.
 */
export function deriveMessages(session: Session): ChatMessage[] {
  const out: ChatMessage[] = [];

  // First message — the original raw input.
  out.push({
    kind: "user_input",
    id: "raw-input",
    text: session.raw_input,
  });

  for (let i = 0; i < session.rounds.length; i++) {
    const round = session.rounds[i];
    if (!round) continue;

    // Render what the user sent after the previous round — MCQ answers, or
    // the description they typed when asked to rewrite.
    if (i > 0) {
      const prev = session.rounds[i - 1];
      const text = prev ? formatAnswersAsUserMessage(prev) : null;
      if (prev && text) {
        out.push({
          kind: "user_input",
          id: `answers-${i - 1}`,
          text,
        });
      }
      if (prev?.added_description) {
        out.push({
          kind: "user_input",
          id: `description-${i - 1}`,
          text: prev.added_description,
        });
      }
    }

    out.push({
      kind: "pipeline_status",
      id: `status-${i}`,
      label: `Round ${round.round_number} · ${round.extraction.domain} · ${round.extraction.confidence}%`,
    });

    out.push({
      kind: "assistant_message",
      id: `assist-${i}`,
      markdown: assistantMarkdownForRound(session, round.round_number),
    });
  }

  // If the last round committed answers but no new round arrived yet,
  // surface them so the user sees what they submitted.
  const lastRound = session.rounds[session.rounds.length - 1];
  // Also after a failed round ("error"): the answers are saved for the retry.
  if (
    lastRound &&
    lastRound.answers.length > 0 &&
    (session.status === "analyzing" || session.status === "error")
  ) {
    const text = formatAnswersAsUserMessage(lastRound);
    if (text) {
      out.push({
        kind: "user_input",
        id: `answers-pending-${lastRound.round_number}`,
        text,
      });
    }
  }

  if (
    lastRound?.added_description &&
    (session.status === "analyzing" || session.status === "error")
  ) {
    out.push({
      kind: "user_input",
      id: `description-pending-${lastRound.round_number}`,
      text: lastRound.added_description,
    });
  }

  if (session.status === "needs_input") {
    out.push({
      kind: "assistant_message",
      id: "needs-input",
      markdown:
        session.rounds.length >= SCOPING.maxTotalRounds
          ? ROUNDS_EXHAUSTED_PROMPT
          : NEEDS_INPUT_PROMPT,
    });
  }

  if (session.status === "ready") {
    out.push({
      kind: "output_ready",
      id: "ready",
      sessionId: session.id,
      confidence: session.current_confidence,
    });
  } else if (session.status === "finalized") {
    out.push({
      kind: "output_ready",
      id: "finalized",
      sessionId: session.id,
      confidence: session.current_confidence,
    });
  }

  return out;
}

function formatAnswersAsUserMessage(round: Session["rounds"][number]): string | null {
  const lines: string[] = [];
  for (const a of round.answers) {
    const q = round.questions.find((x) => x.id === a.question_id);
    if (!q) continue;
    const parts: string[] = [];
    if (a.selected_options.length > 0) parts.push(a.selected_options.join(" · "));
    if (a.custom_text) parts.push(a.custom_text);
    lines.push(`${q.parameter_id} → ${parts.join(" / ")}`);
  }
  return lines.length === 0 ? null : lines.join("\n");
}

function assistantMarkdownForRound(session: Session, roundIdx: number): string {
  const round = session.rounds[roundIdx];
  if (!round) return "";
  const e = round.extraction;
  const lines: string[] = [];

  if (round.round_number === 0) {
    lines.push(
      `Got it. I read the input as a **${e.domain}** project (confidence ${e.confidence}/100).`,
    );
  } else {
    lines.push(`Updated: confidence is now **${e.confidence}/100**.`);
  }

  if (e.modules.length > 0) {
    const validated = e.modules.filter((m) => m.github_validated).length;
    lines.push(
      `I see **${e.modules.length} modules** so far` +
        (validated > 0 ? ` (${validated} validated against real-world repos).` : "."),
    );
  }

  if (round.questions.length > 0) {
    if (e.blocker) {
      lines.push(
        "**Before I can build a useful scope**, I need to know one thing — see the question below.",
      );
    } else {
      lines.push(
        `I have **${round.questions.length} clarification question${round.questions.length === 1 ? "" : "s"}** below. Each one lifts the score noticeably if answered.`,
      );
    }
  } else if (e.blocker) {
    lines.push(
      "I still can't tell **what the project is for** or **what it must do** from the text so far.",
    );
  } else if (session.status === "ready") {
    lines.push("Confidence is high enough — your scope is ready to open.");
  }

  return lines.join("\n\n");
}
