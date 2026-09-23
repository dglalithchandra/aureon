"use client";
import { useCallback, useEffect } from "react";

/**
 * Guard unsaved edits (UX-02).
 *
 * Two exits have to be covered: leaving the site, which `beforeunload`
 * catches, and an in-app link, which does not fire it — Next's `Link` takes
 * an `onNavigate` handler whose event can be cancelled, so the returned
 * `confirmLeave` goes there.
 */
export function useUnsavedChanges(
  dirty: boolean,
  message: string,
): {
  confirmLeave(): boolean;
  guardNavigation(event: { preventDefault(): void }): void;
} {
  useEffect(() => {
    if (!dirty) return;
    function onBeforeUnload(event: BeforeUnloadEvent): void {
      // Browsers show their own wording; assigning returnValue is what still
      // triggers the prompt everywhere.
      event.preventDefault();
      event.returnValue = "";
    }
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [dirty]);

  const confirmLeave = useCallback((): boolean => {
    if (!dirty) return true;
    return window.confirm(message);
  }, [dirty, message]);

  const guardNavigation = useCallback(
    (event: { preventDefault(): void }): void => {
      if (!confirmLeave()) event.preventDefault();
    },
    [confirmLeave],
  );

  return { confirmLeave, guardNavigation };
}
