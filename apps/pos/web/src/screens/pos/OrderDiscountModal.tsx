import { useEffect, useRef } from "react";
import { inr } from "../route-helpers";
import { keypadKeyFromEvent, shouldIgnoreDialogKey } from "./keyboard";
import type { DiscountMode } from "./useOrderDiscount";

const KEYS = ["1", "2", "3", "%", "4", "5", "6", "C", "7", "8", "9", "<", "+/-", "0", ".", "Done"];

/** Keypad for the order discount. Enter or Escape closes it; typed digits go to the keypad. */
export function OrderDiscountModal({
  base,
  value,
  mode,
  applied,
  onKey,
  onClose,
}: {
  base: number;
  value: string;
  mode: DiscountMode;
  applied: number;
  onKey: (key: string) => void;
  onClose: () => void;
}) {
  const handlersRef = useRef({ onKey, onClose });
  handlersRef.current = { onKey, onClose };

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (shouldIgnoreDialogKey(event)) return;

      if (event.key === "Enter" || event.key === "Escape") {
        event.preventDefault();
        handlersRef.current.onClose();
        return;
      }

      const keypadKey = keypadKeyFromEvent(event);
      if (!keypadKey) return;
      event.preventDefault();
      handlersRef.current.onKey(keypadKey);
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, []);

  return (
    <div className="modal-backdrop">
      <div className="max-h-[calc(100vh-2rem)] w-full max-w-3xl overflow-y-auto rounded-xl border border-slate-200 bg-white shadow-2xl">
        <div className="border-b border-slate-200 bg-slate-50 p-6">
          <p className="text-2xl font-semibold text-slate-900">Order Discount</p>
          <p className="text-sm text-slate-500">Base eligible: {inr(base)}</p>
          <div className="mt-3 flex items-center gap-3">
            <div className="rounded-md border border-slate-200 bg-white px-3 py-2 text-2xl font-semibold text-slate-900 tabular-nums">
              {value} {mode === "PERCENT" ? "%" : "₹"}
            </div>
            <div className="text-lg text-amber-700">Applied: {inr(applied)}</div>
          </div>
        </div>

        <div className="grid grid-cols-4 gap-2 p-6">
          {KEYS.map((key) => {
            if (key === "Done") {
              return (
                <button
                  key={key}
                  className="btn-primary col-span-4 h-14 text-base"
                  onClick={onClose}
                >
                  Done
                </button>
              );
            }
            return (
              <button
                key={key}
                className={`h-14 rounded-md border text-xl font-semibold tabular-nums transition-colors active:scale-[0.97] ${
                  key === "%"
                    ? "border-brand-200 bg-brand-50 text-brand-700 hover:bg-brand-100"
                    : key === "C"
                      ? "border-rose-200 bg-white text-rose-700 hover:bg-rose-50"
                      : "border-slate-200 bg-white text-slate-800 hover:bg-slate-50"
                }`}
                onClick={() => onKey(key)}
              >
                {key}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
