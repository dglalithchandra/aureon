"use client";
/**
 * The SVG plugins: drawing a stroke and moving along a path (PERF-02).
 *
 * Used by the pipeline roadmap and the landing wireframe, so they load with
 * those and not with every page.
 */
import { gsap } from "@/lib/gsap-init";

import { DrawSVGPlugin } from "gsap/DrawSVGPlugin";
import { MotionPathPlugin } from "gsap/MotionPathPlugin";

if (typeof window !== "undefined") {
  gsap.registerPlugin(DrawSVGPlugin, MotionPathPlugin);
}

export { DrawSVGPlugin, MotionPathPlugin };
