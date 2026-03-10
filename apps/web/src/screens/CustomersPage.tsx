import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { api, authHeaders } from "../lib/api";
import { money, requireSession } from "./route-helpers";

export function CustomersPage() {
  const session = requireSession();
  const queryClient = useQueryClient();
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [selectedCustomerId, setSelectedCustomerId] = useState<string | null>(
    null,
  );
  const [showCreateForm, setShowCreateForm] = useState(false);

  const customers = useQuery({
    queryKey: ["customers-module", session.branchId],
    queryFn: async () => {
      const res = await api.customers.list({
        query: { branchId: session.branchId },
      });
      if (res.status !== 200) throw new Error("Failed to fetch customers");
      return res.body;
    },
  });

  const createCustomer = useMutation({
    mutationFn: async () => {
      const res = await api.customers.create({
        body: {
          branchId: session.branchId,
          name: name.trim(),
          phone: phone.trim() || undefined,
        },
        extraHeaders: authHeaders(),
      });
      if (res.status !== 201) throw new Error("Failed to create customer");
      return res.body;
    },
    onSuccess: (created) => {
      setName("");
      setPhone("");
      setShowCreateForm(false);
      setSelectedCustomerId(created.id);
      queryClient.invalidateQueries({
        queryKey: ["customers-module", session.branchId],
      });
    },
  });

  const selectedCustomer = useMemo(() => {
    const list = customers.data ?? [];
    if (list.length === 0) return null;
    if (!selectedCustomerId) return list[0];
    return (
      list.find((customer) => customer.id === selectedCustomerId) ?? list[0]
    );
  }, [customers.data, selectedCustomerId]);

  useEffect(() => {
    if (!selectedCustomer && selectedCustomerId) {
      setSelectedCustomerId(null);
    }
  }, [selectedCustomer, selectedCustomerId]);

  const customerWallet = useQuery({
    queryKey: ["customers-module-wallet", selectedCustomer?.id],
    enabled: !!selectedCustomer?.id,
    queryFn: async () => {
      if (!selectedCustomer?.id) {
        throw new Error("No customer selected");
      }
      const res = await api.customers.getWallet({
        params: { id: selectedCustomer.id },
      });
      if (res.status !== 200) throw new Error("Failed to fetch wallet balance");
      return res.body;
    },
  });

  return (
    <section className="grid h-[calc(100vh-48px)] grid-cols-1 xl:grid-cols-[390px_1fr]">
      <div className="border-r border-slate-200 bg-white p-3">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-600">
            Customer List
          </h3>
          <button
            className="rounded-lg bg-teal-700 px-3 py-2 text-sm font-semibold text-white"
            onClick={() => setShowCreateForm((prev) => !prev)}
            type="button"
          >
            {showCreateForm ? "Close" : "New Customer"}
          </button>
        </div>

        {showCreateForm ? (
          <form
            className="mt-3 grid grid-cols-1 gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              createCustomer.mutate();
            }}
          >
            <input
              className="rounded-lg border border-slate-300 px-3 py-2"
              placeholder="Customer name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
            />
            <input
              className="rounded-lg border border-slate-300 px-3 py-2"
              placeholder="Phone (optional)"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
            />
            <button
              className="rounded-lg bg-teal-700 px-3 py-2 font-semibold text-white disabled:cursor-not-allowed disabled:opacity-60"
              disabled={createCustomer.isPending || !name.trim()}
              type="submit"
            >
              {createCustomer.isPending ? "Creating..." : "Create Customer"}
            </button>
          </form>
        ) : null}

        <div className="mt-3 max-h-[560px] space-y-2 overflow-auto pr-1">
          {customers.data?.map((customer) => {
            const selected = selectedCustomer?.id === customer.id;
            return (
              <button
                className={[
                  "w-full rounded-lg border px-3 py-2 text-left transition",
                  selected
                    ? "border-teal-600 bg-teal-50"
                    : "border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50",
                ].join(" ")}
                key={customer.id}
                onClick={() => setSelectedCustomerId(customer.id)}
                type="button"
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="truncate font-semibold text-slate-900">
                      {customer.name}
                    </p>
                    <p className="truncate text-xs text-slate-500">
                      {customer.phone ?? "No phone"}
                    </p>
                  </div>
                  <span className="rounded-md border border-slate-200 px-2 py-0.5 text-xs text-slate-600">
                    {customer.code}
                  </span>
                </div>
              </button>
            );
          })}

          {customers.data?.length === 0 ? (
            <p className="rounded-lg border border-dashed border-slate-300 px-3 py-6 text-center text-sm text-slate-500">
              No customers found.
            </p>
          ) : null}
        </div>
      </div>

      <div className="bg-slate-100 p-4">
        <h3 className="text-lg font-semibold text-slate-900">
          Customer Details
        </h3>
        {!selectedCustomer ? (
          <p className="mt-3 text-sm text-slate-500">
            Select a customer from the list to view details.
          </p>
        ) : (
          <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="rounded-lg border border-slate-200 bg-white px-3 py-2">
              <p className="text-xs uppercase tracking-wide text-slate-500">
                Name
              </p>
              <p className="mt-1 font-semibold text-slate-900">
                {selectedCustomer.name}
              </p>
            </div>
            <div className="rounded-lg border border-slate-200 bg-white px-3 py-2">
              <p className="text-xs uppercase tracking-wide text-slate-500">
                Phone
              </p>
              <p className="mt-1 font-semibold text-slate-900">
                {selectedCustomer.phone ?? "Not provided"}
              </p>
            </div>
            <div className="rounded-lg border border-slate-200 bg-white px-3 py-2">
              <p className="text-xs uppercase tracking-wide text-slate-500">
                Customer Code
              </p>
              <p className="mt-1 font-semibold text-slate-900">
                {selectedCustomer.code}
              </p>
            </div>
            <div className="rounded-lg border border-slate-200 bg-white px-3 py-2">
              <p className="text-xs uppercase tracking-wide text-slate-500">
                Wallet Balance
              </p>
              <p className="mt-1 font-semibold text-slate-900">
                {customerWallet.isLoading
                  ? "Loading..."
                  : `₹ ${money(customerWallet.data?.balance ?? 0)}`}
              </p>
            </div>
            <div className="rounded-lg border border-slate-200 bg-white px-3 py-2">
              <p className="text-xs uppercase tracking-wide text-slate-500">
                Walk In
              </p>
              <p className="mt-1 font-semibold text-slate-900">
                {selectedCustomer.isWalkIn ? "Yes" : "No"}
              </p>
            </div>
            <div className="rounded-lg border border-slate-200 bg-white px-3 py-2">
              <p className="text-xs uppercase tracking-wide text-slate-500">
                Created
              </p>
              <p className="mt-1 font-semibold text-slate-900">
                {new Date(selectedCustomer.createdAt).toLocaleString()}
              </p>
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
