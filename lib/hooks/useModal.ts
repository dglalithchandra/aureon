"use client";
import { useEffect, useRef } from "react";

/**
 * The keyboard contract every dialog in the app owes its reader (A11Y-01).
 *
 * Escape closes it, Tab cycles inside it instead of wandering into the page
 * behind, focus moves in when it opens and back to whatever opened it when
 * it closes. `modal: false` gives a side panel the Escape key and the entry
 * focus without the trap, because the page behind it is still usable.
 */

const FOCUSABLE = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  '[tabindex]:not([tabindex="-1"])',
].join(",");

export function useModal<T extends HTMLElement>(
  open: boolean,
  onClose: () => void,
  options: { modal?: boolean } = {},
): React.RefObject<T | null> {
  const ref = useRef<T | null>(null);
  const modal = options.modal ?? true;
  // Kept in a ref so a new closure each render does not re-run the effect
  // and steal focus back mid-typing.
  const close = useRef(onClose);
  useEffect(() => {
    close.current = onClose;
  }, [onClose]);

  useEffect(() => {
    if (!open) return;
    const root = ref.current;
    const opener = document.activeElement as HTMLElement | null;

    const first = root?.querySelector<HTMLElement>(FOCUSABLE);
    (first ?? root)?.focus();

    function onKeyDown(event: KeyboardEvent): void {
      if (event.key === "Escape") {
        event.stopPropagation();
        close.current();
        return;
      }
      if (event.key !== "Tab" || !modal || !root) return;

      const focusable = Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
        (el) => el.offsetParent !== null || el === document.activeElement,
      );
      if (focusable.length === 0) {
        event.preventDefault();
        return;
      }
      const first = focusable[0]!;
      const last = focusable[focusable.length - 1]!;
      const active = document.activeElement;
      if (event.shiftKey && (active === first || !root.contains(active))) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && active === last) {
        event.preventDefault();
        first.focus();
      }
    }

    document.addEventListener("keydown", onKeyDown, true);
    return () => {
      document.removeEventListener("keydown", onKeyDown, true);
      // Take focus back unless the reader has already moved it somewhere
      // outside: on unmount the focused node is gone and the browser has
      // fallen back to <body>, which is not "somewhere else".
      const active = document.activeElement;
      const adrift = !active || active === document.body;
      if (adrift || !root || root.contains(active)) opener?.focus?.();
    };
  }, [open, modal]);

  return ref;
}
