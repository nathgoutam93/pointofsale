import { Link } from "@tanstack/react-router";
import type { Dispatch, SetStateAction } from "react";
import { gstStateLabel } from "@pos/contracts";
import { BuyerFields, buyerFrom, buyerProblem, type BuyerDetails } from "../../components/BuyerFields";
import { CreditFields, creditFrom, creditProblem, type CreditDetails } from "../../components/CreditFields";
import { inr } from "../route-helpers";
import type { AccountSummary, Customer, Wallet } from "./types";

/** The selected customer: their details (edited in place), what they owe, their wallet and their credit terms. */
export function CustomerCard({
  selectedCustomer,
  isAdmin,
  isEditingCustomer,
  setIsEditingCustomer,
  editName,
  setEditName,
  editPhone,
  setEditPhone,
  editBuyer,
  setEditBuyer,
  editCredit,
  setEditCredit,
  hasCustomerEdits,
  updateCustomer,
  sales,
  pendingInvoiceSummary,
  account,
  customerWallet,
  showStatement,
  setShowStatement,
}: {
  selectedCustomer: Customer;
  isAdmin: boolean;
  isEditingCustomer: boolean;
  setIsEditingCustomer: (editing: boolean) => void;
  editName: string;
  setEditName: (name: string) => void;
  editPhone: string;
  setEditPhone: (phone: string) => void;
  editBuyer: BuyerDetails;
  setEditBuyer: (buyer: BuyerDetails) => void;
  editCredit: CreditDetails;
  setEditCredit: (credit: CreditDetails) => void;
  hasCustomerEdits: boolean;
  updateCustomer: { mutate: () => void; isPending: boolean; isError: boolean; error: Error | null };
  sales: { isLoading: boolean };
  pendingInvoiceSummary: { count: number; total: number };
  account: { data?: AccountSummary; isLoading: boolean };
  customerWallet: { data?: Wallet; isLoading: boolean };
  showStatement: boolean;
  setShowStatement: Dispatch<SetStateAction<boolean>>;
}) {
  return (
    <div className="card print:hidden">
      <div className="flex flex-wrap items-start justify-between gap-4 border-b border-slate-200 p-5">
        <div className="flex min-w-0 items-center gap-4">
          <div className="grid h-12 w-12 shrink-0 place-items-center rounded-full bg-brand-100 text-base font-semibold text-brand-700">
            {selectedCustomer.name.trim().slice(0, 1).toUpperCase() || "?"}
          </div>
          <div className="min-w-0">
            {isEditingCustomer ? (
              <div className="grid gap-2 sm:grid-cols-2">
                <div>
                  <label className="field-label">Name</label>
                  <input
                    className="field"
                    value={editName}
                    onChange={(e) => setEditName(e.target.value)}
                  />
                </div>
                <div>
                  <label className="field-label">Phone</label>
                  <input
                    className="field"
                    placeholder="Phone (optional)"
                    value={editPhone}
                    onChange={(e) => setEditPhone(e.target.value)}
                  />
                </div>
                <div className="sm:col-span-2">
                  <label className="field-label">GST and billing</label>
                  <BuyerFields value={editBuyer} onChange={setEditBuyer} />
                </div>
                {isAdmin ? (
                  <div className="sm:col-span-2">
                    <label className="field-label">Credit</label>
                    <CreditFields value={editCredit} onChange={setEditCredit} />
                  </div>
                ) : null}
                {updateCustomer.isError ? (
                  <p className="text-xs text-rose-700 sm:col-span-2">{(updateCustomer.error as Error).message}</p>
                ) : null}
              </div>
            ) : (
              <>
                <h2 className="truncate text-xl font-semibold tracking-tight text-slate-900">
                  {selectedCustomer.name}
                </h2>
                <p className="mt-0.5 text-sm text-slate-500">
                  <span>{selectedCustomer.code}</span> ·{" "}
                  {selectedCustomer.phone ?? "No phone"}
                  {selectedCustomer.email ? ` · ${selectedCustomer.email}` : ""}
                </p>
                {selectedCustomer.gstin ? (
                  <p className="mt-1 text-sm text-slate-600">
                    <span className="badge bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200 ring-inset">Registered buyer</span>{" "}
                    GSTIN <span className="font-mono font-semibold text-slate-800">{selectedCustomer.gstin}</span> ·{" "}
                    {gstStateLabel(selectedCustomer.gstin.slice(0, 2))}
                  </p>
                ) : null}
                {selectedCustomer.address ? (
                  <p className="mt-0.5 whitespace-pre-line text-sm text-slate-500">{selectedCustomer.address}</p>
                ) : null}
              </>
            )}
          </div>
        </div>
        {selectedCustomer.isWalkIn ? (
          <span className="badge bg-slate-100 text-slate-600">Walk-in · not editable</span>
        ) : isEditingCustomer ? (
          <div className="flex gap-2">
            <button
              className="btn-secondary"
              onClick={() => {
                setIsEditingCustomer(false);
                setEditName(selectedCustomer.name);
                setEditPhone(selectedCustomer.phone ?? "");
                setEditBuyer(buyerFrom(selectedCustomer));
                setEditCredit(creditFrom(selectedCustomer));
              }}
              type="button"
            >
              Cancel
            </button>
            <button
              className="btn-primary"
              disabled={
                updateCustomer.isPending ||
                !editName.trim() ||
                !hasCustomerEdits ||
                !!buyerProblem(editBuyer) ||
                !!creditProblem(editCredit)
              }
              onClick={() => updateCustomer.mutate()}
              type="button"
            >
              {updateCustomer.isPending ? "Saving..." : "Save"}
            </button>
          </div>
        ) : (
          <button
            className="btn-secondary"
            onClick={() => setIsEditingCustomer(true)}
            type="button"
          >
            Edit Customer
          </button>
        )}
      </div>
      <dl className="grid grid-cols-2 divide-slate-200 md:grid-cols-4 md:divide-x">
        <div className="p-5">
          <dt className="eyebrow">Pending invoices</dt>
          <dd className="mt-1 flex items-center gap-2">
            <span className="text-xl font-semibold text-slate-900 tabular-nums">
              {sales.isLoading ? "…" : pendingInvoiceSummary.count}
            </span>
            {!sales.isLoading && pendingInvoiceSummary.count > 0 ? (
              <Link
                className="text-xs font-semibold text-brand-600 hover:text-brand-700 hover:underline"
                search={{
                  customerId: selectedCustomer.id,
                  paymentFilter: "PENDING",
                }}
                to="/sales"
              >
                View →
              </Link>
            ) : null}
          </dd>
        </div>
        <div className="p-5">
          <dt className="eyebrow">Amount due</dt>
          <dd className={`mt-1 text-xl font-semibold tabular-nums ${(account.data?.outstanding ?? 0) > 0 ? "text-amber-700" : "text-slate-900"}`}>
            {account.isLoading ? "…" : inr(account.data?.outstanding ?? 0)}
          </dd>
          {account.data && account.data.overdue > 0 ? (
            <dd className="mt-0.5 text-xs font-medium text-rose-700 tabular-nums">
              {inr(account.data.overdue)} overdue ({account.data.overdueBills} {account.data.overdueBills === 1 ? "bill" : "bills"})
            </dd>
          ) : null}
        </div>
        <div className="p-5">
          <dt className="eyebrow">Wallet balance</dt>
          <dd className="mt-1 text-xl font-semibold text-slate-900 tabular-nums">
            {customerWallet.isLoading ? "…" : inr(customerWallet.data?.balance ?? 0)}
          </dd>
        </div>
        <div className="p-5">
          <dt className="eyebrow">Customer since</dt>
          <dd className="mt-1 text-sm font-medium text-slate-900">
            {new Date(selectedCustomer.createdAt).toLocaleString()}
          </dd>
        </div>
      </dl>
      {!selectedCustomer.isWalkIn ? (
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-200 px-5 py-3 text-sm">
          <p className="text-slate-600">
            {account.data?.creditLimit != null ? (
              <>
                Credit limit <span className="font-semibold text-slate-900 tabular-nums">{inr(account.data.creditLimit)}</span>
                {" · "}
                <span className={account.data.available === 0 ? "font-semibold text-rose-700" : ""}>
                  {inr(account.data.available ?? 0)} available
                </span>
              </>
            ) : (
              "No credit limit"
            )}
            {" · "}
            {selectedCustomer.paymentTermsDays != null
              ? `Pay within ${selectedCustomer.paymentTermsDays} ${selectedCustomer.paymentTermsDays === 1 ? "day" : "days"}`
              : "No payment terms"}
          </p>
          <button className="btn-secondary" type="button" onClick={() => setShowStatement((prev) => !prev)}>
            {showStatement ? "Hide statement" : "Statement"}
          </button>
        </div>
      ) : null}
    </div>
  );
}
