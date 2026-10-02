import { money } from "../route-helpers";
import type { LeaveChoice } from "./types";

/** Asked before leaving the POS with a cart that hasn't been billed. */
export function LeaveDialog({ totalItems, total, onChoose }: { totalItems: number; total: number; onChoose: (choice: LeaveChoice) => void }) {
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-slate-900/50 p-4 print:hidden">
      <div className="w-full max-w-sm rounded-2xl bg-white p-5 shadow-xl" role="dialog" aria-label="Unsaved cart">
        <h2 className="text-lg font-semibold text-slate-900">Leave POS?</h2>
        <p className="mt-2 text-sm text-slate-600">
          The current cart ({totalItems} items, ₹ {money(total)}) hasn't been billed.
        </p>
        <div className="mt-5 grid gap-2">
          <button className="rounded-lg bg-slate-900 px-3 py-2 font-semibold text-white" onClick={() => onChoose("save")}>
            Save draft and leave
          </button>
          <button className="rounded-lg border border-rose-300 bg-rose-50 px-3 py-2 font-semibold text-rose-700" onClick={() => onChoose("discard")}>
            Discard cart and leave
          </button>
          <button className="rounded-lg border border-slate-300 px-3 py-2" onClick={() => onChoose("stay")}>
            Stay
          </button>
        </div>
      </div>
    </div>
  );
}
