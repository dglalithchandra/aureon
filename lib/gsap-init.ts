"use client";
/**
 * The GSAP every page uses (PERF-02).
 *
 * This module used to register twenty plugins, eleven of which nothing in
 * the app called — Draggable, Flip, Inertia, MorphSVG, Physics2D, ScrollTo,
 * ExpoScale, SlowMo, RoughEase, CustomBounce and CustomWiggle — and because
 * every animated component imports this file, all of them ended up in the
 * chunk every page loads.
 *
 * What is left here is what every page genuinely needs: the core, the
 * custom eases named in animations across the app, ScrollTrigger (landing
 * and output) and Observer (which ScrollTrigger pulls in anyway). The rest
 * sit in two modules that only their own pages import:
 *
 *   - `lib/gsap-text.ts` — SplitText, ScrambleText, TextPlugin (landing)
 *   - `lib/gsap-svg.ts`  — DrawSVG, MotionPath (the pipeline roadmap)
 *
 * The registration is idempotent and guarded by a `typeof window` check so
 * server rendering never imports browser-only modules.
 */
import { gsap } from "gsap";
import { useGSAP } from "@gsap/react";

import { CustomEase } from "gsap/CustomEase";
import { Observer } from "gsap/Observer";
import { ScrollTrigger } from "gsap/ScrollTrigger";

if (typeof window !== "undefined") {
  gsap.registerPlugin(useGSAP, CustomEase, Observer, ScrollTrigger);

  // Premium-feeling custom ease used across the app for entrance + reveal.
  if (!CustomEase.get("scopeai-out")) {
    CustomEase.create("scopeai-out", "M0,0 C0.16,1 0.3,1 1,1");
    CustomEase.create("scopeai-in", "M0,0 C0.7,0 0.84,0 1,1");
    CustomEase.create("scopeai-bounce", "M0,0 C0.16,1.2 0.4,1.05 1,1");
  }
}

export { gsap, useGSAP, CustomEase, Observer, ScrollTrigger };
