import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { api, authHeaders } from '../lib/api';
import { requireSession } from './route-helpers';

export function ItemsPage() {
  requireSession();
  const queryClient = useQueryClient();
  const [form, setForm] = useState({ code: '', name: '', category: '', uom: 'PCS', sellPrice: '0', taxRate: '0' });

  const items = useQuery({
    queryKey: ['items-module'],
    queryFn: async () => {
      const res = await api.items.list({ query: { activeOnly: true } });
      if (res.status !== 200) throw new Error('Failed to fetch items');
      return res.body;
    }
  });

  const createItem = useMutation({
    mutationFn: async () => {
      const res = await api.items.create({
        body: {
          code: form.code,
          name: form.name,
          category: form.category || undefined,
          uom: form.uom,
          sellPrice: Number(form.sellPrice),
          taxRate: Number(form.taxRate)
        },
        extraHeaders: authHeaders()
      });
      if (res.status !== 201) throw new Error('Failed to create item');
      return res.body;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['items-module'] });
      setForm({ code: '', name: '', category: '', uom: 'PCS', sellPrice: '0', taxRate: '0' });
    }
  });

  return (
    <section className="rounded-xl border border-slate-200 bg-white p-4">
      <h2 className="text-xl font-semibold">Items</h2>
      <form
        className="mb-3 mt-3 grid grid-cols-1 gap-2 md:grid-cols-3"
        onSubmit={(e) => {
          e.preventDefault();
          createItem.mutate();
        }}
      >
        <input className="rounded-lg border border-slate-300 px-3 py-2" placeholder="Code" value={form.code} onChange={(e) => setForm((s) => ({ ...s, code: e.target.value }))} />
        <input className="rounded-lg border border-slate-300 px-3 py-2" placeholder="Name" value={form.name} onChange={(e) => setForm((s) => ({ ...s, name: e.target.value }))} />
        <input
          className="rounded-lg border border-slate-300 px-3 py-2"
          placeholder="Category"
          value={form.category}
          onChange={(e) => setForm((s) => ({ ...s, category: e.target.value }))}
        />
        <input className="rounded-lg border border-slate-300 px-3 py-2" placeholder="UOM" value={form.uom} onChange={(e) => setForm((s) => ({ ...s, uom: e.target.value }))} />
        <input
          className="rounded-lg border border-slate-300 px-3 py-2"
          placeholder="Price"
          type="number"
          value={form.sellPrice}
          onChange={(e) => setForm((s) => ({ ...s, sellPrice: e.target.value }))}
        />
        <input
          className="rounded-lg border border-slate-300 px-3 py-2"
          placeholder="Tax %"
          type="number"
          value={form.taxRate}
          onChange={(e) => setForm((s) => ({ ...s, taxRate: e.target.value }))}
        />
        <button className="rounded-lg bg-teal-700 px-3 py-2 font-semibold text-white md:col-span-3" type="submit">
          Create Item
        </button>
      </form>
      <div className="overflow-auto">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="border-b border-slate-200 text-left">
              <th className="p-2">Code</th>
              <th className="p-2">Name</th>
              <th className="p-2">Price</th>
              <th className="p-2">Tax%</th>
            </tr>
          </thead>
          <tbody>
            {items.data?.map((item) => (
              <tr className="border-b border-slate-100" key={item.id}>
                <td className="p-2">{item.code}</td>
                <td className="p-2">{item.name}</td>
                <td className="p-2">{item.sellPrice}</td>
                <td className="p-2">{item.taxRate}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
