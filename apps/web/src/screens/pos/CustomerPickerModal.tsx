import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { api, authHeaders } from "../../lib/api";

type PickerCustomer = { id: string; name: string | null; phone: string | null; code: string };

/**
 * Finds a customer by name or phone, or creates one when nothing matches. Its search and
 * form start empty each time it opens.
 */
export function CustomerPickerModal({
  branchId,
  customers,
  onSelect,
  onClose,
}: {
  branchId: string;
  customers: PickerCustomer[];
  onSelect: (customerId: string) => void;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const [searchQuery, setSearchQuery] = useState("");
  const [newPhone, setNewPhone] = useState("");
  const [newName, setNewName] = useState("");
  const [error, setError] = useState("");

  const matchingCustomers = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return [];
    return customers.filter((c) => {
      const name = (c.name ?? "").toLowerCase();
      const phone = (c.phone ?? "").toLowerCase();
      return name.includes(q) || phone.includes(q);
    });
  }, [customers, searchQuery]);

  const createCustomer = useMutation({
    mutationFn: async () => {
      const phone = newPhone.trim();
      const name = newName.trim() || `Customer ${phone}`;
      if (!phone) throw new Error("Phone number is required");

      const res = await api.customers.create({
        body: { branchId, name, phone },
        extraHeaders: authHeaders(),
      });
      if (res.status !== 201) throw new Error("Failed to create customer");
      return res.body;
    },
    onSuccess: (customer) => {
      queryClient.invalidateQueries({ queryKey: ["customers-pos", branchId] });
      onSelect(customer.id);
    },
    onError: (err) => {
      setError((err as Error).message);
    },
  });

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-slate-900/40 p-4">
      <div className="w-full max-w-xl rounded-xl border border-slate-300 bg-white p-4 shadow-2xl">
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-xl font-semibold text-slate-900">Select or Create Customer</h3>
          <button className="rounded bg-slate-200 px-2 py-1 text-sm text-slate-700" onClick={onClose}>
            Close
          </button>
        </div>

        <label className="text-sm text-slate-600">Search Customer by Name or Phone</label>
        <input
          className="mt-1 w-full rounded border border-slate-300 px-3 py-2"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder="Enter customer name or phone"
        />

        <div className="mt-3 max-h-52 space-y-2 overflow-auto rounded border border-slate-200 p-2">
          {matchingCustomers.length === 0 ? (
            <p className="text-sm text-slate-500">No matching customer found.</p>
          ) : null}
          {matchingCustomers.map((c) => (
            <button
              key={c.id}
              className="w-full rounded border border-slate-200 bg-slate-50 px-3 py-2 text-left hover:bg-slate-100"
              onClick={() => onSelect(c.id)}
            >
              <p className="font-semibold text-slate-800">{c.name}</p>
              <p className="text-xs text-slate-500">
                {c.phone ?? "No phone"} | {c.code}
              </p>
            </button>
          ))}
        </div>

        {searchQuery.trim() && matchingCustomers.length === 0 ? (
          <div className="mt-3 rounded border border-emerald-200 bg-emerald-50 p-3">
            <p className="text-sm font-semibold text-emerald-800">Create new customer</p>
            <input
              className="mt-2 w-full rounded border border-slate-300 px-3 py-2"
              value={newPhone}
              onChange={(e) => setNewPhone(e.target.value)}
              placeholder="Customer phone number"
            />
            <input
              className="mt-2 w-full rounded border border-slate-300 px-3 py-2"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="Customer name (optional)"
            />
            <button
              className="mt-2 rounded bg-emerald-600 px-3 py-2 text-sm font-semibold text-white"
              onClick={() => createCustomer.mutate()}
              disabled={createCustomer.isPending}
            >
              Create Customer
            </button>
          </div>
        ) : null}

        {error ? <p className="mt-2 text-sm text-red-700">{error}</p> : null}
      </div>
    </div>
  );
}
