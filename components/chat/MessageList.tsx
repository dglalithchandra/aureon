"use client";
import { useEffect, useRef } from "react";
import { AnimatePresence } from "framer-motion";
import { MessageBubble, type ChatMessage } from "@/components/chat/MessageBubble";
import { MCQCard } from "@/components/chat/MCQCard";
import type { MCQAnswer, MCQQuestion } from "@/lib/schemas/mcq";

interface MessageListProps {
  messages: ChatMessage[];
  pendingQuestions: MCQQuestion[];
  pendingAnswerSubmission: boolean;
  onSubmitAnswers(answers: MCQAnswer[]): void;
}

/**
 * Renders the chat thread + the pending MCQ block (if any). Auto-scrolls to
 * the bottom when new content arrives, but only when the user is already
 * near the bottom — preserves the user's scroll position when they're
 * inspecting earlier rounds.
 */
export function MessageList({
  messages,
  pendingQuestions,
  pendingAnswerSubmission,
  onSubmitAnswers,
}: MessageListProps): React.ReactElement {
  const containerRef = useRef<HTMLDivElement>(null);
  const stickToBottom = useRef(true);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const onScroll = (): void => {
      const fromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
      stickToBottom.current = fromBottom < 80;
    };
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => el.removeEventListener("scroll", onScroll);
  }, []);

  useEffect(() => {
    if (!stickToBottom.current) return;
    const el = containerRef.current;
    if (!el) return;
    // Defer to next frame so freshly-mounted elements are measured.
    requestAnimationFrame(() => {
      el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
    });
  }, [messages.length, pendingQuestions.length]);

  return (
    <div
      ref={containerRef}
      className="relative flex-1 overflow-y-auto px-4 py-6 sm:px-6"
    >
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-4">
        <AnimatePresence initial={false}>
          {messages.map((m) => (
            <MessageBubble key={m.id} message={m} />
          ))}
        </AnimatePresence>
        {pendingQuestions.length > 0 && (
          <MCQCard
            key={pendingQuestions.map((q) => q.id).join(":")}
            questions={pendingQuestions}
            pending={pendingAnswerSubmission}
            onSubmit={onSubmitAnswers}
          />
        )}
        <div className="h-4" />
      </div>
    </div>
  );
}
