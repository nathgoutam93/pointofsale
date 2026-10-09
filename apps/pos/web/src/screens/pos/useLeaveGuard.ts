import { useBlocker } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { setLeaveGuard } from "../../lib/leaveGuard";
import type { LeaveChoice } from "./types";

type LeaveGuardOptions = {
  /** There is a cart that hasn't been billed. */
  hasUnsavedCart: boolean;
  /** A checkout is in flight: that cart is being paid for, so don't save or leave. */
  busy: boolean;
  onBusy: () => void;
  /** Save the cart as a draft and reset the order (throws if storage fails). */
  saveDraft: () => void;
  /** Save the cart as a draft, keeping it on screen (the page is going away). */
  saveDraftOnUnload: () => void;
  discard: () => void;
  onSaveFailed: () => void;
};

/**
 * Leaving the POS with an unsaved cart. In-app navigation, Logout and Close Register ask
 * Save draft / Discard / Stay first (render `leavePrompt` as a dialog while it is set).
 * Closing, reloading or hiding the page can't show a dialog, so the cart is saved as a
 * draft silently instead.
 */
export function useLeaveGuard(options: LeaveGuardOptions) {
  const [leavePrompt, setLeavePrompt] = useState<((choice: LeaveChoice) => void) | null>(null);
  const optionsRef = useRef(options);
  optionsRef.current = options;

  const askToLeaveRef = useRef(async (): Promise<boolean> => {
    const o = optionsRef.current;
    if (o.busy) {
      o.onBusy();
      return false;
    }
    if (!o.hasUnsavedCart) return true;
    const choice = await new Promise<LeaveChoice>((resolve) => {
      setLeavePrompt(() => (picked: LeaveChoice) => {
        setLeavePrompt(null);
        resolve(picked);
      });
    });
    if (choice === "stay") return false;
    if (choice === "discard") {
      optionsRef.current.discard();
      return true;
    }
    try {
      optionsRef.current.saveDraft();
      return true;
    } catch {
      optionsRef.current.onSaveFailed();
      return false;
    }
  });

  useEffect(() => {
    setLeaveGuard(() => askToLeaveRef.current());
    return () => setLeaveGuard(null);
  }, []);

  useBlocker({
    disabled: !options.hasUnsavedCart && !options.busy,
    enableBeforeUnload: false,
    shouldBlockFn: async ({ next }) => {
      if (next.pathname === "/pos") return false;
      return !(await askToLeaveRef.current());
    },
  });

  useEffect(() => {
    // One set of listeners for the page's lifetime; they read the latest options through a
    // ref. Tablets often skip beforeunload, so pagehide and going to the background save too.
    const save = () => {
      const o = optionsRef.current;
      if (!o.hasUnsavedCart || o.busy) return;
      try {
        o.saveDraftOnUnload();
      } catch {
        // Nothing can be shown while the page is going away.
      }
    };
    const onVisibility = () => {
      if (document.visibilityState === "hidden") save();
    };
    window.addEventListener("beforeunload", save);
    window.addEventListener("pagehide", save);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.removeEventListener("beforeunload", save);
      window.removeEventListener("pagehide", save);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, []);

  return { leavePrompt };
}
