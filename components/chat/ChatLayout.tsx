"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { gsap, useGSAP } from "@/lib/gsap-init";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ApiError,
  createSession,
  fetchSession,
  isUuid,
  runSession,
  submitAnswers,
} from "@/lib/api/client";
import type { MCQAnswer, Session } from "@/lib/schemas/mcq";
import { PipelinePanel } from "@/components/chat/PipelinePanel";
import { PipelineRoadmap } from "@/components/chat/PipelineRoadmap";
import { MessageList } from "@/components/chat/MessageList";
import { InputBar, type InputBarHandle } from "@/components/chat/InputBar";
import { deriveMessages } from "@/components/chat/messageDerivation";
import { logger } from "@/lib/logger";

const SESSION_QUERY_KEY = (id: string): readonly unknown[] => ["session", id] as const;

const SAMPLE_PROMPTS: ReadonlyArray<{ label: string; text: string }> = [
  {
    label: "SaaS analytics",
    text: "We need a SaaS analytics platform for ecommerce store owners. Users connect their Shopify or WooCommerce store via OAuth, see dashboards with revenue, top products, and conversion funnels. Stripe billing with Starter and Pro tiers, team invitations, CSV export. 8 weeks, $40k budget, target 50 paying customers in 3 months.",
  },
  {
    label: "FinTech invoicing",
    text: "Freelancers need to invoice clients in different countries and get paid quickly. Generate PDF invoices with tax (GST/VAT), send via email, accept payment via Stripe or Razorpay, see unpaid and overdue invoices. KYC for payouts above $10k. Mobile-first.",
  },
  {
    label: "E-commerce marketplace",
    text: "A marketplace for handmade crafts. Sellers list items with photos and pricing, buyers browse and check out via Stripe, platform takes 8% commission, weekly payouts to sellers. Reviews, search by category, basic admin dashboard. Launch in 12 weeks.",
  },
];

interface ChatLayoutProps {
  /** Session id read from the ?s= query param if present. */
  initialSessionId: string | null;
}

