import { useEffect, useRef } from "react";
import { inr } from "../route-helpers";
import { computeLineAmounts, formatQty } from "./cartMath";
import type { TaxCalculationMode } from "./cartMath";
import { keypadKeyFromEvent, shouldIgnoreDialogKey } from "./keyboard";
import type { CartLine } from "./types";
import type { LineEditor } from "./useLineEditor";

/**
 * Keypad for editing a cart line. Enter applies, Escape goes back, Q/P/D pick the field
 * and typed digits go to the keypad.
 */
export function LineEditorModal({
  editor,
  activeEditLine,
  taxCalculationMode,
  chargeTax,
}: {
  editor: LineEditor;
  activeEditLine: CartLine;
  taxCalculationMode: TaxCalculationMode;
  chargeTax: boolean;
}) {
  const { displayEditLine, editField, editValue, discountMode } = editor;
  const editorRef = useRef(editor);
  editorRef.current = editor;

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (shouldIgnoreDialogKey(event)) return;
      const current = editorRef.current;

      if (event.key === "Enter") {
        event.preventDefault();
        current.apply();
        return;
      }
      if (event.key === "Escape") {
        event.preventDefault();
        current.close();
        return;
      }
      const field = ({ q: "QTY", p: "PRICE", d: "DISCOUNT" } as const)[event.key.toLowerCase() as "q" | "p" | "d"];
      if (field) {
        event.preventDefault();
        current.press(field);
        return;
      }

      const keypadKey = keypadKeyFromEvent(event);
      if (!keypadKey) return;
      event.preventDefault();
      current.press(keypadKey);
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, []);

  return (
    <div className="modal-backdrop">
      <div className="max-h-[calc(100vh-2rem)] w-full max-w-5xl overflow-y-auto rounded-xl border border-slate-200 bg-white shadow-2xl">
        <div className="grid grid-cols-1 lg:grid-cols-[1fr_420px]">
          <div className="border-b border-slate-200 bg-slate-50 p-6 lg:border-r lg:border-b-0">
            <div className="flex items-center justify-between">
              <div>
                <p className="eyebrow">Edit line</p>
                <p className="mt-0.5 text-xl font-semibold text-slate-900">
                  {displayEditLine?.name}
                </p>
              </div>
            </div>

            <div className="mt-4 grid gap-3 sm:grid-cols-3">
              <button
                className={`rounded-md border px-3 py-3 text-left transition-colors ${editField === "QTY" ? "border-brand-600 bg-brand-50 ring-1 ring-brand-600" : "border-slate-200 bg-white hover:bg-slate-50"}`}
                onClick={() =>
                  displayEditLine
                    ? editor.selectField("QTY", displayEditLine)
                    : null
                }
              >
                <p className="eyebrow">
                  Qty
                </p>
                <p className="mt-0.5 text-xl font-semibold text-slate-900 tabular-nums">
                  {displayEditLine
                    ? displayEditLine.saleUom
                      ? `${displayEditLine.saleUomQty ?? 1} ${displayEditLine.saleUom}`
                      : formatQty(displayEditLine.qty, displayEditLine.leastCount)
                    : "0"}
                </p>
              </button>
              <button
                className={`rounded-md border px-3 py-3 text-left transition-colors ${editField === "DISCOUNT" ? "border-brand-600 bg-brand-50 ring-1 ring-brand-600" : "border-slate-200 bg-white hover:bg-slate-50"}`}
                onClick={() =>
                  displayEditLine
                    ? editor.selectField("DISCOUNT", displayEditLine)
                    : null
                }
              >
                <p className="eyebrow">
                  Discount
                </p>
                <p className="mt-0.5 text-xl font-semibold text-slate-900 tabular-nums">
                  {inr(displayEditLine?.discountAmount ?? 0)}
                </p>
              </button>
              <button
                className={`rounded-md border px-3 py-3 text-left transition-colors ${editField === "PRICE" ? "border-brand-600 bg-brand-50 ring-1 ring-brand-600" : "border-slate-200 bg-white hover:bg-slate-50"}`}
                onClick={() =>
                  displayEditLine
                    ? editor.selectField("PRICE", displayEditLine)
                    : null
                }
              >
                <p className="eyebrow">
                  Price / Unit
                </p>
                <p className="mt-0.5 text-xl font-semibold text-slate-900 tabular-nums">
                  {inr(displayEditLine?.rate ?? 0)}
                </p>
              </button>
            </div>

            <div className="mt-6 rounded-md border border-slate-200 bg-white p-4 shadow-xs">
              <p className="eyebrow">
                Editing
              </p>
              <div className="mt-2 flex items-end justify-between">
                <div>
                  <p className="text-sm text-slate-500">
                    {editField === "QTY"
                      ? "Quantity"
                      : editField === "PRICE"
                        ? "Unit Price"
                        : discountMode === "PERCENT"
                          ? "Discount (%)"
                          : "Discount Amount"}
                  </p>
                  <p className="text-5xl font-semibold tracking-tight text-slate-900 tabular-nums">
                    {editValue}
                    {editField === "DISCOUNT" && discountMode === "PERCENT"
                      ? "%"
                      : ""}
                  </p>
                </div>
                <div className="text-right">
                  <p className="eyebrow">
                    Line Total
                  </p>
                  <p className="text-2xl font-semibold text-slate-900 tabular-nums">
                    {inr(
                      computeLineAmounts(displayEditLine ?? activeEditLine, taxCalculationMode, chargeTax)
                        .net,
                    )}
                  </p>
                </div>
              </div>
              {editField === "DISCOUNT" ? (
                <p className="mt-2 text-xs text-slate-500">
                  {discountMode === "PERCENT"
                    ? "Press % to switch to amount."
                    : "Press % to switch to percentage."}
                </p>
              ) : null}
            </div>
          </div>

          <div className="space-y-2 p-6">
            <div className="grid grid-cols-4 gap-2">
              {[
                "1",
                "2",
                "3",
                "QTY",
                "4",
                "5",
                "6",
                "%",
                "7",
                "8",
                "9",
                "PRICE",
                "+/-",
                "0",
                ".",
                "<",
              ].map((key) => (
                <button
                  key={key}
                  className={`h-14 rounded-md border text-xl font-semibold tabular-nums transition-colors active:scale-[0.97] ${
                    key === "QTY" || key === "PRICE" || key === "%"
                      ? "border-brand-200 bg-brand-50 text-base text-brand-700 hover:bg-brand-100"
                      : "border-slate-200 bg-white text-slate-800 hover:bg-slate-50"
                  }`}
                  onClick={() => editor.press(key)}
                >
                  {key}
                </button>
              ))}

              <button
                className="btn-primary col-span-3 h-14 text-base"
                onClick={editor.apply}
              >
                Apply
              </button>
              <button
                className="btn-secondary col-span-1 h-14 text-base"
                onClick={() => editor.press("C")}
              >
                Clear
              </button>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <button
                className="btn-secondary h-12 text-base"
                onClick={editor.close}
              >
                Back
              </button>
              <button
                className="btn-danger h-12 text-base"
                onClick={editor.remove}
              >
                Remove Item
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
