import { money } from "../route-helpers";
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
      <div className="border-b border-slate-200 p-3">
        <button
          className="w-full rounded bg-fuchsia-900 px-3 py-5 text-4xl font-semibold text-white"
          onClick={onNewOrder}
        >
          New Order
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-3">
        <div className="mb-3 flex items-center justify-between">
          <p className="text-lg font-semibold text-slate-900">
            Ongoing Draft Bills
          </p>
          <p className="text-sm text-slate-500">
            {drafts.length} saved
          </p>
        </div>

        {drafts.length === 0 ? (
          <div className="rounded border border-dashed border-slate-300 bg-slate-50 p-4 text-sm text-slate-500">
            No local drafts yet.
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-1">
            {drafts.map((draft) => (
              <div
                key={draft.id}
                className="rounded border border-amber-200 bg-amber-50 p-3"
              >
                <div className="min-w-0">
                  <p className="truncate text-base font-semibold text-slate-900">
                    {draft.customerName}
                  </p>
                  <p className="mt-1 text-xs text-slate-600">
                    {formatDraftSavedAt(draft.savedAt)}
                  </p>
                  <div className="mt-2 flex items-center justify-between text-sm">
                    <span className="text-slate-600">
                      {formatQty(draft.totalItems, 1)} items
                    </span>
                    <span className="font-semibold text-slate-900">
                      ₹ {money(draft.total)}
                    </span>
                  </div>
                </div>
                <div className="mt-3 grid grid-cols-2 gap-2">
                  <button
                    className="rounded bg-emerald-600 px-2 py-2 text-sm font-semibold text-white"
                    onClick={() => onResume(draft)}
                  >
                    Resume
                  </button>
                  <button
                    className="rounded bg-rose-100 px-2 py-2 text-sm font-semibold text-rose-700"
                    onClick={() => onDelete(draft.id)}
                  >
                    Delete
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
