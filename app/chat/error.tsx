"use client";
import { useEffect } from "react";
import { BrandedError } from "@/components/BrandedError";

interface Props {
  error: Error & { digest?: string };
  reset: () => void;
}

export default function ChatError({ error, reset }: Props): React.ReactElement {
  useEffect(() => {
    console.error("[scopeai] /chat error", {
      name: error.name,
      message: error.message,
      digest: error.digest,
    });
  }, [error]);
  return (
    <BrandedError
      title="The chat ran into a snag."
      message="Your session is preserved server-side. Reload to pick up where you left off."
      onReload={reset}
    />
  );
}
