"use client";

// Add the keyframe via a hidden <style> below — it's a one-time inject so
// every skeleton on the page can use it without each component owning it.
export function SkeletonKeyframes(): React.ReactElement {
  return (
    <style jsx global>{`
      @keyframes skeleton {
        100% {
          transform: translateX(100%);
        }
      }
    `}</style>
  );
}
