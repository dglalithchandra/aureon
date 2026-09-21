"use client";
import { useRef, type MouseEvent } from "react";
import { Check, Users, Wrench } from "lucide-react";
import { gsap, useGSAP, ScrollTrigger, SplitText } from "@/lib/gsap-init";
import { BlueprintGrid } from "@/components/landing/BlueprintGrid";

void ScrollTrigger;

const CLIENT_BULLETS = [
  "Plain-English project summary",
  "Modules with friendly descriptions and sizes",
  "Phased milestones, calendar-friendly",
  "Every assumption stated, ready to correct",
  "Confidence breakdown with real-world match",
];

const ENGINEER_BULLETS = [
  "Module table with concrete tech stack",
  "REST endpoints in METHOD /path format",
  "Database sketch with field types and FKs",
  "Sprint plan with story points and team velocity",
  "Per-module security checklist + risk flags",
];

interface CardProps {
  title: string;
  caption: string;
  Icon: typeof Users;
  bullets: readonly string[];
  accent: "gold" | "cyan";
}

function TiltCard({
  title,
  caption,
  Icon,
  bullets,
  accent,
}: CardProps): React.ReactElement {
  const cardRef = useRef<HTMLDivElement | null>(null);
  const innerRef = useRef<HTMLDivElement | null>(null);

  useGSAP(
    () => {
      // Bullet stagger reveal on scroll-into-view.
      gsap.from(`[data-bullet-${accent}]`, {
        opacity: 0,
        x: -10,
        duration: 0.5,
        stagger: 0.07,
        ease: "scopeai-out",
        scrollTrigger: {
          trigger: cardRef.current,
          start: "top 80%",
        },
      });
    },
    { scope: cardRef, dependencies: [] },
  );

  function onMove(e: MouseEvent<HTMLDivElement>): void {
    if (!innerRef.current) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const px = (e.clientX - rect.left) / rect.width - 0.5;
    const py = (e.clientY - rect.top) / rect.height - 0.5;
    gsap.to(innerRef.current, {
      rotationX: -py * 12,
      rotationY: px * 12,
      duration: 0.45,
      ease: "scopeai-out",
      transformPerspective: 1200,
    });
  }

  function onLeave(): void {
    if (!innerRef.current) return;
    gsap.to(innerRef.current, {
      rotationX: 0,
      rotationY: 0,
      duration: 0.6,
      ease: "scopeai-bounce",
    });
  }

  const accentColor =
    accent === "gold" ? "rgba(251,191,36,0.45)" : "rgba(236,72,153,0.45)";

  return (
    <div
      ref={cardRef}
      onMouseMove={onMove}
      onMouseLeave={onLeave}
      style={{ perspective: 1200 }}
    >
      <div
        ref={innerRef}
        className="border-blueprint-line/20 hover:border-blueprint-accent/40 group relative flex flex-col gap-6 rounded-2xl border bg-white/[0.02] p-8 backdrop-blur-md transition-colors duration-300"
        style={{ transformStyle: "preserve-3d" }}
      >
        <div
          className="pointer-events-none absolute -inset-px rounded-2xl opacity-0 transition-opacity duration-300 group-hover:opacity-100"
          style={{ boxShadow: `0 0 60px ${accentColor}` }}
          aria-hidden
        />
        <div className="flex items-center gap-3">
          <div
            className="flex h-11 w-11 items-center justify-center rounded-lg border"
            style={{
              borderColor:
                accent === "gold" ? "rgba(251,191,36,0.35)" : "rgba(236,72,153,0.35)",
              backgroundColor:
                accent === "gold" ? "rgba(251,191,36,0.08)" : "rgba(236,72,153,0.08)",
            }}
          >
            <Icon
              size={20}
              strokeWidth={1.5}
              style={{ color: accent === "gold" ? "#fbbf24" : "#ec4899" }}
            />
          </div>
          <div>
            <p className="text-blueprint-muted font-mono text-[11px] tracking-[0.2em] uppercase">
              {caption}
            </p>
            <h3 className="text-blueprint-text font-display text-2xl font-bold">
              {title}
            </h3>
          </div>
        </div>

        <ul className="flex flex-col gap-3">
          {bullets.map((b) => (
            <li
              key={b}
              data-bullet-cyan={accent === "cyan" || undefined}
              data-bullet-gold={accent === "gold" || undefined}
              className="text-blueprint-text/90 flex items-start gap-3 text-sm leading-relaxed"
            >
              <Check
                className="mt-0.5 shrink-0"
                style={{ color: accent === "gold" ? "#fbbf24" : "#ec4899" }}
                size={16}
                strokeWidth={2}
              />
              <span>{b}</span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

export function OutputCards(): React.ReactElement {
  const root = useRef<HTMLElement | null>(null);

  useGSAP(
    () => {
      const heading = root.current?.querySelector<HTMLElement>("[data-outcards-heading]");
      if (!heading) return;
      const split = new SplitText(heading, { type: "words" });
      gsap.from(split.words, {
        yPercent: 120,
        opacity: 0,
        duration: 0.7,
        stagger: 0.05,
        ease: "scopeai-out",
        scrollTrigger: { trigger: heading, start: "top 80%" },
      });
      return () => split.revert();
    },
    { scope: root, dependencies: [] },
  );

  return (
    <section ref={root} className="relative isolate overflow-hidden py-28">
      <BlueprintGrid intensity="subtle" />

      <div className="relative z-10 mx-auto max-w-6xl px-6">
        <header className="mb-14 max-w-2xl">
          <p className="text-blueprint-accent font-mono text-[11px] tracking-[0.3em] uppercase">
            What you get
          </p>
          <h2
            data-outcards-heading
            className="text-blueprint-text font-display mt-3 text-3xl font-bold sm:text-4xl md:text-5xl"
          >
            Two views from one input.
          </h2>
          <p className="text-blueprint-muted mt-4 text-base sm:text-lg">
            One document the client signs off on, one document the engineer opens on day
            1. <span className="font-serif italic">Same source of truth.</span>
          </p>
        </header>

        <div className="grid gap-6 md:grid-cols-2">
          <TiltCard
            title="Client View"
            caption="approval doc"
            Icon={Users}
            bullets={CLIENT_BULLETS}
            accent="gold"
          />
          <TiltCard
            title="Engineer View"
            caption="build doc"
            Icon={Wrench}
            bullets={ENGINEER_BULLETS}
            accent="cyan"
          />
        </div>
      </div>
    </section>
  );
}
