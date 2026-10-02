import { useEffect, useRef } from "react";
import { money } from "../route-helpers";
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
    <div className="fixed inset-0 z-40 grid place-items-center bg-slate-900/40 p-4">
      <div className="w-full max-w-3xl overflow-hidden rounded-xl border border-slate-300 bg-white shadow-2xl">
        <div className="border-b border-slate-200 p-4">
          <p className="text-2xl font-semibold text-slate-900">Order Discount</p>
          <p className="text-sm text-slate-500">Base eligible: ₹ {money(base)}</p>
          <div className="mt-3 flex items-center gap-3">
            <div className="rounded border border-slate-200 bg-slate-50 px-3 py-2 text-2xl font-semibold text-slate-800">
              {value} {mode === "PERCENT" ? "%" : "₹"}
            </div>
            <div className="text-lg text-amber-700">Applied: ₹ {money(applied)}</div>
          </div>
        </div>

        <div className="grid grid-cols-4 gap-1 p-4">
          {KEYS.map((key) => {
            if (key === "Done") {
              return (
                <button
                  key={key}
                  className="col-span-4 rounded bg-emerald-600 px-2 py-4 text-xl font-bold text-white"
                  onClick={onClose}
                >
                  Done
                </button>
              );
            }
            return (
              <button
                key={key}
                className={`rounded px-2 py-4 text-2xl font-semibold ${
                  key === "%"
                    ? "bg-amber-200 text-amber-900"
                    : key === "C"
                      ? "bg-rose-200 text-rose-800"
                      : "bg-slate-100 text-slate-800"
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
