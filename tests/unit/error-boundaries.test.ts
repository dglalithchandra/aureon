import { createElement, type ReactElement } from "react";
import { renderToString } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { BrandedErrorProps } from "@/components/BrandedError";
import RouteError from "@/app/error";
import ChatError from "@/app/chat/error";
import OutputError from "@/app/output/error";
import GlobalError from "@/app/global-error";

// Record what each boundary passes to the branded fallback instead of
// rendering it (framer-motion / GSAP are irrelevant to the wiring).
const rendered = vi.hoisted(() => ({ props: [] as BrandedErrorProps[] }));
vi.mock("@/components/BrandedError", () => ({
  BrandedError: (props: BrandedErrorProps) => {
    rendered.props.push(props);
    return null;
  },
}));

type ErrorBoundary = (props: {
  error: Error & { digest?: string };
  retry: () => void;
}) => ReactElement;

beforeEach(() => {
  rendered.props.length = 0;
});

describe("error boundaries", () => {
  it.each([
    ["app/error.tsx", RouteError],
    ["app/chat/error.tsx", ChatError],
    ["app/output/error.tsx", OutputError],
    ["app/global-error.tsx", GlobalError],
  ] as Array<[string, ErrorBoundary]>)(
    "%s wires Next's retry() to the Reload button",
    (_file, Boundary) => {
      const retry = vi.fn();
      renderToString(createElement(Boundary, { error: new Error("boom"), retry }));

      expect(rendered.props).toHaveLength(1);
      rendered.props[0]?.onReload?.();
      expect(retry).toHaveBeenCalledTimes(1);
    },
  );

  it("global-error renders its own document and hides the home link", () => {
    const html = renderToString(
      createElement(GlobalError, { error: new Error("boom"), retry: () => {} }),
    );
    expect(html).toContain('<html lang="en">');
    expect(rendered.props[0]?.hideHome).toBe(true);
  });
});
