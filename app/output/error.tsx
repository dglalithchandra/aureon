"use client";
import { useEffect } from "react";
import { BrandedError } from "@/components/BrandedError";

interface Props {
  error: Error & { digest?: string };
  retry: () => void;
}

export default function OutputError({ error, retry }: Props): React.ReactElement {
  useEffect(() => {
    console.error("[aureon] /output error", {
      name: error.name,
      message: error.message,
      digest: error.digest,
    });
  }, [error]);
  return (
    <BrandedError
      title="The output view ran into a snag."
      message="Your scope is safe. Reload, or head back to the chat to continue."
      onReload={retry}
    />
  );
}
