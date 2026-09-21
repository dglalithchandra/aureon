"use client";
import Link from "next/link";
import { useRef } from "react";
import { ArrowRight } from "lucide-react";
import {
  gsap,
  useGSAP,
  ScrollTrigger,
  SplitText,
  ScrambleTextPlugin,
} from "@/lib/gsap-init";
import { BlueprintGrid } from "@/components/landing/BlueprintGrid";

void ScrollTrigger;
void ScrambleTextPlugin;

export function CTA(): React.ReactElement {
  const root = useRef<HTMLElement | null>(null);

  useGSAP(
    () => {
      const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

      const heading = root.current?.querySelector<HTMLElement>("[data-cta-heading]");
      let split: SplitText | null = null;
      if (heading && !reduce) {
        split = new SplitText(heading, { type: "lines,words" });
        gsap.from(split.words, {
          yPercent: 130,
          opacity: 0,
          duration: 0.8,
          stagger: 0.05,
          ease: "scopeai-out",
          scrollTrigger: { trigger: heading, start: "top 80%" },
        });
      }

      gsap.from("[data-cta-sub]", {
        opacity: 0,
        y: 12,
        duration: 0.7,
        ease: "scopeai-out",
        scrollTrigger: { trigger: "[data-cta-sub]", start: "top 85%" },
        delay: 0.15,
      });

      gsap.from("[data-cta-btn]", {
        opacity: 0,
        scale: 0.9,
        duration: 0.7,
        ease: "scopeai-bounce",
        scrollTrigger: { trigger: "[data-cta-btn]", start: "top 85%" },
        delay: 0.25,
      });

      // Continuous accent pulse on the CTA button glow.
      if (!reduce) {
        gsap.to("[data-cta-btn]", {
          boxShadow: "0 0 60px rgba(236,72,153,0.65)",
          duration: 2,
          repeat: -1,
          yoyo: true,
          ease: "sine.inOut",
        });
      }

      return () => {
        if (split) split.revert();
      };
    },
    { scope: root, dependencies: [] },
  );

  return (
    <section ref={root} className="relative isolate overflow-hidden py-32">
      <BlueprintGrid intensity="strong" drift />
      <div className="aurora pointer-events-none absolute inset-0 z-0" aria-hidden />

      <div className="relative z-10 mx-auto flex max-w-3xl flex-col items-center px-6 text-center">
        <h2
          data-cta-heading
          className="text-blueprint-text font-display text-3xl font-bold sm:text-4xl md:text-5xl"
        >
          Stop rewriting scope notes by hand.
        </h2>
        <p
          data-cta-sub
          className="text-blueprint-muted mt-5 max-w-xl text-base sm:text-lg"
        >
          Paste once. Get a client-ready scope and an engineer-ready build doc.
        </p>

        <div className="mt-10">
          <Link
            href="/chat"
            data-cta-btn
            className="group inline-flex items-center gap-2 rounded-full border border-[var(--color-blueprint-accent)] bg-[var(--color-blueprint-accent)]/10 px-8 py-3.5 text-sm font-medium tracking-wide text-[var(--color-blueprint-accent)] transition-all duration-200 hover:bg-[var(--color-blueprint-accent)]/20 focus-visible:ring-2 focus-visible:ring-[var(--color-blueprint-accent)] focus-visible:outline-none"
          >
            Start scoping
            <ArrowRight
              className="transition-transform duration-200 group-hover:translate-x-0.5"
              size={16}
            />
          </Link>
        </div>

        <p className="text-blueprint-muted mt-10 max-w-md text-xs leading-relaxed">
          Your input is processed in-session, not stored beyond 24 hours. No tracking
          pixels. No third-party analytics. No accounts required to try it.
        </p>

        <div className="border-blueprint-line/20 mt-16 flex w-full max-w-md items-center justify-between border-t pt-6">
          <span className="text-blueprint-muted font-mono text-[10px] tracking-[0.25em] uppercase">
            ScopeAI · v1
          </span>
          <span className="text-blueprint-muted font-mono text-[10px] tracking-[0.2em]">
            built by humans, finished by AI
          </span>
        </div>
      </div>
    </section>
  );
}
