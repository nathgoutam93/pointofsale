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
    <div className="modal-backdrop z-50">
      <div className="max-h-[calc(100vh-2rem)] w-full max-w-xl overflow-y-auto rounded-xl border border-slate-200 bg-white p-5 shadow-2xl">
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-lg font-semibold text-slate-900">Select customer</h3>
          <button className="btn-ghost px-2.5 py-1" onClick={onClose}>
            Close
          </button>
        </div>

        <label className="field-label">Search by name or phone</label>
        <input
          className="field mt-1"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder="Enter customer name or phone"
        />

        <div className="mt-3 max-h-64 space-y-2 overflow-auto rounded-md border border-slate-200 bg-slate-50 p-2">
          {matchingCustomers.length === 0 ? (
            <p className="text-sm text-slate-500">No matching customer found.</p>
          ) : null}
          {matchingCustomers.map((c) => (
            <button
              key={c.id}
              className="list-row"
              onClick={() => onSelect(c.id)}
            >
              <p className="text-sm font-semibold text-slate-900">{c.name}</p>
              <p className="text-xs text-slate-500">
                {c.phone ?? "No phone"} · {c.code}
              </p>
            </button>
          ))}
        </div>

        {searchQuery.trim() && matchingCustomers.length === 0 ? (
          <div className="mt-3 rounded-md border border-slate-200 p-4">
            <p className="text-sm font-semibold text-slate-900">Create new customer</p>
            <input
              className="field mt-2"
              value={newPhone}
              onChange={(e) => setNewPhone(e.target.value)}
              placeholder="Customer phone number"
            />
            <input
              className="field mt-2"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="Customer name (optional)"
            />
            <button
              className="btn-primary mt-2"
              onClick={() => createCustomer.mutate()}
              disabled={createCustomer.isPending}
            >
              Create Customer
            </button>
          </div>
        ) : null}

        {error ? <p className="mt-3 rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700" role="alert">{error}</p> : null}
      </div>
    </div>
  );
}
