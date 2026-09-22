"use client";
import { useEffect } from "react";
import { BrandedError } from "@/components/BrandedError";

interface RouteErrorProps {
  error: Error & { digest?: string };
  reset: () => void;
}

export default function RouteError({
  error,
  reset,
}: RouteErrorProps): React.ReactElement {
  useEffect(() => {
    // Surface the error in DevTools without leaking it to the user. The
    // `digest` is Next's stable identifier for the captured error and is
    // safe to expose in support tickets.
    console.error("[aureon] route error", {
      name: error.name,
      message: error.message,
      digest: error.digest,
    });
  }, [error]);

  return <BrandedError onReload={reset} />;
}
