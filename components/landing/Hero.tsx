"use client";
import Link from "next/link";
import { useRef } from "react";
import { ArrowRight } from "lucide-react";
import { gsap, useGSAP, SplitText } from "@/lib/gsap-init";
import { BlueprintGrid } from "@/components/landing/BlueprintGrid";
import { SplineScene } from "@/components/landing/SplineScene";
import { WireframeFallback } from "@/components/landing/WireframeFallback";

const HEADLINE = "Turn raw client requirements into engineer-ready scope";

export function Hero(): React.ReactElement {
  const root = useRef<HTMLElement | null>(null);

  useGSAP(
    () => {
      const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      if (reduce) return;

      // Character-level reveal via SplitText (premium, now-free).
      const headline = document.querySelector<HTMLElement>("[data-hero-headline]");
      if (!headline) return;

      const split = new SplitText(headline, { type: "lines,words,chars" });
      gsap.set(split.chars, { yPercent: 110, opacity: 0 });

      const tl = gsap.timeline({ defaults: { ease: "scopeai-out" } });

      tl.from("[data-hero-eyebrow]", {
        opacity: 0,
        y: 6,
        duration: 0.6,
      })
        .to(
          split.chars,
          {
            yPercent: 0,
            opacity: 1,
            duration: 0.85,
            stagger: { each: 0.014, from: "start" },
          },
          0.15,
        )
        .from("[data-hero-sub]", { opacity: 0, y: 12, duration: 0.7 }, "-=0.4")
        .from(
          "[data-hero-cta] > *",
          {
            opacity: 0,
            y: 14,
            duration: 0.55,
            stagger: 0.08,
          },
          "-=0.4",
        )
        .from("[data-hero-scroll]", { opacity: 0, duration: 0.6 }, "-=0.2");

      // Continuous bounce on the scroll cue.
      gsap.to("[data-hero-scroll-dot]", {
        y: 12,
        duration: 1.4,
        repeat: -1,
        yoyo: true,
        ease: "sine.inOut",
      });

      return () => split.revert();
    },
    { scope: root, dependencies: [] },
  );

  return (
    <section
      ref={root}
      className="relative isolate flex min-h-[min(100dvh,900px)] items-center overflow-hidden"
    >
      <BlueprintGrid intensity="strong" drift />
      <div className="aurora pointer-events-none absolute inset-0 z-0" aria-hidden />

      <div
        className="pointer-events-none absolute inset-0"
        aria-hidden
        style={{
          maskImage:
            "radial-gradient(ellipse 70% 60% at 50% 50%, #000 60%, transparent 100%)",
        }}
      >
        <SplineScene className="h-full w-full" fallback={<WireframeFallback />} />
      </div>

      <div className="relative z-10 mx-auto flex w-full max-w-5xl flex-col items-center px-6 py-24 text-center">
        <span
          data-hero-eyebrow
          className="text-blueprint-muted font-mono text-[11px] tracking-[0.3em] uppercase"
        >
          Aureon · v1
        </span>

        <h1
          data-hero-headline
          className="text-blueprint-text font-display mt-6 max-w-4xl text-4xl leading-[1.05] font-bold tracking-tight sm:text-5xl md:text-6xl lg:text-7xl"
          style={{ fontStretch: "115%" }}
        >
          {HEADLINE}
        </h1>

        <p
          data-hero-sub
          className="text-blueprint-muted mt-7 max-w-xl text-base sm:text-lg"
        >
          Paste raw client text. Get a structured scope, validated against{" "}
          <span className="font-serif text-[var(--color-blueprint-text)] italic">
            real GitHub projects
          </span>
          , in two views — one for the client, one for the engineer.
        </p>

        <div
          data-hero-cta
          className="mt-10 flex flex-wrap items-center justify-center gap-4"
        >
          <Link
            href="/chat"
            className="group relative inline-flex items-center gap-2 rounded-full border border-[var(--color-blueprint-accent)] bg-[var(--color-blueprint-accent)]/10 px-7 py-3 text-sm font-medium tracking-wide text-[var(--color-blueprint-accent)] transition-all duration-200 hover:bg-[var(--color-blueprint-accent)]/20 hover:shadow-[0_0_36px_rgba(236,72,153,0.55)] focus-visible:ring-2 focus-visible:ring-[var(--color-blueprint-accent)] focus-visible:outline-none"
          >
            <span className="relative">Start scoping</span>
            <ArrowRight
              className="transition-transform duration-200 group-hover:translate-x-0.5"
              size={16}
            />
          </Link>
          <a
            href="#how-it-works"
            className="text-blueprint-muted hover:text-blueprint-text inline-flex items-center gap-2 px-3 py-3 text-sm transition-colors"
          >
            How it works
          </a>
        </div>

        <div
          data-hero-scroll
          className="absolute bottom-10 left-1/2 -translate-x-1/2"
          aria-hidden
        >
          <div className="border-blueprint-line/40 h-10 w-6 rounded-full border">
            <span
              data-hero-scroll-dot
              className="bg-blueprint-accent mx-auto mt-2 block h-1.5 w-1.5 rounded-full"
            />
          </div>
        </div>
      </div>
    </section>
  );
}
