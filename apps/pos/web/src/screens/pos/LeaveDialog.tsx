import { inr } from "../route-helpers";
import type { LeaveChoice } from "./types";

/** Asked before leaving the POS with a cart that hasn't been billed. */
export function LeaveDialog({ totalItems, total, onChoose }: { totalItems: number; total: number; onChoose: (choice: LeaveChoice) => void }) {
  return (
    <div className="modal-backdrop z-50 print:hidden">
      <div className="w-full max-w-sm rounded-xl border border-slate-200 bg-white p-5 shadow-2xl" role="dialog" aria-label="Unsaved cart">
        <h2 className="text-lg font-semibold text-slate-900">Leave POS?</h2>
        <p className="mt-2 text-sm text-slate-600">
          The current cart ({totalItems} items, {inr(total)}) hasn't been billed.
        </p>
        <div className="mt-5 grid gap-2">
          <button className="btn-primary" onClick={() => onChoose("save")}>
            Save draft and leave
          </button>
          <button className="btn-danger" onClick={() => onChoose("discard")}>
            Discard cart and leave
          </button>
          <button className="btn-secondary" onClick={() => onChoose("stay")}>
            Stay
          </button>
        </div>
      </div>
    </div>
  );
}
