"use client";
import { useRef } from "react";
import {
  ClipboardPaste,
  Sparkles,
  GitBranch,
  MessagesSquare,
  FileCheck2,
} from "lucide-react";
import { gsap, useGSAP, ScrollTrigger, Observer, SplitText } from "@/lib/gsap-init";
import { BlueprintGrid } from "@/components/landing/BlueprintGrid";

void ScrollTrigger;
void Observer;

const STEPS = [
  {
    n: "01",
    title: "Paste requirements",
    desc: "Drop in raw client text — messages, notes, anything.",
    Icon: ClipboardPaste,
  },
  {
    n: "02",
    title: "Extract & score",
    desc: "Nine parameters classified, with evidence and gaps.",
    Icon: Sparkles,
  },
  {
    n: "03",
    title: "Validate against GitHub",
    desc: "Top similar repos mined for module patterns.",
    Icon: GitBranch,
  },
  {
    n: "04",
    title: "Clarify gaps",
    desc: "MCQ rounds target only what's missing or thin.",
    Icon: MessagesSquare,
  },
  {
    n: "05",
    title: "Two-stage output",
    desc: "Plain-English client view + concrete engineer doc.",
    Icon: FileCheck2,
  },
] as const;

export function HowItWorks(): React.ReactElement {
  const sectionRef = useRef<HTMLElement | null>(null);
  const trackRef = useRef<HTMLDivElement | null>(null);

  useGSAP(
    () => {
      const section = sectionRef.current;
      const track = trackRef.current;
      if (!section || !track) return;

      const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      const isMobile = window.matchMedia("(max-width: 767px)").matches;

      // Heading reveal — split into words.
      const heading = section.querySelector<HTMLElement>("[data-howit-heading]");
      let headingSplit: SplitText | null = null;
      if (heading && !reduce) {
        headingSplit = new SplitText(heading, { type: "words" });
        gsap.from(headingSplit.words, {
          yPercent: 120,
          opacity: 0,
          duration: 0.7,
          stagger: 0.05,
          ease: "scopeai-out",
          scrollTrigger: { trigger: heading, start: "top 80%" },
        });
      }

      // Card entrance reveal as the section enters.
      gsap.from("[data-howit-card]", {
        opacity: 0,
        y: 40,
        scale: 0.96,
        duration: 0.8,
        stagger: 0.08,
        ease: "scopeai-out",
        scrollTrigger: { trigger: section, start: "top 70%" },
      });

      if (reduce || isMobile) return;

      // Pinned horizontal scroll on desktop.
      const compute = (): number => track.scrollWidth - window.innerWidth;
      const horiz = gsap.to(track, {
        x: () => -compute(),
        ease: "none",
        scrollTrigger: {
          trigger: section,
          start: "top top",
          end: () => `+=${compute()}`,
          pin: true,
          scrub: 0.6,
          invalidateOnRefresh: true,
          anticipatePin: 1,
        },
      });

      // Track-progress glow under each card as it scrolls past center.
      const cards = track.querySelectorAll<HTMLElement>("[data-howit-card]");
      cards.forEach((card) => {
        ScrollTrigger.create({
          trigger: card,
          start: "left center",
          end: "right center",
          containerAnimation: horiz,
          onToggle: ({ isActive }) => {
            gsap.to(card, {
              borderColor: isActive ? "rgba(236,72,153,0.7)" : "rgba(168,85,247,0.2)",
              boxShadow: isActive
                ? "0 0 38px rgba(236,72,153,0.22)"
                : "0 0 0 rgba(0,0,0,0)",
              duration: 0.4,
              ease: "scopeai-out",
            });
          },
        });
      });

      return () => {
        if (headingSplit) headingSplit.revert();
      };
    },
    { scope: sectionRef, dependencies: [] },
  );

  return (
    <section
      id="how-it-works"
      ref={sectionRef}
      className="relative isolate overflow-hidden py-28 md:h-[100dvh] md:py-0"
    >
      <BlueprintGrid intensity="subtle" />

      <div className="relative z-10 mx-auto max-w-7xl px-6 md:flex md:h-full md:flex-col md:justify-center">
        <header className="mb-12 max-w-2xl">
          <p className="text-blueprint-accent font-mono text-[11px] tracking-[0.3em] uppercase">
            How it works
          </p>
          <h2
            data-howit-heading
            className="text-blueprint-text font-display mt-3 text-3xl font-bold sm:text-4xl md:text-5xl"
          >
            From raw text to engineer-ready in five steps.
          </h2>
        </header>

        <div className="overflow-hidden md:overflow-visible">
          <div
            ref={trackRef}
            className="grid grid-cols-1 gap-6 md:flex md:flex-nowrap md:gap-8"
            style={{ willChange: "transform" }}
          >
            {STEPS.map(({ n, title, desc, Icon }) => (
              <article
                key={n}
                data-howit-card
                className="group bg-blueprint-line/[0.04] border-blueprint-line/20 relative flex w-full flex-col gap-4 rounded-2xl border p-7 backdrop-blur-md transition-colors duration-300 md:w-[380px] md:shrink-0"
              >
                <span className="text-blueprint-muted font-mono text-xs tracking-[0.2em]">
                  {n}
                </span>
                <Icon
                  className="text-blueprint-accent transition-transform duration-300 group-hover:scale-110"
                  size={28}
                  strokeWidth={1.5}
                />
                <h3 className="text-blueprint-text font-display text-2xl font-semibold">
                  {title}
                </h3>
                <p className="text-blueprint-muted text-sm leading-relaxed">{desc}</p>
                <div
                  className="from-blueprint-accent/0 via-blueprint-accent/40 to-blueprint-accent/0 mt-auto h-px bg-gradient-to-r"
                  aria-hidden
                />
              </article>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
