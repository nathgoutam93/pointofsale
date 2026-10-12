import { inr } from "../route-helpers";
import type { Customer, OwedRow } from "./types";

/** The customer list: each one's code and phone, and what they owe. */
export function CustomerList({
  filteredCustomers,
  visibleCustomers,
  selectedCustomer,
  setSelectedCustomerId,
  setShowAgeing,
  owedByCustomerId,
}: {
  filteredCustomers: Customer[];
  visibleCustomers: Customer[];
  selectedCustomer: Customer | null;
  setSelectedCustomerId: (id: string | null) => void;
  setShowAgeing: (show: boolean) => void;
  owedByCustomerId: Map<string, OwedRow>;
}) {
  return (
    <div className="min-h-0 flex-1 space-y-2 overflow-y-auto bg-slate-50 p-3">
      {filteredCustomers.map((customer) => {
        const selected = selectedCustomer?.id === customer.id;
        const owed = owedByCustomerId.get(customer.id);
        return (
          <button
            className={`list-row ${selected ? "is-active" : ""}`}
            key={customer.id}
            onClick={() => {
              setSelectedCustomerId(customer.id);
              setShowAgeing(false);
            }}
            type="button"
          >
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold text-slate-900">
                  {customer.name}
                </p>
                <p className="truncate text-xs text-slate-500">
                  {customer.phone ?? "No phone"}
                </p>
              </div>
              <span className="badge bg-slate-100 font-medium tracking-normal text-slate-600 normal-case">
                {customer.code}
              </span>
            </div>
            {owed ? (
              <p className="mt-1.5 text-xs font-medium text-amber-700 tabular-nums">
                Due {inr(owed.total)}
                {owed.overdue > 0 ? (
                  <span className="ml-2 badge bg-rose-50 text-rose-700 ring-1 ring-rose-200 ring-inset">
                    {inr(owed.overdue)} overdue
                  </span>
                ) : null}
              </p>
            ) : null}
          </button>
        );
      })}

      {visibleCustomers.length === 0 ? (
        <p className="rounded-md border border-dashed border-slate-300 bg-white px-3 py-6 text-center text-sm text-slate-500">
          No customers found.
        </p>
      ) : null}

      {visibleCustomers.length &&
        filteredCustomers.length === 0 ? (
        <p className="rounded-md border border-dashed border-slate-300 bg-white px-3 py-6 text-center text-sm text-slate-500">
          No customers match that search.
        </p>
      ) : null}
    </div>
  );
}