export function ChatLayout({ initialSessionId }: ChatLayoutProps): React.ReactElement {
  const router = useRouter();
  const params = useSearchParams();
  const inputRef = useRef<InputBarHandle>(null);
  const qc = useQueryClient();

  const sessionId = isUuid(initialSessionId) ? initialSessionId : null;
  const querySessionId = params.get("s");
  const effectiveId = isUuid(querySessionId) ? querySessionId : sessionId;

  const sessionQuery = useQuery<Session, ApiError>({
    queryKey: effectiveId ? SESSION_QUERY_KEY(effectiveId) : ["session", "none"],
    queryFn: () => {
      if (!effectiveId) throw new Error("no session id");
      return fetchSession(effectiveId);
    },
    enabled: Boolean(effectiveId),
    refetchInterval: (q) => {
      const data = q.state.data as Session | undefined;
      if (!data) return false;
      return data.status === "analyzing" ? 1500 : false;
    },
    refetchIntervalInBackground: false,
    staleTime: 0,
    retry: (failureCount, err) => {
      if (err instanceof ApiError && (err.status === 401 || err.status === 404)) {
        return false;
      }
      return failureCount < 2;
    },
  });

  const session = sessionQuery.data ?? null;

  // When the session enters "analyzing" status (e.g. right after we submit
  // answers), bump the cache so the polling loop picks it up.
  // Nothing to do here besides keep the query enabled.

  const createMutation = useMutation<Session, ApiError, string>({
    mutationFn: async (rawText: string) => {
      // Create the owned session first so the polling query can show the
      // actual server-side pipeline stage while this request is still running.
      const created = await createSession(rawText);
      qc.setQueryData(SESSION_QUERY_KEY(created.id), created);
      router.replace(`/chat?s=${created.id}`, { scroll: false });
      return runSession(created.id);
    },
    onSuccess: (s) => {
      qc.setQueryData(SESSION_QUERY_KEY(s.id), s);
    },
    onError: (err) => {
      logger.error("chat.create_failed", { code: err.code, status: err.status });
    },
  });

  const answerMutation = useMutation<
    Session,
    ApiError,
    { sessionId: string; answers: MCQAnswer[] }
  >({
    mutationFn: ({ sessionId: id, answers }) => submitAnswers(id, answers),
    onMutate: ({ sessionId: id }) => {
      // Optimistically flip the cached session into "analyzing" so the
      // pipeline panel and input bar lock instantly. The poll will catch up.
      const prev = qc.getQueryData<Session>(SESSION_QUERY_KEY(id));
      if (prev) {
        qc.setQueryData<Session>(SESSION_QUERY_KEY(id), {
          ...prev,
          status: "analyzing",
          pipeline_stage: "extracting",
        });
      }
      return { prev };
    },
    onSuccess: (s) => {
      qc.setQueryData(SESSION_QUERY_KEY(s.id), s);
    },
    onError: (err, vars, ctx) => {
      // Roll back if we have prior state.
      const prev = (ctx as { prev?: Session } | undefined)?.prev;
      if (prev) qc.setQueryData(SESSION_QUERY_KEY(vars.sessionId), prev);
      logger.error("chat.submit_failed", {
        code: err.code,
        status: err.status,
      });
    },
  });

  const messages = useMemo(() => (session ? deriveMessages(session) : []), [session]);

  const pendingQuestions = useMemo(() => {
    if (!session) return [];
    if (session.status !== "awaiting_answers" && session.status !== "blocker") {
      return [];
    }
    const last = session.rounds[session.rounds.length - 1];
    if (!last) return [];
    return last.questions.filter(
      (q) => !last.answers.some((a) => a.question_id === q.id),
    );
  }, [session]);

  const isAnalyzing =
    createMutation.isPending || sessionQuery.isLoading || session?.status === "analyzing";

  const inputLocked =
    Boolean(session) || // After first session exists, input is locked (use MCQs).
    createMutation.isPending ||
    isAnalyzing;

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // Surface 401/404 cleanly: drop the bad ?s=, surface a one-off banner,
  // and reset query state so we don't keep retrying.
  // Notice text is *derived* from the current query error so we don't have
  // to setState inside an effect — react-hooks/set-state-in-effect-safe.
  const [noticeDismissed, setNoticeDismissed] = useState(false);
  const handledStaleRef = useRef<string | null>(null);
  useEffect(() => {
    if (
      sessionQuery.isError &&
      sessionQuery.error instanceof ApiError &&
      (sessionQuery.error.status === 401 || sessionQuery.error.status === 404)
    ) {
      const key = `${effectiveId ?? ""}-${sessionQuery.error.status}`;
      if (handledStaleRef.current === key) return;
      handledStaleRef.current = key;
      router.replace("/chat", { scroll: false });
      qc.cancelQueries({ queryKey: ["session"] });
      if (effectiveId) {
        qc.removeQueries({ queryKey: SESSION_QUERY_KEY(effectiveId) });
      }
    }
  }, [sessionQuery.isError, sessionQuery.error, router, qc, effectiveId]);

  const staleNotice = useMemo(() => {
    if (noticeDismissed) return null;
    if (!(sessionQuery.error instanceof ApiError)) return null;
    if (sessionQuery.error.status === 404) {
      return "That session expired or was wiped on a server restart. Start a fresh one below.";
    }
    if (sessionQuery.error.status === 401) {
      return "You do not own that session — start a fresh one below.";
    }
    return null;
  }, [sessionQuery.error, noticeDismissed]);

  // CRITICAL UX FIX: when the session lands in `ready` or `finalized`,
  // auto-route to the output page after a brief celebration so the user
  // never misses it. Without this, users were stranded on the chat tab
  // even though their scope was already prepared.
  const redirectedRef = useRef(false);
  useEffect(() => {
    if (!session) return;
    if (session.status !== "ready" && session.status !== "finalized") return;
    if (redirectedRef.current) return;
    redirectedRef.current = true;
    // Finalized sessions skip the celebration — we already saw it once.
    const delay = session.status === "finalized" ? 200 : 2400;
    const t = setTimeout(() => {
      router.push(`/output/${session.id}`);
    }, delay);
    return () => clearTimeout(t);
  }, [session, router]);

  // Page-level entrance: header drops in, panel slides from left, main pane
  // slides from right. Only fires on first mount.
  const root = useRef<HTMLDivElement | null>(null);
  useGSAP(
    () => {
      const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      if (reduce) return;
      const tl = gsap.timeline({ defaults: { ease: "scopeai-out" } });
      tl.from("[data-chat-header]", { opacity: 0, y: -10, duration: 0.4 })
        .from("[data-chat-pipeline]", { opacity: 0, x: -16, duration: 0.55 }, "<0.05")
        .from("[data-chat-main]", { opacity: 0, x: 16, duration: 0.55 }, "<");
    },
    { scope: root, dependencies: [] },
  );

  const showSamples = !session && !createMutation.isPending;

  return (
    <div
      ref={root}
      className="bg-blueprint-bg flex min-h-[100dvh] flex-col md:grid md:grid-cols-[minmax(280px,30%)_1fr]"
    >
      {/* Pipeline column — sticky on desktop, accordion on mobile. */}
      <div
        data-chat-pipeline
        className="md:border-blueprint-line/15 md:bg-blueprint-bg/60 md:sticky md:top-0 md:h-[100dvh] md:overflow-y-auto md:border-r md:p-5"
      >
        <header data-chat-header className="mb-5 hidden md:block">
          <Link
            href="/"
            className="text-blueprint-muted hover:text-blueprint-text font-mono text-[11px] tracking-[0.3em] uppercase"
          >
            ← Aureon
          </Link>
          <h1 className="text-blueprint-text font-display mt-2 text-xl font-bold">
            Build your scope
          </h1>
        </header>
        <div className="md:hidden">
          <div className="border-blueprint-line/15 border-b p-3">
            <PipelinePanel session={session} isAnalyzing={isAnalyzing} />
          </div>
        </div>
        <div className="hidden md:block">
          <div className="border-blueprint-line/15 bg-blueprint-bg/60 relative overflow-hidden rounded-2xl border p-5 backdrop-blur-md">
            <div
              className="plasma-glow pointer-events-none absolute -inset-12 opacity-30"
              aria-hidden
            />
            <div
              className="plasma-dust pointer-events-none absolute inset-0 opacity-50"
              aria-hidden
            />
            <div className="relative">
              <PipelineRoadmap session={session} isAnalyzing={isAnalyzing} />
            </div>
          </div>
        </div>
      </div>

      {/* Chat column */}
      <main data-chat-main className="flex min-h-0 flex-1 flex-col">
        {staleNotice && (
          <StaleNotice message={staleNotice} onDismiss={() => setNoticeDismissed(true)} />
        )}

        {sessionQuery.isError &&
          sessionQuery.error instanceof ApiError &&
          sessionQuery.error.status !== 401 &&
          sessionQuery.error.status !== 404 && (
            <ErrorBanner
              message={sessionQuery.error.message}
              onRetry={() => sessionQuery.refetch()}
            />
          )}

        {createMutation.isError && createMutation.error && (
          <ErrorBanner
            message={createMutation.error.message}
            onRetry={() => createMutation.reset()}
          />
        )}

        {answerMutation.isError && answerMutation.error && (
          <ErrorBanner
            message={answerMutation.error.message}
            onRetry={() => answerMutation.reset()}
          />
        )}

        {!session && !createMutation.isPending && !sessionQuery.isLoading && (
          <EmptyState />
        )}

        {(session || createMutation.isPending) && (
          <MessageList
            messages={
              createMutation.isPending && !session
                ? [
                    {
                      kind: "user_input",
                      id: "optimistic",
                      text: createMutation.variables ?? "",
                    },
                    {
                      kind: "pipeline_status",
                      id: "status-init",
                      label: "Analyzing your input…",
                    },
                  ]
                : messages
            }
            pendingQuestions={pendingQuestions}
            pendingAnswerSubmission={answerMutation.isPending}
            onSubmitAnswers={(answers) => {
              if (!session) return;
              answerMutation.mutate({ sessionId: session.id, answers });
            }}
          />
        )}

        <InputBar
          ref={inputRef}
          locked={inputLocked}
          pending={createMutation.isPending}
          samples={showSamples ? SAMPLE_PROMPTS : undefined}
          onSubmit={(text) => createMutation.mutate(text)}
        />
      </main>
    </div>
  );
}

