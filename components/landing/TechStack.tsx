"use client";
import { useRef } from "react";
import { gsap, useGSAP, ScrollTrigger } from "@/lib/gsap-init";
import { ScrambleTextPlugin } from "@/lib/gsap-text";
import { BlueprintGrid } from "@/components/landing/BlueprintGrid";

void ScrollTrigger;
void ScrambleTextPlugin;

interface LogoProps {
  className?: string;
}

function GeminiLogo({ className }: LogoProps): React.ReactElement {
  return (
    <svg viewBox="0 0 128 128" className={className} role="img" aria-label="Gemini">
      {/* Four-pointed star: the shape the Gemini brand uses. */}
      <path
        fill="currentColor"
        d="M64 16c2 20 12 30 32 32-20 2-30 12-32 32-2-20-12-30-32-32 20-2 30-12 32-32z"
      />
    </svg>
  );
}

function GitHubLogo({ className }: LogoProps): React.ReactElement {
  return (
    <svg
      viewBox="0 0 24 24"
      className={className}
      role="img"
      aria-label="GitHub"
      fill="currentColor"
    >
      <path d="M12 0C5.37 0 0 5.37 0 12a12 12 0 008.21 11.39c.6.11.82-.26.82-.58v-2c-3.34.73-4.04-1.61-4.04-1.61-.55-1.39-1.34-1.76-1.34-1.76-1.09-.74.08-.73.08-.73 1.21.09 1.85 1.24 1.85 1.24 1.07 1.84 2.81 1.31 3.5 1 .11-.78.42-1.31.76-1.61-2.67-.3-5.47-1.33-5.47-5.93 0-1.31.47-2.38 1.24-3.22-.13-.3-.54-1.52.12-3.17 0 0 1.01-.32 3.3 1.23a11.5 11.5 0 016 0c2.29-1.55 3.3-1.23 3.3-1.23.66 1.65.25 2.87.12 3.17.77.84 1.24 1.91 1.24 3.22 0 4.61-2.81 5.62-5.49 5.92.43.37.81 1.1.81 2.22v3.29c0 .32.21.7.83.58A12 12 0 0024 12c0-6.63-5.37-12-12-12z" />
    </svg>
  );
}

function NextLogo({ className }: LogoProps): React.ReactElement {
  return (
    <svg viewBox="0 0 180 180" className={className} role="img" aria-label="Next.js">
      <defs>
        <linearGradient id="next-grad" x1="0" x2="1" y1="0" y2="1">
          <stop offset="0%" stopColor="#f3e8ff" stopOpacity="0.85" />
          <stop offset="100%" stopColor="#ec4899" stopOpacity="0.75" />
        </linearGradient>
      </defs>
      <circle
        cx="90"
        cy="90"
        r="86"
        fill="none"
        stroke="url(#next-grad)"
        strokeWidth="2"
      />
      <path
        fill="currentColor"
        d="M61 54v72h6V72.5l44.6 53.5h7L67 54h-6zm51 0v40h6V54h-6z"
      />
    </svg>
  );
}

const ITEMS = [
  { name: "Gemini", Logo: GeminiLogo },
  { name: "GitHub", Logo: GitHubLogo },
  { name: "Next.js", Logo: NextLogo },
] as const;

const POWER_LINE = "Powered by Google Gemini";

export function TechStack(): React.ReactElement {
  const root = useRef<HTMLElement | null>(null);

  useGSAP(
    () => {
      const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

      // Stagger entrance for the logo grid.
      gsap.from("[data-tech-item]", {
        opacity: 0,
        y: 18,
        duration: 0.7,
        stagger: 0.12,
        ease: "scopeai-out",
        scrollTrigger: { trigger: root.current, start: "top 80%" },
      });

      // Continuous gentle float for each item.
      if (!reduce) {
        const items = root.current?.querySelectorAll<HTMLElement>("[data-tech-item]");
        items?.forEach((el, i) => {
          gsap.to(el, {
            y: "-=6",
            duration: 4 + i * 0.5,
            repeat: -1,
            yoyo: true,
            ease: "sine.inOut",
            delay: i * 0.4,
          });
        });
      }

      // ScrambleText reveal of the POWER_LINE
      const scram = root.current?.querySelector<HTMLElement>("[data-scramble]");
      if (scram && !reduce) {
        ScrollTrigger.create({
          trigger: scram,
          start: "top 85%",
          once: true,
          onEnter: () => {
            gsap.to(scram, {
              duration: 1.6,
              scrambleText: {
                text: POWER_LINE,
                chars: "lower",
                revealDelay: 0.2,
                speed: 0.5,
              },
            });
          },
        });
      }
    },
    { scope: root, dependencies: [] },
  );

  return (
    <section ref={root} className="relative isolate overflow-hidden py-24">
      <BlueprintGrid intensity="subtle" drift={false} />

      <div className="relative z-10 mx-auto max-w-5xl px-6 text-center">
        <p className="text-blueprint-accent font-mono text-[11px] tracking-[0.3em] uppercase">
          Built on
        </p>

        <div className="mt-10 flex flex-wrap items-center justify-center gap-x-14 gap-y-10">
          {ITEMS.map(({ name, Logo }) => (
            <div key={name} data-tech-item className="flex flex-col items-center gap-3">
              <Logo className="text-blueprint-text/85 hover:text-blueprint-accent h-10 w-auto transition-colors" />
              <span className="text-blueprint-muted font-mono text-[10px] tracking-[0.2em] uppercase">
                {name}
              </span>
            </div>
          ))}
        </div>

        <p
          data-scramble
          className="text-blueprint-muted mt-12 font-mono text-xs tracking-[0.18em]"
        >
          {POWER_LINE}
        </p>
      </div>
    </section>
  );
}
