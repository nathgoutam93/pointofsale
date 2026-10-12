import { formatDateTime, MOVEMENT_LABELS } from "./stockFormat";
import type { LedgerEntry } from "./types";

/** Every stock movement of the selected item, newest first, with older ones loaded on request. */
export function MovementsCard({
  ledger,
  ledgerPages,
}: {
  ledger: { data?: LedgerEntry[]; isLoading: boolean };
  ledgerPages: { hasNextPage: boolean; isFetchingNextPage: boolean; fetchNextPage: () => Promise<unknown> };
}) {
  return (
    <div className="card p-5">
      <h3 className="text-sm font-semibold text-slate-900">
        All Movements
      </h3>
      {ledger.isLoading && (
        <p className="mt-2 text-sm text-slate-500">Loading history...</p>
      )}
      {(ledger.data ?? []).length === 0 && !ledger.isLoading && (
        <p className="mt-2 text-sm text-slate-500">No stock movements yet.</p>
      )}
      {(ledger.data ?? []).length > 0 && (
        <div className="mt-3 overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="eyebrow border-b border-slate-200 text-left">
                <th className="py-2">Date</th>
                <th className="py-2">Movement</th>
                <th className="py-2 text-right">In</th>
                <th className="py-2 text-right">Out</th>
                <th className="py-2 pl-4">Details</th>
              </tr>
            </thead>
            <tbody>
              {(ledger.data ?? []).map((entry) => (
                <tr className="border-b border-slate-100" key={entry.id}>
                  <td className="py-2 pr-2">{formatDateTime(entry.createdAt)}</td>
                  <td className="py-2 pr-2">{MOVEMENT_LABELS[entry.txnType] ?? entry.txnType}</td>
                  <td className="py-2 pr-2 text-right tabular-nums">{Number(entry.qtyIn) || ""}</td>
                  <td className="py-2 pr-2 text-right tabular-nums">{Number(entry.qtyOut) || ""}</td>
                  <td className="py-2 pl-4 text-slate-600">{entry.reason || "-"}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {ledgerPages.hasNextPage ? (
            <button
              type="button"
              className="btn-secondary mt-3"
              disabled={ledgerPages.isFetchingNextPage}
              onClick={() => void ledgerPages.fetchNextPage()}
            >
              {ledgerPages.isFetchingNextPage ? "Loading…" : "Load older movements"}
            </button>
          ) : null}
        </div>
      )}
    </div>
  );
}