function EmptyState(): React.ReactElement {
  const ref = useRef<HTMLDivElement | null>(null);
  useGSAP(
    () => {
      const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      if (reduce) return;
      gsap.from("[data-empty-eyebrow]", {
        opacity: 0,
        y: 8,
        duration: 0.6,
        ease: "scopeai-out",
      });
      gsap.from("[data-empty-h]", {
        opacity: 0,
        y: 18,
        duration: 0.7,
        delay: 0.12,
        ease: "scopeai-out",
      });
      gsap.from("[data-empty-p]", {
        opacity: 0,
        y: 12,
        duration: 0.6,
        delay: 0.28,
        ease: "scopeai-out",
      });
      gsap.from("[data-empty-hint]", {
        opacity: 0,
        duration: 0.7,
        delay: 0.5,
      });
    },
    { scope: ref, dependencies: [] },
  );
  return (
    <div
      ref={ref}
      className="relative flex flex-1 flex-col items-center justify-center overflow-hidden px-6 py-10 text-center"
    >
      <div
        className="aurora pointer-events-none absolute inset-0 opacity-50"
        aria-hidden
      />
      <p
        data-empty-eyebrow
        className="text-blueprint-accent relative font-mono text-[10px] tracking-[0.3em] uppercase"
      >
        Step 1 · paste your requirements
      </p>
      <h2
        data-empty-h
        className="text-blueprint-text font-display relative mt-4 max-w-xl text-3xl leading-tight font-bold sm:text-4xl"
      >
        Drop in raw client text.{" "}
        <span className="font-serif text-[var(--color-blueprint-accent)] italic">
          We&apos;ll do the rest.
        </span>
      </h2>
      <p
        data-empty-p
        className="text-blueprint-muted relative mt-4 max-w-md text-sm leading-relaxed sm:text-base"
      >
        Messages, call notes, a rough doc — anything. Aureon extracts a structured scope
        and asks targeted questions only when the input is missing something important.
      </p>
      <p
        data-empty-hint
        className="text-blueprint-muted relative mt-8 font-mono text-[10px] tracking-[0.18em]"
      >
        ↓ pick a sample below or paste your own
      </p>
    </div>
  );
}

