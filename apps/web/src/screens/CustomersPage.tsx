import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { api, authHeaders } from "../lib/api";
import { requireSession } from "./route-helpers";

export function CustomersPage() {
  const session = requireSession();
  const queryClient = useQueryClient();
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");

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
        body: { branchId: session.branchId, name, phone: phone || undefined },
        extraHeaders: authHeaders(),
      });
      if (res.status !== 201) throw new Error("Failed to create customer");
      return res.body;
    },
    onSuccess: () => {
      setName("");
      setPhone("");
      queryClient.invalidateQueries({
        queryKey: ["customers-module", session.branchId],
      });
    },
  });

  return (
    <section className="rounded-xl border border-slate-200 bg-white p-4">
      <h2 className="text-xl font-semibold">Customers</h2>
      <form
        className="mb-3 mt-3 grid grid-cols-1 gap-2 md:grid-cols-3"
        onSubmit={(e) => {
          e.preventDefault();
          createCustomer.mutate();
        }}
      >
        <input
          className="rounded-lg border border-slate-300 px-3 py-2"
          placeholder="Phone"
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
        />
        <input
          className="rounded-lg border border-slate-300 px-3 py-2"
          placeholder="Customer name"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
        <button
          className="rounded-lg bg-teal-700 px-3 py-2 font-semibold text-white"
          type="submit"
        >
          Create Customer
        </button>
      </form>
      <div className="overflow-auto">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="border-b border-slate-200 text-left">
              <th className="p-2">Code</th>
              <th className="p-2">Name</th>
              <th className="p-2">Walk In</th>
            </tr>
          </thead>
          <tbody>
            {customers.data?.map((customer) => (
              <tr className="border-b border-slate-100" key={customer.id}>
                <td className="p-2">{customer.code}</td>
                <td className="p-2">{customer.name}</td>
                <td className="p-2">{customer.isWalkIn ? "Yes" : "No"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
