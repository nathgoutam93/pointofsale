import { IconPlus } from "../../components/icons";
import { inr } from "../route-helpers";
import { formatDraftSavedAt, formatQty } from "./cartMath";
import type { LocalSaleDraft } from "./types";

/** Between orders: New Order and the cashier's saved draft carts. */
export function DraftList({
  drafts,
  onNewOrder,
  onResume,
  onDelete,
}: {
  drafts: LocalSaleDraft[];
  onNewOrder: () => void;
  onResume: (draft: LocalSaleDraft) => void;
  onDelete: (draftId: string) => void;
}) {
  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <div className="border-b border-slate-200 p-4">
        <button className="btn-primary h-14 w-full text-lg" onClick={onNewOrder}>
          <IconPlus width={20} height={20} />
          New Order
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-4">
        <div className="mb-3 flex items-center justify-between">
          <p className="eyebrow">Held orders</p>
          <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-600">
            {drafts.length}
          </span>
        </div>

        {drafts.length === 0 ? (
          <div className="rounded-lg border border-dashed border-slate-300 bg-slate-50 px-4 py-8 text-center">
            <p className="text-sm font-medium text-slate-600">No held orders</p>
            <p className="mt-1 text-xs text-slate-500">Orders you leave unfinished are kept here on this device.</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-1">
            {drafts.map((draft) => (
              <div key={draft.id} className="card p-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold text-slate-900">{draft.customerName}</p>
                    <p className="mt-0.5 text-xs text-slate-500">
                      {formatDraftSavedAt(draft.savedAt)} · {formatQty(draft.totalItems, 1)} items
                    </p>
                  </div>
                  <span className="text-sm font-semibold whitespace-nowrap text-slate-900 tabular-nums">
                    {inr(draft.total)}
                  </span>
                </div>
                <div className="mt-3 flex gap-2">
                  <button className="btn-primary flex-1 py-1.5" onClick={() => onResume(draft)}>
                    Resume
                  </button>
                  <button className="btn-danger py-1.5" onClick={() => onDelete(draft.id)}>
                    Discard
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
