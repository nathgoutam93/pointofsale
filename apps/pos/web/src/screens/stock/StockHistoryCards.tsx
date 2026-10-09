import { costLabel } from "../route-helpers";
import { formatDateTime } from "./stockFormat";
import type { LedgerEntry } from "./types";

/** The selected item's opening stock entries and its adjustments, side by side. */
export function StockHistoryCards({
  ledger,
  openingHistory,
  openingEntry,
  adjustmentHistory,
  canChangeStock,
  openOpeningEditModal,
}: {
  ledger: { isLoading: boolean };
  openingHistory: LedgerEntry[];
  openingEntry: LedgerEntry | null;
  adjustmentHistory: LedgerEntry[];
  canChangeStock: boolean;
  openOpeningEditModal: () => void;
}) {
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <div className="card p-5">
        <div className="flex items-center justify-between gap-2">
          <h3 className="text-sm font-semibold text-slate-900">
            Opening History
          </h3>
          {openingEntry && canChangeStock && (
            <button
              type="button"
              className="btn-secondary px-2.5 py-1 text-xs"
              onClick={openOpeningEditModal}
            >
              Edit Opening
            </button>
          )}
        </div>
        {ledger.isLoading && (
          <p className="mt-2 text-sm text-slate-500">
            Loading history...
          </p>
        )}
        {openingHistory.length === 0 && !ledger.isLoading && (
          <p className="mt-2 text-sm text-slate-500">
            No opening entries found.
          </p>
        )}
        {openingHistory.length > 0 && (
          <div className="mt-3 overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="eyebrow border-b border-slate-200 text-left">
                  <th className="py-2">Date</th>
                  <th className="py-2">Qty</th>
                  <th className="py-2">Cost</th>
                  <th className="py-2">Reason</th>
                </tr>
              </thead>
              <tbody>
                {openingHistory.map((entry) => (
                  <tr
                    className="border-b border-slate-100"
                    key={entry.id}
                  >
                    <td className="py-2 pr-2">
                      {formatDateTime(entry.createdAt)}
                    </td>
                    <td className="py-2 pr-2">{entry.qtyIn}</td>
                    <td className="py-2 pr-2">
                      {costLabel(entry.costPrice)}
                    </td>
                    <td className="py-2">{entry.reason || "-"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="card p-5">
        <h3 className="text-sm font-semibold text-slate-900">
          Adjustment History
        </h3>
        {ledger.isLoading && (
          <p className="mt-2 text-sm text-slate-500">
            Loading history...
          </p>
        )}
        {adjustmentHistory.length === 0 && !ledger.isLoading && (
          <p className="mt-2 text-sm text-slate-500">
            No adjustment entries found.
          </p>
        )}
        {adjustmentHistory.length > 0 && (
          <div className="mt-3 overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="eyebrow border-b border-slate-200 text-left">
                  <th className="py-2">Date</th>
                  <th className="py-2">Type</th>
                  <th className="py-2">Qty</th>
                  <th className="py-2">Cost</th>
                  <th className="py-2">Reason</th>
                </tr>
              </thead>
              <tbody>
                {adjustmentHistory.map((entry) => (
                  <tr
                    className="border-b border-slate-100"
                    key={entry.id}
                  >
                    <td className="py-2 pr-2">
                      {formatDateTime(entry.createdAt)}
                    </td>
                    <td className="py-2 pr-2">
                      {entry.txnType === "ADJUSTMENT_PLUS" ? "IN" : "OUT"}
                    </td>
                    <td className="py-2 pr-2">
                      {entry.txnType === "ADJUSTMENT_PLUS"
                        ? entry.qtyIn
                        : entry.qtyOut}
                    </td>
                    <td className="py-2 pr-2">
                      {costLabel(entry.costPrice)}
                    </td>
                    <td className="py-2">{entry.reason || "-"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
