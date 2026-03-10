import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { api, authHeaders } from '../lib/api';
import { requireSession } from './route-helpers';

export function StockPage() {
  const session = requireSession();
  const queryClient = useQueryClient();
  const [itemId, setItemId] = useState('');
  const [qty, setQty] = useState('0');
  const [reason, setReason] = useState('Opening');

  const onHand = useQuery({
    queryKey: ['stock-module', session.branchId],
    queryFn: async () => {
      const res = await api.stock.onHand({ query: { branchId: session.branchId } });
      if (res.status !== 200) throw new Error('Failed to fetch stock');
      return res.body;
    }
  });

  const opening = useMutation({
    mutationFn: async () => {
      const res = await api.stock.opening({
        body: { branchId: session.branchId, itemId, qty: Number(qty), reason },
        extraHeaders: authHeaders()
      });
      if (res.status !== 201) throw new Error('Failed to post opening');
      return res.body;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['stock-module', session.branchId] })
  });

  return (
    <section className="rounded-xl border border-slate-200 bg-white p-4">
      <h2 className="text-xl font-semibold">Stock</h2>
      <form
        className="mb-3 mt-3 grid grid-cols-1 gap-2 md:grid-cols-4"
        onSubmit={(e) => {
          e.preventDefault();
          opening.mutate();
        }}
      >
        <input className="rounded-lg border border-slate-300 px-3 py-2" value={itemId} onChange={(e) => setItemId(e.target.value)} placeholder="Item ID/Code" />
        <input className="rounded-lg border border-slate-300 px-3 py-2" value={qty} onChange={(e) => setQty(e.target.value)} type="number" placeholder="Qty" />
        <input className="rounded-lg border border-slate-300 px-3 py-2" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Reason" />
        <button className="rounded-lg bg-teal-700 px-3 py-2 font-semibold text-white" type="submit">
          Add Opening
        </button>
      </form>
      <div className="overflow-auto">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="border-b border-slate-200 text-left">
              <th className="p-2">Item ID</th>
              <th className="p-2">On Hand</th>
            </tr>
          </thead>
          <tbody>
            {onHand.data?.map((row) => (
              <tr className="border-b border-slate-100" key={row.itemId}>
                <td className="p-2">{row.itemId}</td>
                <td className="p-2">{row.onHand}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
