"use client";
import { useEffect } from "react";
import { BrandedError } from "@/components/BrandedError";

interface GlobalErrorProps {
  error: Error & { digest?: string };
  reset: () => void;
}

/**
 * Last-resort error boundary. Next requires `<html>` and `<body>` here
 * because the root layout itself crashed. We keep the markup minimal and
 * inline the blueprint background into BrandedError so styling does not
 * depend on a still-loading CSS bundle.
 */
export default function GlobalError({
  error,
  reset,
}: GlobalErrorProps): React.ReactElement {
  useEffect(() => {
    console.error("[scopeai] global error", {
      name: error.name,
      message: error.message,
      digest: error.digest,
    });
  }, [error]);

  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          backgroundColor: "#0a1628",
          color: "#e0f2fe",
          fontFamily:
            "system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif",
        }}
      >
        <BrandedError onReload={reset} hideHome />
      </body>
    </html>
  );
}
