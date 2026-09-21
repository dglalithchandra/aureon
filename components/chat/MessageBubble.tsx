"use client";
import { useEffect, useRef } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import Link from "next/link";
import { ArrowRight, Sparkles, User, Activity } from "lucide-react";
import { gsap } from "@/lib/gsap-init";
import { cn } from "@/lib/utils";

export type ChatMessage =
  | { kind: "user_input"; id: string; text: string }
  | { kind: "assistant_message"; id: string; markdown: string }
  | { kind: "pipeline_status"; id: string; label: string }
  | {
      kind: "output_ready";
      id: string;
      sessionId: string;
      confidence: number;
    };

interface MessageBubbleProps {
  message: ChatMessage;
}

export function MessageBubble({ message }: MessageBubbleProps): React.ReactElement {
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduce) return;
    gsap.from(el, {
      opacity: 0,
      y: 14,
      duration: 0.45,
      ease: "scopeai-out",
    });
  }, [message.id]);

  return (
    <div
      ref={ref}
      className={cn(
        "flex w-full",
        message.kind === "user_input" ? "justify-end" : "justify-start",
      )}
    >
      {message.kind === "user_input" && <UserBubble text={message.text} />}
      {message.kind === "assistant_message" && (
        <AssistantBubble markdown={message.markdown} />
      )}
      {message.kind === "pipeline_status" && (
        <PipelineStatusBubble label={message.label} />
      )}
      {message.kind === "output_ready" && (
        <OutputReadyBubble
          sessionId={message.sessionId}
          confidence={message.confidence}
        />
      )}
    </div>
  );
}

function UserBubble({ text }: { text: string }): React.ReactElement {
  return (
    <div className="flex max-w-[85%] items-start gap-3">
      <div className="rounded-2xl rounded-tr-sm bg-[var(--color-blueprint-accent)] px-4 py-3 text-sm leading-relaxed whitespace-pre-wrap text-[var(--color-blueprint-bg)]">
        {text}
      </div>
      <span
        aria-hidden
        className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[var(--color-blueprint-accent)]/20 text-[var(--color-blueprint-accent)]"
      >
        <User size={14} />
      </span>
    </div>
  );
}

function AssistantBubble({ markdown }: { markdown: string }): React.ReactElement {
  return (
    <div className="flex max-w-[85%] items-start gap-3">
      <span
        aria-hidden
        className="text-blueprint-accent border-blueprint-line/20 bg-blueprint-line/5 mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full border"
      >
        <Sparkles size={14} />
      </span>
      <div className="border-blueprint-line/20 text-blueprint-text rounded-2xl rounded-tl-sm border bg-white/[0.025] px-4 py-3 text-sm leading-relaxed backdrop-blur-md">
        <ReactMarkdown
          remarkPlugins={[remarkGfm]}
          allowedElements={[
            "p",
            "ul",
            "ol",
            "li",
            "strong",
            "em",
            "code",
            "pre",
            "h1",
            "h2",
            "h3",
            "h4",
            "a",
            "blockquote",
            "hr",
            "br",
          ]}
          components={{
            a: (props) => (
              <a
                {...props}
                target="_blank"
                rel="noopener noreferrer"
                className="text-[var(--color-blueprint-accent)] underline-offset-2 hover:underline"
              />
            ),
            code: (props) => (
              <code
                {...props}
                className="bg-blueprint-line/15 rounded px-1 py-0.5 font-mono text-[12.5px]"
              />
            ),
            pre: (props) => (
              <pre
                {...props}
                className="bg-blueprint-line/10 mt-2 overflow-x-auto rounded-md p-3 font-mono text-[12px]"
              />
            ),
          }}
        >
          {markdown}
        </ReactMarkdown>
      </div>
    </div>
  );
}

function PipelineStatusBubble({ label }: { label: string }): React.ReactElement {
  return (
    <div className="border-blueprint-line/15 text-blueprint-muted bg-blueprint-line/5 inline-flex items-center gap-2 rounded-full border px-3 py-1.5 font-mono text-[11px] tracking-wide">
      <span className="block h-1.5 w-1.5 animate-pulse rounded-full bg-[var(--color-blueprint-accent)]" />
      <Activity size={11} />
      {label}
    </div>
  );
}

function OutputReadyBubble({
  sessionId,
  confidence,
}: {
  sessionId: string;
  confidence: number;
}): React.ReactElement {
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduce) return;
    gsap.fromTo(
      el,
      { scale: 0.85, opacity: 0 },
      { scale: 1, opacity: 1, duration: 0.7, ease: "scopeai-bounce" },
    );
    // Continuous gentle glow pulse so the user definitely notices it.
    gsap.to(el, {
      boxShadow: "0 0 60px rgba(236,72,153,0.55)",
      duration: 1.6,
      repeat: -1,
      yoyo: true,
      ease: "sine.inOut",
    });
  }, []);

  return (
    <div
      ref={ref}
      className="flex max-w-md flex-col gap-3 rounded-2xl border-2 border-[var(--color-blueprint-accent)]/50 bg-[var(--color-blueprint-accent)]/15 p-5 backdrop-blur-md"
    >
      <p className="text-blueprint-muted font-mono text-[10px] tracking-[0.18em] uppercase">
        Ready · {confidence}% confidence
      </p>
      <p className="text-blueprint-text font-display text-xl font-bold">
        Your scope is ready.
      </p>
      <p className="text-blueprint-muted text-sm">Opening the two-stage view now…</p>
      <Link
        href={`/output/${sessionId}`}
        className="inline-flex items-center gap-2 self-start rounded-full border border-[var(--color-blueprint-accent)] px-4 py-2 text-sm font-medium text-[var(--color-blueprint-accent)] transition-colors hover:bg-[var(--color-blueprint-accent)]/15"
      >
        Open scope now
        <ArrowRight size={14} />
      </Link>
    </div>
  );
}
