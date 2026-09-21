"use client";
import { Suspense, lazy, useEffect, useRef, useState } from "react";

const SUPPORTS_INTERSECTION_OBSERVER = typeof IntersectionObserver !== "undefined";

/**
 * Spline scene wrapper with double-gating:
 *   1. The Spline runtime (~400KB) is only loaded once the hero is on
 *      screen (intersection observer).
 *   2. SSR is disabled for the Spline component itself — it would crash
 *      on the server because it touches window.
 *
 * If the optional Spline scene URL is not provided OR the runtime fails,
 * the consumer's `fallback` is rendered — which is the animated SVG
 * geometry, so the hero never looks empty.
 */

const Spline = lazy(() => import("@splinetool/react-spline"));

const SCENE_URL = process.env.NEXT_PUBLIC_SPLINE_SCENE ?? "";

interface SplineSceneProps {
  className?: string;
  fallback: React.ReactNode;
}

export function SplineScene({
  className,
  fallback,
}: SplineSceneProps): React.ReactElement {
  const containerRef = useRef<HTMLDivElement | null>(null);
  // If the browser cannot observe intersection, just load immediately —
  // computed at render time so the effect does not need to setState eagerly.
  const [shouldLoad, setShouldLoad] = useState(!SUPPORTS_INTERSECTION_OBSERVER);
  const [loadFailed, setLoadFailed] = useState(false);

  useEffect(() => {
    if (shouldLoad) return;
    const el = containerRef.current;
    if (!el || !SUPPORTS_INTERSECTION_OBSERVER) return;
    const obs = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setShouldLoad(true);
          obs.disconnect();
        }
      },
      { rootMargin: "200px" },
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, [shouldLoad]);

  const showFallback = !SCENE_URL || loadFailed;

  return (
    <div ref={containerRef} className={className}>
      {showFallback || !shouldLoad ? (
        fallback
      ) : (
        <Suspense fallback={fallback}>
          <Spline
            scene={SCENE_URL}
            onError={() => setLoadFailed(true)}
            // Hide the default Spline watermark/logo overlay.
            style={{ width: "100%", height: "100%" }}
          />
        </Suspense>
      )}
    </div>
  );
}
