import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { FormEvent, useState } from "react";
import { api, apiErrorMessage, authHeaders } from "../../lib/api";
import { inr } from "../route-helpers";

/**
 * A purchase's lines, what has gone back of each, and sending goods back to the supplier (a
 * debit note): they leave this branch's stock and come off what the supplier is owed.
 */
export function PurchaseDetail({ purchaseId, branchId }: { purchaseId: string; branchId: string }) {
  const queryClient = useQueryClient();
  const [qtyByLine, setQtyByLine] = useState<Record<string, string>>({});
  const [reason, setReason] = useState("");
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  const detail = useQuery({
    queryKey: ["purchase", purchaseId],
    queryFn: async () => {
      const res = await api.purchases.get({ params: { id: purchaseId }, extraHeaders: authHeaders() });
      if (res.status !== 200) throw new Error("Failed to load the purchase");
      return res.body;
    },
  });

  const sendBack = useMutation({
    mutationFn: async () => {
      const lines = Object.entries(qtyByLine)
        .filter(([, qty]) => Number(qty) > 0)
        .map(([purchaseLineId, qty]) => ({ purchaseLineId, qty: Number(qty) }));
      const res = await api.purchases.createReturn({ params: { id: purchaseId }, body: { lines, reason: reason.trim() }, extraHeaders: authHeaders() });
      if (res.status !== 201) throw new Error(apiErrorMessage(res.body, "Failed to send the goods back"));
      return res.body;
    },
    onSuccess: (made) => {
      setQtyByLine({});
      setReason("");
      setMessage({ ok: true, text: `${made.returnNo}: ${inr(made.totalAmount)} comes off what ${made.supplierName} is owed.` });
      void queryClient.invalidateQueries({ queryKey: ["purchase", purchaseId] });
      void queryClient.invalidateQueries({ queryKey: ["suppliers"] });
      void queryClient.invalidateQueries({ queryKey: ["stock-module", branchId] });
      void queryClient.invalidateQueries({ queryKey: ["stock-ledger", branchId] });
    },
    onError: (e) => setMessage({ ok: false, text: (e as Error).message }),
  });

  if (detail.isLoading) return <p className="py-2 text-sm text-slate-500">Loading...</p>;
  if (!detail.data) return <p className="py-2 text-sm text-rose-700">Couldn't load the purchase.</p>;
  const purchase = detail.data;
  const anyLeft = purchase.lines.some((line) => Number(line.qty) - line.returnedQty > 0);

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (!Object.values(qtyByLine).some((qty) => Number(qty) > 0)) return setMessage({ ok: false, text: "Enter how many of an item go back" });
    if (reason.trim().length < 3) return setMessage({ ok: false, text: "Say why the goods are going back" });
    sendBack.mutate();
  };

  return (
    <form onSubmit={onSubmit} className="space-y-3">
      <table className="w-full text-sm">
        <thead>
          <tr className="eyebrow border-b border-slate-200 text-left">
            <th className="py-2">Item</th>
            <th className="py-2">Qty</th>
            <th className="py-2">Unit cost</th>
            <th className="py-2 text-right">Amount</th>
            {anyLeft ? <th className="py-2 pl-3">Send back</th> : null}
          </tr>
        </thead>
        <tbody>
          {purchase.lines.map((line) => {
            const left = Number(line.qty) - line.returnedQty;
            return (
              <tr key={line.id} className="border-b border-slate-100">
                <td className="py-2 pr-3">
                  {line.item.name} <span className="text-xs text-slate-500">{line.item.code}</span>
                </td>
                <td className="py-2 pr-3 tabular-nums">
                  {Number(line.qty)} {line.item.uom}
                  {line.returnedQty > 0 ? <span className="block text-xs text-slate-500">{line.returnedQty} sent back</span> : null}
                </td>
                <td className="py-2 pr-3 tabular-nums">{inr(line.unitCost)}</td>
                <td className="py-2 text-right tabular-nums">{inr(line.amount)}</td>
                {anyLeft ? (
                  <td className="py-2 pl-3">
                    {left > 0 ? (
                      <input
                        className="field w-24 py-1"
                        type="number"
                        min="0"
                        max={left}
                        step="any"
                        aria-label={`Send back ${line.item.name}`}
                        value={qtyByLine[line.id] ?? ""}
                        onChange={(e) => setQtyByLine((current) => ({ ...current, [line.id]: e.target.value }))}
                      />
                    ) : null}
                  </td>
                ) : null}
              </tr>
            );
          })}
        </tbody>
      </table>
      <p className="text-xs text-slate-500">
        Owed for it: {inr(purchase.grandTotal)}
        {purchase.dueDate ? ` · due ${purchase.dueDate}` : ""}
        {purchase.settledBeforeAccounts ? " · recorded before supplier accounts (counted as paid)" : ""}
        {purchase.supplierGstin ? ` · GSTIN ${purchase.supplierGstin}` : ""}
        {purchase.note ? ` · ${purchase.note}` : ""}
      </p>
      {purchase.returns.length > 0 ? (
        <ul className="space-y-1 text-xs text-slate-600">
          {purchase.returns.map((entry) => (
            <li key={entry.id}>
              {entry.returnNo}: {inr(entry.totalAmount)} sent back by {entry.createdByName} ({entry.reason})
            </li>
          ))}
        </ul>
      ) : null}
      {anyLeft ? (
        <div className="flex flex-wrap items-end gap-3">
          <label className="block min-w-64 flex-1 text-sm text-slate-600">
            Why they go back
            <input className="field mt-1" maxLength={200} placeholder="Damaged, expired, wrong item..." value={reason} onChange={(e) => setReason(e.target.value)} />
          </label>
          <button className="btn-secondary" type="submit" disabled={sendBack.isPending}>
            {sendBack.isPending ? "Saving..." : "Send Back to Supplier"}
          </button>
        </div>
      ) : null}
      {message ? (
        <p className={`text-sm ${message.ok ? "text-emerald-700" : "text-rose-700"}`} role={message.ok ? undefined : "alert"}>
          {message.text}
        </p>
      ) : null}
    </form>
  );
}
