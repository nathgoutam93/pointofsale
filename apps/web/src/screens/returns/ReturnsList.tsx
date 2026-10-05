import { inr } from "../route-helpers";
import type { Returns } from "./useReturns";

/** The returns made at the branch, newest first, and New Return. */
export function ReturnsList({
  mayReturn,
  onNewReturn,
  returnsList,
  returnPages,
  createMode,
  selectedReturnId,
  onSelect,
}: {
  /** Cashiers need an admin's permission to take goods back. */
  mayReturn: boolean;
  onNewReturn: () => void;
  returnsList: Returns["returnsList"];
  returnPages: Returns["returnPages"];
  createMode: boolean;
  selectedReturnId: string;
  onSelect: (returnId: string) => void;
}) {
  return (
    <aside className="flex h-full max-h-[75vh] flex-col overflow-hidden border-r border-slate-200 bg-white xl:max-h-none">
      <div className="flex shrink-0 items-center justify-between gap-2 border-b border-slate-200 p-4">
        <h2 className="page-title">Returns</h2>
        <button
          type="button"
          className="btn-primary text-xs"
          disabled={!mayReturn}
          title={mayReturn ? undefined : "Ask an admin to allow you to make returns"}
          onClick={onNewReturn}
        >
          New Return
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto bg-slate-50 p-3">

      {returnsList.isLoading ? (
        <p className="text-sm text-slate-500">Loading returns...</p>
      ) : null}
      {(returnsList.data ?? []).length === 0 && !returnsList.isLoading ? (
        <div className="rounded-md border border-dashed border-slate-300 bg-white p-6 text-center text-sm text-slate-500">No returns yet.</div>
      ) : null}

      <div className="space-y-2">
        {(returnsList.data ?? []).map((row) => (
          <button
            key={row.id}
            type="button"
            className={`list-row ${!createMode && selectedReturnId === row.id ? "is-active" : ""}`}
            onClick={() => onSelect(row.id)}
          >
            <div className="flex items-start justify-between gap-2">
              <p className="truncate text-sm font-semibold text-slate-900">{row.returnNo}</p>
              <p className="text-sm font-semibold text-slate-900 tabular-nums">{inr(row.totalAmount)}</p>
            </div>
            <div className="mt-0.5 flex items-center justify-between gap-2 text-xs text-slate-500">
              <p className="truncate">
                {row.saleInvoiceNo} · {row.customerName}
              </p>
              <span className="badge bg-slate-100 text-slate-600">{Number(row.refundAmount) > 0 ? row.refundMode : "OFF DUE"}</span>
            </div>
          </button>
        ))}
        {returnPages.hasNextPage ? (
          <button
            type="button"
            className="btn-secondary w-full"
            disabled={returnPages.isFetchingNextPage}
            onClick={() => void returnPages.fetchNextPage()}
          >
            {returnPages.isFetchingNextPage ? "Loading…" : "Load older returns"}
          </button>
        ) : null}
      </div>
      </div>
    </aside>
  );
}
