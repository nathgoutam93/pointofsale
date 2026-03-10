import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { api } from '../lib/api';
import { requireSession } from './route-helpers';

export function ReceiptsPage() {
  requireSession();
  const [invoiceId, setInvoiceId] = useState('');

  const receipt = useQuery({
    queryKey: ['receiptByInvoice', invoiceId],
    enabled: !!invoiceId,
    queryFn: async () => {
      const res = await api.receipts.getByInvoice({ params: { invoiceId } });
      if (res.status !== 200) throw new Error('Receipt not found');
      return res.body;
    }
  });

  return (
    <section className="rounded-xl border border-slate-200 bg-white p-4">
      <h2 className="text-xl font-semibold">Receipts</h2>
      <input
        className="mt-3 w-full rounded-lg border border-slate-300 px-3 py-2 md:max-w-md"
        placeholder="Invoice ID or Invoice No"
        value={invoiceId}
        onChange={(e) => setInvoiceId(e.target.value)}
      />
      {receipt.data ? (
        <article className="mt-3 max-w-md rounded-lg border border-dashed border-slate-400 p-3">
          <p>
            Receipt No: <strong>{receipt.data.receiptNo}</strong>
          </p>
          <p>Invoice ID: {receipt.data.invoiceId}</p>
          <p>Amount: {receipt.data.amount}</p>
          <p>Date: {new Date(receipt.data.createdAt).toLocaleString()}</p>
        </article>
      ) : null}
    </section>
  );
}
