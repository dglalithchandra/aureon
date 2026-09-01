"use client";
import { useRef } from "react";
import { gsap, useGSAP, DrawSVGPlugin } from "@/lib/gsap-init";

void DrawSVGPlugin;

/**
 * Animated wireframe geometry. The hexagon stack draws itself in via
 * DrawSVGPlugin (premium, now-free), then drifts in continuous slow rotation.
 * Counter-rotating axes + pulsing nodes create depth without GPU cost.
 */
export function WireframeFallback(): React.ReactElement {
  const ref = useRef<SVGSVGElement | null>(null);

  useGSAP(
    () => {
      if (!ref.current) return;
      const polys = ref.current.querySelectorAll<SVGPolygonElement>(".poly");
      const lines = ref.current.querySelectorAll<SVGLineElement>(".axis");
      const nodes = ref.current.querySelectorAll<SVGCircleElement>(".node");

      // Initial draw-on
      gsap.set([...polys, ...lines], { drawSVG: "0%" });
      gsap.set(nodes, { scale: 0, transformOrigin: "center" });

      const tl = gsap.timeline();
      tl.to(polys, {
        drawSVG: "100%",
        duration: 2.2,
        stagger: 0.18,
        ease: "scopeai-out",
      })
        .to(
          lines,
          { drawSVG: "100%", duration: 1.8, stagger: 0.1, ease: "scopeai-out" },
          0.4,
        )
        .to(
          nodes,
          {
            scale: 1,
            duration: 0.6,
            stagger: 0.08,
            ease: "scopeai-bounce",
          },
          1.2,
        );

      // Continuous orbits
      gsap.to("[data-orbit]", {
        rotation: 360,
        duration: 120,
        repeat: -1,
        ease: "none",
        transformOrigin: "400px 400px",
      });
      gsap.to("[data-orbit-rev]", {
        rotation: -360,
        duration: 90,
        repeat: -1,
        ease: "none",
        transformOrigin: "400px 400px",
      });

      // Pulsing nodes
      gsap.to(nodes, {
        opacity: 0.4,
        duration: 1.4,
        repeat: -1,
        yoyo: true,
        stagger: { each: 0.2, from: "random" },
        ease: "sine.inOut",
      });
    },
    { scope: ref },
  );

  return (
    <div className="relative h-full w-full overflow-hidden" aria-hidden>
      <svg
        ref={ref}
        className="absolute inset-0 h-full w-full"
        viewBox="0 0 800 800"
        preserveAspectRatio="xMidYMid slice"
      >
        <defs>
          <radialGradient id="bp-glow" cx="50%" cy="40%" r="50%">
            <stop offset="0%" stopColor="rgba(236,72,153,0.32)" />
            <stop offset="60%" stopColor="rgba(168,85,247,0.06)" />
            <stop offset="100%" stopColor="rgba(168,85,247,0)" />
          </radialGradient>
          <linearGradient id="bp-line" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="#a855f7" stopOpacity="0.65" />
            <stop offset="100%" stopColor="#ec4899" stopOpacity="0.75" />
          </linearGradient>
        </defs>

        <rect width="800" height="800" fill="url(#bp-glow)" />

        <g data-orbit>
          <polygon
            className="poly"
            points="400,140 660,290 660,510 400,660 140,510 140,290"
            fill="none"
            stroke="url(#bp-line)"
            strokeWidth="1.2"
          />
          <polygon
            className="poly"
            points="400,200 600,310 600,490 400,600 200,490 200,310"
            fill="none"
            stroke="url(#bp-line)"
            strokeWidth="1"
            opacity="0.7"
          />
          <polygon
            className="poly"
            points="400,260 540,335 540,465 400,540 260,465 260,335"
            fill="none"
            stroke="url(#bp-line)"
            strokeWidth="1"
            opacity="0.5"
          />
        </g>

        <g data-orbit-rev>
          <line
            className="axis"
            x1="120"
            y1="400"
            x2="680"
            y2="400"
            stroke="#a855f7"
            strokeOpacity="0.18"
            strokeWidth="1"
          />
          <line
            className="axis"
            x1="400"
            y1="120"
            x2="400"
            y2="680"
            stroke="#a855f7"
            strokeOpacity="0.18"
            strokeWidth="1"
          />
          <line
            className="axis"
            x1="180"
            y1="180"
            x2="620"
            y2="620"
            stroke="#a855f7"
            strokeOpacity="0.10"
            strokeWidth="1"
          />
          <line
            className="axis"
            x1="620"
            y1="180"
            x2="180"
            y2="620"
            stroke="#a855f7"
            strokeOpacity="0.10"
            strokeWidth="1"
          />
        </g>

        {[
          [400, 140],
          [660, 290],
          [660, 510],
          [400, 660],
          [140, 510],
          [140, 290],
        ].map(([cx, cy]) => (
          <circle
            key={`${cx}-${cy}`}
            cx={cx}
            cy={cy}
            r={4}
            fill="#ec4899"
            className="node"
          />
        ))}
      </svg>
    </div>
  );
}
