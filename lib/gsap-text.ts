"use client";
/**
 * The text-effect plugins, imported only by the landing page (PERF-02).
 *
 * Keeping them out of `lib/gsap-init.ts` keeps them out of the chunk the
 * chat and output pages load, which never split or scramble text.
 */
import { gsap } from "@/lib/gsap-init";

import { ScrambleTextPlugin } from "gsap/ScrambleTextPlugin";
import { SplitText } from "gsap/SplitText";

if (typeof window !== "undefined") {
  gsap.registerPlugin(ScrambleTextPlugin, SplitText);
}

export { ScrambleTextPlugin, SplitText };
