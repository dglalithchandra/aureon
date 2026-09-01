"use client";
/**
 * Centralized GSAP plugin registration. Import this once in any client
 * component that uses GSAP and the plugins will be ready everywhere.
 *
 * The registration is idempotent — gsap.registerPlugin is a no-op for
 * plugins that are already registered. We guard the call with a typeof
 * window check so SSR doesn't blow up importing browser-only modules.
 *
 * GSAP 3.13+ open-sourced everything that used to require a Club account
 * (DrawSVG, MorphSVG, SplitText, ScrollSmoother, Physics2D, Inertia,
 * MotionPathHelper, ScrambleText, CustomEase/Bounce/Wiggle, GSDevTools).
 * They all ship in the public `gsap` npm package now.
 */
import { gsap } from "gsap";
import { useGSAP } from "@gsap/react";

import { CustomEase } from "gsap/CustomEase";
import { CustomBounce } from "gsap/CustomBounce";
import { CustomWiggle } from "gsap/CustomWiggle";
import { RoughEase, ExpoScaleEase, SlowMo } from "gsap/EasePack";

import { Draggable } from "gsap/Draggable";
import { DrawSVGPlugin } from "gsap/DrawSVGPlugin";
import { Flip } from "gsap/Flip";
import { InertiaPlugin } from "gsap/InertiaPlugin";
import { MotionPathPlugin } from "gsap/MotionPathPlugin";
import { MorphSVGPlugin } from "gsap/MorphSVGPlugin";
import { Observer } from "gsap/Observer";
import { Physics2DPlugin } from "gsap/Physics2DPlugin";
import { ScrambleTextPlugin } from "gsap/ScrambleTextPlugin";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { ScrollToPlugin } from "gsap/ScrollToPlugin";
import { SplitText } from "gsap/SplitText";
import { TextPlugin } from "gsap/TextPlugin";

if (typeof window !== "undefined") {
  gsap.registerPlugin(
    useGSAP,
    Draggable,
    DrawSVGPlugin,
    Flip,
    InertiaPlugin,
    MotionPathPlugin,
    MorphSVGPlugin,
    Observer,
    Physics2DPlugin,
    ScrambleTextPlugin,
    ScrollTrigger,
    ScrollToPlugin,
    SplitText,
    TextPlugin,
    RoughEase,
    ExpoScaleEase,
    SlowMo,
    CustomEase,
    CustomBounce,
    CustomWiggle,
  );

  // Premium-feeling custom ease used across the app for entrance + reveal.
  if (!CustomEase.get("scopeai-out")) {
    CustomEase.create("scopeai-out", "M0,0 C0.16,1 0.3,1 1,1");
    CustomEase.create("scopeai-in", "M0,0 C0.7,0 0.84,0 1,1");
    CustomEase.create("scopeai-bounce", "M0,0 C0.16,1.2 0.4,1.05 1,1");
  }
}

export {
  gsap,
  useGSAP,
  CustomEase,
  CustomBounce,
  CustomWiggle,
  Draggable,
  DrawSVGPlugin,
  Flip,
  InertiaPlugin,
  MotionPathPlugin,
  MorphSVGPlugin,
  Observer,
  Physics2DPlugin,
  ScrambleTextPlugin,
  ScrollTrigger,
  ScrollToPlugin,
  SplitText,
  TextPlugin,
};
