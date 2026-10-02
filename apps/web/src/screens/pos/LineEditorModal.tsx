import { useEffect, useRef } from "react";
import { money } from "../route-helpers";
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
    <div className="fixed inset-0 z-40 grid place-items-center bg-slate-900/40 p-4">
      <div className="w-full max-w-5xl overflow-hidden rounded-xl border border-slate-300 bg-white shadow-2xl">
        <div className="grid grid-cols-1 lg:grid-cols-[1fr_420px]">
          <div className="border-r border-slate-200 bg-slate-50 p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-2xl font-semibold text-slate-900">
                  {displayEditLine?.name}
                </p>
                <p className="text-sm text-slate-500">
                  Item ID: {displayEditLine?.itemId}
                </p>
              </div>
            </div>

            <div className="mt-4 grid gap-3 sm:grid-cols-3">
              <button
                className={`rounded border px-3 py-3 text-left ${editField === "QTY" ? "border-emerald-400 bg-emerald-50" : "border-slate-200 bg-white"}`}
                onClick={() =>
                  displayEditLine
                    ? editor.selectField("QTY", displayEditLine)
                    : null
                }
              >
                <p className="text-xs uppercase tracking-wide text-slate-500">
                  Qty
                </p>
                <p className="text-2xl font-semibold text-slate-800">
                  {displayEditLine
                    ? displayEditLine.saleUom
                      ? `${displayEditLine.saleUomQty ?? 1} ${displayEditLine.saleUom}`
                      : formatQty(displayEditLine.qty, displayEditLine.leastCount)
                    : "0"}
                </p>
              </button>
              <button
                className={`rounded border px-3 py-3 text-left ${editField === "DISCOUNT" ? "border-amber-400 bg-amber-50" : "border-slate-200 bg-white"}`}
                onClick={() =>
                  displayEditLine
                    ? editor.selectField("DISCOUNT", displayEditLine)
                    : null
                }
              >
                <p className="text-xs uppercase tracking-wide text-slate-500">
                  Discount
                </p>
                <p className="text-2xl font-semibold text-slate-800">
                  ₹ {money(displayEditLine?.discountAmount ?? 0)}
                </p>
              </button>
              <button
                className={`rounded border px-3 py-3 text-left ${editField === "PRICE" ? "border-indigo-400 bg-indigo-50" : "border-slate-200 bg-white"}`}
                onClick={() =>
                  displayEditLine
                    ? editor.selectField("PRICE", displayEditLine)
                    : null
                }
              >
                <p className="text-xs uppercase tracking-wide text-slate-500">
                  Price / Unit
                </p>
                <p className="text-2xl font-semibold text-slate-800">
                  ₹ {money(displayEditLine?.rate ?? 0)}
                </p>
              </button>
            </div>

            <div className="mt-6 rounded-lg border border-slate-200 bg-white p-4">
              <p className="text-xs uppercase tracking-wide text-slate-500">
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
                  <p className="text-5xl font-semibold text-slate-900">
                    {editValue}
                    {editField === "DISCOUNT" && discountMode === "PERCENT"
                      ? "%"
                      : ""}
                  </p>
                </div>
                <div className="text-right">
                  <p className="text-xs uppercase tracking-wide text-slate-500">
                    Line Total
                  </p>
                  <p className="text-3xl font-semibold text-slate-800">
                    ₹{" "}
                    {money(
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

          <div className="bg-slate-900 p-4 space-y-2">
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
                  className={`rounded px-2 py-4 text-xl font-semibold ${
                    key === "QTY" || key === "PRICE" || key === "%"
                      ? "bg-slate-700 text-white"
                      : key === "<"
                        ? "bg-rose-500 text-white"
                        : "bg-slate-100 text-slate-900"
                  }`}
                  onClick={() => editor.press(key)}
                >
                  {key}
                </button>
              ))}

              <button
                className="col-span-3 rounded bg-emerald-600 px-4 py-3 text-base font-semibold text-white"
                onClick={editor.apply}
              >
                Apply
              </button>
              <button
                className="col-span-1 rounded bg-amber-200 px-2 py-4 text-xl font-semibold text-amber-900"
                onClick={() => editor.press("C")}
              >
                Clear
              </button>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <button
                className="rounded bg-slate-200 px-2 py-4 text-xl font-semibold text-slate-800"
                onClick={editor.close}
              >
                Back
              </button>
              <button
                className="rounded bg-rose-200 px-4 py-3 text-base font-semibold text-rose-800"
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
