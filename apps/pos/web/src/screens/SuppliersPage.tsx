import { useState } from "react";
import { BranchPicker } from "../components/BranchPicker";
import { useManagedBranch } from "../lib/branch";
import { can } from "../lib/session";
import { inr, requireManagementSession } from "./route-helpers";
import { SupplierAccount } from "./suppliers/SupplierAccount";
import { SupplierForm } from "./suppliers/SupplierForm";
import { SupplierPaymentForm } from "./suppliers/SupplierPaymentForm";
import { useSuppliers } from "./suppliers/useSuppliers";

/**
 * Suppliers and what is owed to them: purchases add to it, goods sent back and payments take it
 * off, the oldest bills paid first. Recording purchases lets a user add and change suppliers;
 * paying them needs its own permission.
 */
export function SuppliersPage() {
  const session = requireManagementSession();
  const [managedBranch, setManagedBranch] = useManagedBranch();
  const branchId = managedBranch ?? "";
  const [includeInactive, setIncludeInactive] = useState(false);
  const [search, setSearch] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [mode, setMode] = useState<"account" | "edit" | "new">("account");
  const suppliers = useSuppliers(includeInactive);
  const mayEdit = can(session, "RECORD_PURCHASES");
  const mayPay = can(session, "PAY_SUPPLIERS");

  const needle = search.trim().toLowerCase();
  const shown = (suppliers.data ?? []).filter((supplier) => !needle || supplier.name.toLowerCase().includes(needle) || (supplier.gstin ?? "").toLowerCase().includes(needle));
  const selected = (suppliers.data ?? []).find((supplier) => supplier.id === selectedId) ?? null;
  const totalOwed = (suppliers.data ?? []).reduce((sum, supplier) => sum + Math.max(0, supplier.balance), 0);

  return (
    <section className="grid gap-6 p-6 lg:grid-cols-[22rem_1fr]">
      <div className="card overflow-hidden">
        <div className="space-y-3 border-b border-slate-200 p-4">
          <div className="flex items-center justify-between gap-2">
            <div>
              <h2 className="page-title">Suppliers</h2>
              <p className="text-xs text-slate-500">Owed in all: {inr(totalOwed)}</p>
            </div>
            {mayEdit ? (
              <button
                type="button"
                className="btn-primary text-xs"
                data-tour="suppliers-new"
                onClick={() => {
                  setSelectedId(null);
                  setMode("new");
                }}
              >
                New Supplier
              </button>
            ) : null}
          </div>
          <input className="field" data-tour="suppliers-search" placeholder="Search by name or GSTIN" value={search} onChange={(e) => setSearch(e.target.value)} />
          <label className="flex items-center gap-2 text-xs text-slate-600">
            <input type="checkbox" checked={includeInactive} onChange={(e) => setIncludeInactive(e.target.checked)} />
            Show suppliers no longer used
          </label>
        </div>
        {suppliers.isLoading ? (
          <p className="p-4 text-sm text-slate-500">Loading suppliers...</p>
        ) : shown.length === 0 ? (
          <p className="p-4 text-sm text-slate-500">No suppliers{needle ? " match" : " yet. They are added here, or when a purchase is recorded"}.</p>
        ) : (
          <ul className="max-h-[70vh] divide-y divide-slate-100 overflow-y-auto" data-tour="suppliers-list">
            {shown.map((supplier) => (
              <li key={supplier.id}>
                <button
                  type="button"
                  className={`flex w-full items-center justify-between gap-3 px-4 py-3 text-left ${supplier.id === selectedId ? "bg-brand-50" : "hover:bg-slate-50"}`}
                  onClick={() => {
                    setSelectedId(supplier.id);
                    setMode("account");
                  }}
                >
                  <div className="min-w-0">
                    <p className={`truncate text-sm font-semibold ${supplier.isActive ? "text-slate-900" : "text-slate-400"}`}>{supplier.name}</p>
                    <p className="truncate text-xs text-slate-500">{supplier.gstin ?? "No GSTIN"}</p>
                  </div>
                  <div className="text-right text-sm tabular-nums">
                    <p className="font-semibold text-slate-900">{inr(supplier.balance)}</p>
                    {supplier.overdue > 0 ? <p className="text-xs font-semibold text-rose-700">{inr(supplier.overdue)} overdue</p> : null}
                  </div>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="space-y-6" data-tour="suppliers-account">
        {mode === "new" ? (
          <div className="card p-5">
            <h3 className="mb-4 text-sm font-semibold text-slate-900">New supplier</h3>
            <SupplierForm
              supplier={null}
              onSaved={(saved) => {
                setSelectedId(saved.id);
                setMode("account");
              }}
              onCancel={() => setMode("account")}
            />
          </div>
        ) : !selected ? (
          <div className="card p-5 text-sm text-slate-500">Choose a supplier to see what is owed to them.</div>
        ) : (
          <>
            <div className="card p-5">
              <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h3 className="text-lg font-semibold text-slate-900">{selected.name}</h3>
                  <p className="text-xs text-slate-500">
                    {[selected.gstin ? `GSTIN ${selected.gstin}` : null, selected.phone, selected.email, selected.address].filter(Boolean).join(" · ") || "No contact details"}
                  </p>
                </div>
                {mayEdit ? (
                  <button type="button" className="btn-ghost text-xs" onClick={() => setMode(mode === "edit" ? "account" : "edit")}>
                    {mode === "edit" ? "Back to account" : "Edit details"}
                  </button>
                ) : null}
              </div>
              {mode === "edit" ? (
                <SupplierForm key={selected.id} supplier={selected} onSaved={() => setMode("account")} onCancel={() => setMode("account")} />
              ) : (
                <SupplierAccount supplierId={selected.id} />
              )}
            </div>
            {mayPay && mode === "account" ? (
              <div className="card p-5">
                <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
                  <h3 className="text-sm font-semibold text-slate-900">Pay {selected.name}</h3>
                  <BranchPicker value={branchId} onChange={setManagedBranch} />
                </div>
                <SupplierPaymentForm key={selected.id} supplier={selected} branchId={branchId} />
              </div>
            ) : null}
          </>
        )}
      </div>
    </section>
  );
}