function StaleNotice({
  message,
  onDismiss,
}: {
  message: string;
  onDismiss(): void;
}): React.ReactElement {
  const ref = useRef<HTMLDivElement | null>(null);
  useGSAP(
    () => {
      gsap.from(ref.current, {
        y: -12,
        opacity: 0,
        duration: 0.45,
        ease: "scopeai-out",
      });
    },
    { scope: ref, dependencies: [] },
  );
  return (
    <div
      ref={ref}
      role="status"
      className="border-b border-amber-400/30 bg-amber-400/10 px-6 py-3 text-sm text-amber-200"
    >
      <div className="mx-auto flex w-full max-w-3xl items-center justify-between gap-4">
        <span>{message}</span>
        <button
          type="button"
          onClick={onDismiss}
          className="rounded-md border border-amber-400/40 px-2.5 py-1 text-[11px] tracking-wider uppercase hover:bg-amber-400/15"
        >
          Dismiss
        </button>
      </div>
    </div>
  );
}

function ErrorBanner({
  message,
  onRetry,
}: {
  message: string;
  onRetry?: () => void;
}): React.ReactElement {
  return (
    <div
      role="alert"
      className="border-b border-red-500/30 bg-red-500/10 px-6 py-3 text-sm text-red-300"
    >
      <div className="mx-auto flex w-full max-w-3xl items-center justify-between gap-4">
        <span>{message}</span>
        {onRetry && (
          <button
            type="button"
            onClick={onRetry}
            className="rounded-md border border-red-500/40 px-2.5 py-1 text-[11px] tracking-wider uppercase hover:bg-red-500/15"
          >
            Dismiss
          </button>
        )}
      </div>
    </div>
  );
}
