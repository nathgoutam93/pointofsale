import { Link } from "@tanstack/react-router";
import { BranchPicker } from "../../components/BranchPicker";
import type { PaymentFilter } from "./types";

// Every status, not just those on the loaded page: the filter runs on the server.
const statusOptions = ["ALL", "CANCELLED", "DRAFT", "PARTIALLY_SETTLED", "SETTLED"];

/** The bills list's counts, branch, search and filters, and the customer it is narrowed to. */
export function SalesFilters({
  pendingCount,
  invoiceCount,
  branchId,
  onBranchChange,
  searchQuery,
  setSearchQuery,
  statusFilter,
  setStatusFilter,
  paymentFilter,
  setPaymentFilter,
  linkedCustomerId,
  linkedCustomer,
  hasNextPage,
}: {
  /** How many of the bills shown still have money owed. */
  pendingCount: number;
  invoiceCount: number;
  branchId: string;
  onBranchChange: (branchId: string) => void;
  searchQuery: string;
  setSearchQuery: (query: string) => void;
  statusFilter: string;
  setStatusFilter: (status: string) => void;
  paymentFilter: PaymentFilter;
  setPaymentFilter: (filter: PaymentFilter) => void;
  /** The customer the list is narrowed to (from the URL), or "". */
  linkedCustomerId: string;
  linkedCustomer: { name: string } | null;
  /** Whether older bills are still to load. */
  hasNextPage: boolean;
}) {
  return (
    <div className="border-b border-slate-200 p-4">
      <div className="grid grid-cols-2 gap-2">
        <div className="rounded-md border border-slate-200 px-3 py-2">
          <p className="eyebrow">Pending</p>
          <p className="mt-0.5 text-lg font-semibold text-amber-700 tabular-nums">
            {pendingCount}
          </p>
        </div>
        <div className="rounded-md border border-slate-200 px-3 py-2">
          <p className="eyebrow">Invoices</p>
          <p className="mt-0.5 text-lg font-semibold text-slate-900 tabular-nums">
            {invoiceCount}
          </p>
        </div>
      </div>
      <div className="mt-3 grid gap-2 text-sm">
        <BranchPicker
          className=""
          value={branchId}
          onChange={onBranchChange}
        />
        <input
          className="field"
          placeholder="Search by invoice, customer, status, or staff"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
        />
        <div className="grid grid-cols-2 gap-2">
          <select
            className="field"
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
          >
            {statusOptions.map((status) => (
              <option key={status} value={status}>
                {status === "ALL" ? "All Statuses" : status}
              </option>
            ))}
          </select>
          <select
            className="field"
            value={paymentFilter}
            onChange={(e) =>
              setPaymentFilter(e.target.value as PaymentFilter)
            }
          >
            <option value="ALL">All Payments</option>
            <option value="PENDING">Pending Only</option>
            <option value="SETTLED">Settled Only</option>
          </select>
        </div>
        {linkedCustomerId ? (
          <div className="flex items-center justify-between gap-2 rounded border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
            <span className="min-w-0 truncate">
              Customer:{" "}
              <span className="font-semibold">
                {linkedCustomer?.name ?? "Selected customer"}
              </span>
            </span>
            <Link
              className="shrink-0 font-semibold text-amber-900 underline-offset-2 hover:underline"
              search={{
                paymentFilter:
                  paymentFilter === "ALL" ? undefined : paymentFilter,
                q: searchQuery.trim() || undefined,
                status: statusFilter === "ALL" ? undefined : statusFilter,
              }}
              to="/sales"
            >
              Clear
            </Link>
          </div>
        ) : null}
        <p className="text-xs text-slate-500">
          Showing {invoiceCount}
          {hasNextPage ? " (newest first)" : ""}
        </p>
      </div>
    </div>
  );
}
