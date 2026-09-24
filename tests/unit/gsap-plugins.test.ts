import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * PERF-02: `lib/gsap-init.ts` is imported by every animated component, so
 * whatever it registers ships to every page. It once registered eleven
 * plugins nothing called. This keeps the shared module small and the
 * page-specific plugins in their own modules.
 */

/** Code only: the comments in these files name the plugins they dropped. */
function code(path: string): string {
  return readFileSync(path, "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/.*$/gm, "");
}

const CORE = code("lib/gsap-init.ts");
const TEXT = code("lib/gsap-text.ts");
const SVG = code("lib/gsap-svg.ts");

/** Plugins the app does not use. Adding one back should fail this test. */
const UNUSED = [
  "Draggable",
  "Flip",
  "InertiaPlugin",
  "MorphSVGPlugin",
  "Physics2DPlugin",
  "ScrollToPlugin",
  "ExpoScaleEase",
  "SlowMo",
  "RoughEase",
  "CustomBounce",
  "CustomWiggle",
  "TextPlugin",
];

describe("the shared GSAP module", () => {
  it.each(UNUSED)("does not register %s, which nothing calls", (plugin) => {
    expect(CORE).not.toContain(plugin);
  });

  it("registers what every page does use", () => {
    for (const plugin of ["useGSAP", "CustomEase", "Observer", "ScrollTrigger"]) {
      expect(CORE).toContain(plugin);
    }
  });

  it("keeps the page-specific plugins out of it", () => {
    for (const plugin of ["SplitText", "ScrambleTextPlugin", "DrawSVGPlugin"]) {
      expect(CORE).not.toContain(plugin);
    }
  });

  it("still defines the custom eases the whole app names", () => {
    for (const ease of ["scopeai-out", "scopeai-in", "scopeai-bounce"]) {
      expect(CORE).toContain(ease);
    }
  });
});

describe("the split modules", () => {
  it("hold the text effects the landing page uses", () => {
    expect(TEXT).toContain("SplitText");
    expect(TEXT).toContain("ScrambleTextPlugin");
  });

  it("hold the SVG plugins the roadmap uses", () => {
    expect(SVG).toContain("DrawSVGPlugin");
    expect(SVG).toContain("MotionPathPlugin");
  });

  it("build on the shared module rather than registering their own core", () => {
    expect(TEXT).toContain('from "@/lib/gsap-init"');
    expect(SVG).toContain('from "@/lib/gsap-init"');
  });
});

describe("the components", () => {
  it.each([
    ["components/chat/PipelineRoadmap.tsx", "@/lib/gsap-svg"],
    ["components/landing/Hero.tsx", "@/lib/gsap-text"],
    ["components/landing/CTA.tsx", "@/lib/gsap-text"],
    ["components/landing/TechStack.tsx", "@/lib/gsap-text"],
    ["components/landing/WireframeFallback.tsx", "@/lib/gsap-svg"],
  ])("%s takes its extra plugins from %s", (file, module) => {
    expect(code(file)).toContain(module);
  });
});
