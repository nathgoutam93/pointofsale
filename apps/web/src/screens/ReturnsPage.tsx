import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { api, authHeaders } from "../lib/api";
import { money, requireOperationalSession } from "./route-helpers";

type ReturnRefundMode = "CASH" | "WALLET";
const round2 = (value: number) => Math.round(value * 100) / 100;
const round3 = (value: number) => Math.round(value * 1000) / 1000;

const normalizeLeastCount = (value: number | string | null | undefined) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return 1;
  const rounded = round3(parsed);
  return rounded >= 0.001 ? rounded : 1;
};

const leastCountStepText = (leastCount: number) =>
  normalizeLeastCount(leastCount).toFixed(3).replace(/0+$/, "").replace(/\.$/, "");

const formatQty = (qty: number, leastCount: number) => {
  const normalized = normalizeLeastCount(leastCount);
  const stepText = leastCountStepText(normalized);
  const decimals = stepText.includes(".") ? stepText.split(".")[1].length : 0;
  return qty.toFixed(decimals);
};

const isMultipleOfLeastCount = (qty: number, leastCount: number) => {
  const normalizedQty = round3(qty);
  const normalizedLeastCount = normalizeLeastCount(leastCount);
  const quotient = normalizedQty / normalizedLeastCount;
  return Math.abs(quotient - Math.round(quotient)) <= 1e-6;
};

export function ReturnsPage() {
  const session = requireOperationalSession();
  const queryClient = useQueryClient();

  const [createMode, setCreateMode] = useState(false);
  const [selectedReturnId, setSelectedReturnId] = useState("");
  const [selectedInvoiceId, setSelectedInvoiceId] = useState("");
  const [invoiceSearch, setInvoiceSearch] = useState("");
  const [refundMode, setRefundMode] = useState<ReturnRefundMode>("CASH");
  const [lineQtyMap, setLineQtyMap] = useState<Record<string, string>>({});
  const [message, setMessage] = useState("");

  const returnsList = useQuery({
    queryKey: ["returns-list", session.branchId],
    queryFn: async () => {
      const res = await api.returns.list({ extraHeaders: authHeaders() });
      if (res.status !== 200) throw new Error("Failed to load returns");
      return res.body;
    },
  });

  const returnDetail = useQuery({
    queryKey: ["return-detail", selectedReturnId],
    enabled: !!selectedReturnId && !createMode,
    queryFn: async () => {
      const res = await api.returns.getById({
        params: { id: selectedReturnId },
        extraHeaders: authHeaders(),
      });
      if (res.status !== 200) throw new Error("Failed to load return details");
      return res.body;
    },
  });

  const sales = useQuery({
    queryKey: ["sales-module", session.branchId],
    enabled: createMode,
    queryFn: async () => {
      const res = await api.sales.list({
        query: { branchId: session.branchId },
        extraHeaders: authHeaders(),
      });
      if (res.status !== 200) throw new Error("Failed to load sales");
      return res.body;
    },
  });

  const items = useQuery({
    queryKey: ["items-returns"],
    enabled: createMode,
    queryFn: async () => {
      const res = await api.items.list({ extraHeaders: authHeaders() });
      if (res.status !== 200) throw new Error("Failed to load items");
      return res.body;
    },
  });

  const customers = useQuery({
    queryKey: ["customers-returns", session.branchId],
    enabled: createMode,
    queryFn: async () => {
      const res = await api.customers.list({
        query: { branchId: session.branchId },
        extraHeaders: authHeaders(),
      });
      if (res.status !== 200) throw new Error("Failed to load customers");
      return res.body;
    },
  });

  const selectedInvoiceDetails = useQuery({
    queryKey: ["sales-by-id", selectedInvoiceId],
    enabled: createMode && !!selectedInvoiceId,
    queryFn: async () => {
      const res = await api.sales.getById({
        params: { id: selectedInvoiceId },
        extraHeaders: authHeaders(),
      });
      if (res.status !== 200) throw new Error("Failed to load invoice details");
      return res.body;
    },
  });

  useEffect(() => {
    if (createMode || selectedReturnId) return;
    if ((returnsList.data ?? []).length > 0) {
      setSelectedReturnId(returnsList.data![0].id);
    }
  }, [createMode, selectedReturnId, returnsList.data]);

  const itemNameById = useMemo(() => {
    const map = new Map<string, string>();
    for (const item of items.data ?? []) map.set(item.id, item.name);
    return map;
  }, [items.data]);

  const itemLeastCountById = useMemo(() => {
    const map = new Map<string, number>();
    for (const item of items.data ?? []) {
      map.set(item.id, normalizeLeastCount(item.leastCount));
    }
    return map;
  }, [items.data]);

  const customerById = useMemo(() => {
    const map = new Map<string, { name: string; isWalkIn: boolean }>();
    for (const customer of customers.data ?? []) {
      map.set(customer.id, { name: customer.name, isWalkIn: customer.isWalkIn });
    }
    return map;
  }, [customers.data]);

  const selectedInvoice = useMemo(() => {
    if (!selectedInvoiceId) return null;
    return (sales.data ?? []).find((invoice) => invoice.id === selectedInvoiceId) ?? null;
  }, [sales.data, selectedInvoiceId]);

  const filteredInvoices = useMemo(() => {
    const query = invoiceSearch.trim().toLowerCase();
    if (!query) return [];
    return (sales.data ?? [])
      .filter((invoice) => {
        const customer = customerById.get(invoice.customerId);
        const haystack = `${invoice.invoiceNo} ${customer?.name ?? ""}`.toLowerCase();
        return haystack.includes(query);
      })
      .slice(0, 20);
  }, [customerById, invoiceSearch, sales.data]);

  const selectedCustomer = selectedInvoice
    ? customerById.get(selectedInvoice.customerId)
    : undefined;
  const walletAllowed = !!selectedCustomer && !selectedCustomer.isWalkIn;

  useEffect(() => {
    if (refundMode === "WALLET" && !walletAllowed) setRefundMode("CASH");
  }, [refundMode, walletAllowed]);

  const returnLines = useMemo(() => {
    return (selectedInvoiceDetails.data?.lines ?? []).map((line) => {
      const soldQty = Number(line.qty);
      const alreadyReturned = (line.returnLines ?? []).reduce(
        (acc, returnedLine) => acc + Number(returnedLine.qty),
        0,
      );
      const availableQty = Math.max(0, soldQty - alreadyReturned);
      const netAmount = Number(line.netAmount);
      const unitRate = soldQty > 0 ? round2(netAmount / soldQty) : 0;
      const returnQty = Number(lineQtyMap[line.id] ?? 0);
      const amount = returnQty > 0 ? round2(returnQty * unitRate) : 0;
      const leastCount = itemLeastCountById.get(line.itemId) ?? 1;

      return {
        lineId: line.id,
        itemId: line.itemId,
        itemName: itemNameById.get(line.itemId) ?? `Item ${line.itemId.slice(0, 6)}`,
        soldQty,
        alreadyReturned,
        availableQty,
        leastCount,
        leastCountStep: leastCountStepText(leastCount),
        rate: Number(line.rate),
        returnQty,
        amount,
      };
    });
  }, [itemLeastCountById, itemNameById, lineQtyMap, selectedInvoiceDetails.data?.lines]);

  const totalReturnAmount = useMemo(
    () => returnLines.reduce((acc, line) => round2(acc + line.amount), 0),
    [returnLines],
  );

  const createReturn = useMutation({
    mutationFn: async () => {
      if (!selectedInvoiceId) throw new Error("Select an invoice");

      const lines = returnLines
        .filter((line) => line.returnQty > 0)
        .map((line) => ({ saleLineId: line.lineId, qty: line.returnQty }));

      if (lines.length === 0) throw new Error("Enter return quantity for at least one line");

      const hasInvalidQty = returnLines.some(
        (line) =>
          line.returnQty < 0 ||
          line.returnQty > line.availableQty ||
          (line.returnQty > 0 && !isMultipleOfLeastCount(line.returnQty, line.leastCount)),
      );
      if (hasInvalidQty) {
        throw new Error("Return qty must be valid, within available qty, and match least count");
      }

      const res = await api.sales.returns({
        params: { id: selectedInvoiceId },
        body: { lines, refundMode },
        extraHeaders: authHeaders(),
      });

      if (res.status !== 201) {
        const apiMessage =
          typeof (res.body as { message?: unknown })?.message === "string"
            ? (res.body as { message: string }).message
            : "";
        throw new Error(apiMessage || "Failed to create return");
      }

      return res.body;
    },
    onSuccess: (result) => {
      setMessage(`Return created: ${result.returnNo}`);
      setCreateMode(false);
      setSelectedReturnId(result.id);
      setSelectedInvoiceId("");
      setInvoiceSearch("");
      setLineQtyMap({});
      queryClient.invalidateQueries({ queryKey: ["returns-list", session.branchId] });
      queryClient.invalidateQueries({ queryKey: ["return-detail", result.id] });
      queryClient.invalidateQueries({ queryKey: ["sales-module", session.branchId] });
      queryClient.invalidateQueries({ queryKey: ["sales-by-id", selectedInvoiceId] });
      queryClient.invalidateQueries({ queryKey: ["stock-module", session.branchId] });
    },
    onError: (error) => {
      setMessage(error instanceof Error ? error.message : "Failed to create return");
    },
  });

  return (
    <section className="grid h-[calc(100vh-48px)] grid-cols-1 xl:grid-cols-[340px_1fr]">
      <aside className="overflow-y-auto border-r border-slate-200 bg-white p-4">
        <div className="mb-4 flex items-center justify-between gap-2">
          <h2 className="text-lg font-semibold text-slate-900">Returns</h2>
          <button
            type="button"
            className="rounded bg-slate-900 px-3 py-2 text-xs font-semibold text-white"
            onClick={() => {
              setCreateMode(true);
              setSelectedInvoiceId("");
              setInvoiceSearch("");
              setLineQtyMap({});
              setMessage("");
            }}
          >
            Create New Return
          </button>
        </div>

        {returnsList.isLoading ? (
          <p className="text-sm text-slate-500">Loading returns...</p>
        ) : null}
        {(returnsList.data ?? []).length === 0 && !returnsList.isLoading ? (
          <p className="text-sm text-slate-500">No returns found.</p>
        ) : null}

        <div className="space-y-2">
          {(returnsList.data ?? []).map((row) => (
            <button
              key={row.id}
              type="button"
              className={`w-full rounded border p-3 text-left ${!createMode && selectedReturnId === row.id ? "border-slate-800 bg-slate-900 text-white" : "border-slate-200 bg-white hover:bg-slate-50"}`}
              onClick={() => {
                setCreateMode(false);
                setSelectedReturnId(row.id);
                setMessage("");
              }}
            >
              <p className="text-sm font-semibold">{row.returnNo}</p>
              <p className={`text-xs ${!createMode && selectedReturnId === row.id ? "text-slate-200" : "text-slate-500"}`}>
                {row.saleInvoiceNo} · {row.customerName}
              </p>
              <p className={`mt-1 text-xs ${!createMode && selectedReturnId === row.id ? "text-slate-100" : "text-slate-600"}`}>
                ₹ {money(row.totalAmount)} · {row.refundMode}
              </p>
            </button>
          ))}
        </div>
      </aside>

      <div className="overflow-y-auto bg-slate-100 p-4">
        {createMode ? (
          <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <div className="mb-4 flex items-center justify-between gap-2">
              <h3 className="text-base font-semibold text-slate-900">Create Return</h3>
              <button
                type="button"
                className="text-xs text-slate-700 underline"
                onClick={() => {
                  setCreateMode(false);
                  setSelectedInvoiceId("");
                  setInvoiceSearch("");
                  setLineQtyMap({});
                  setMessage("");
                }}
              >
                Cancel
              </button>
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              <div>
                <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500">
                  Search Invoice
                </label>
                <input
                  className="w-full rounded border border-slate-300 px-3 py-2"
                  placeholder="Type invoice no or customer name"
                  value={invoiceSearch}
                  onChange={(e) => setInvoiceSearch(e.target.value)}
                />
                {invoiceSearch.trim() ? (
                  <div className="mt-2 max-h-56 space-y-1 overflow-y-auto rounded border border-slate-200 p-1">
                    {filteredInvoices.map((invoice) => (
                      <button
                        key={invoice.id}
                        type="button"
                        className={`w-full rounded px-2 py-2 text-left text-sm ${selectedInvoiceId === invoice.id ? "bg-slate-900 text-white" : "bg-slate-50 text-slate-700 hover:bg-slate-100"}`}
                        onClick={() => {
                          setSelectedInvoiceId(invoice.id);
                          setInvoiceSearch(invoice.invoiceNo);
                          setLineQtyMap({});
                          setMessage("");
                        }}
                      >
                        <p className="font-semibold">{invoice.invoiceNo}</p>
                        <p className={`text-xs ${selectedInvoiceId === invoice.id ? "text-slate-200" : "text-slate-500"}`}>
                          {customerById.get(invoice.customerId)?.name ?? "Unknown"} · ₹ {money(invoice.grandTotal)}
                        </p>
                      </button>
                    ))}
                    {filteredInvoices.length === 0 ? (
                      <p className="px-2 py-2 text-xs text-slate-500">No matching invoice found.</p>
                    ) : null}
                  </div>
                ) : null}
              </div>

              <div>
                <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500">
                  Refund Mode
                </label>
                <select
                  className="w-full rounded border border-slate-300 px-3 py-2"
                  value={refundMode}
                  onChange={(e) => setRefundMode(e.target.value as ReturnRefundMode)}
                >
                  <option value="CASH">Cash Refund</option>
                  {walletAllowed ? <option value="WALLET">Wallet Credit</option> : null}
                </select>
                {!walletAllowed ? (
                  <p className="mt-1 text-xs text-amber-700">
                    Wallet credit is available only for registered customers.
                  </p>
                ) : null}
              </div>
            </div>

            {selectedInvoice ? (
              <div className="mt-4 rounded border border-slate-200 bg-slate-50 p-3 text-sm text-slate-700">
                <p>
                  <span className="font-semibold">Invoice:</span> {selectedInvoice.invoiceNo}
                </p>
                <p>
                  <span className="font-semibold">Customer:</span> {selectedCustomer?.name ?? "Unknown"}
                </p>
              </div>
            ) : null}

            {returnLines.length > 0 ? (
              <div className="mt-4 overflow-x-auto">
                <table className="min-w-full divide-y divide-slate-200 text-sm">
                  <thead>
                    <tr className="text-left text-xs uppercase tracking-wide text-slate-500">
                      <th className="px-2 py-2">Item</th>
                      <th className="px-2 py-2">Sold</th>
                      <th className="px-2 py-2">Already Returned</th>
                      <th className="px-2 py-2">Available</th>
                      <th className="px-2 py-2">Return Qty</th>
                      <th className="px-2 py-2 text-right">Amount</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {returnLines.map((line) => (
                      <tr key={line.lineId}>
                        <td className="px-2 py-2 text-slate-800">{line.itemName}</td>
                        <td className="px-2 py-2">{formatQty(line.soldQty, line.leastCount)}</td>
                        <td className="px-2 py-2">{formatQty(line.alreadyReturned, line.leastCount)}</td>
                        <td className="px-2 py-2 font-semibold">{formatQty(line.availableQty, line.leastCount)}</td>
                        <td className="px-2 py-2">
                          <input
                            className="w-28 rounded border border-slate-300 px-2 py-1"
                            type="number"
                            min={0}
                            max={line.availableQty}
                            step={line.leastCountStep}
                            value={lineQtyMap[line.lineId] ?? ""}
                            onChange={(e) => {
                              setLineQtyMap((prev) => ({ ...prev, [line.lineId]: e.target.value }));
                              setMessage("");
                            }}
                          />
                        </td>
                        <td className="px-2 py-2 text-right font-medium">₹ {money(line.amount)}</td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr className="border-t border-slate-200">
                      <td colSpan={5} className="px-2 py-3 text-right font-semibold text-slate-700">
                        Total Refund
                      </td>
                      <td className="px-2 py-3 text-right text-base font-bold text-slate-900">
                        ₹ {money(totalReturnAmount)}
                      </td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            ) : null}

            <button
              className="mt-4 rounded bg-slate-900 px-4 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-40"
              disabled={createReturn.isPending || !selectedInvoiceId || returnLines.length === 0}
              onClick={() => createReturn.mutate()}
            >
              {createReturn.isPending ? "Processing Return..." : "Create Return"}
            </button>

            {message ? (
              <p
                className={`mt-3 rounded p-2 text-sm ${createReturn.isError ? "bg-rose-100 text-rose-700" : "bg-emerald-100 text-emerald-700"}`}
              >
                {message}
              </p>
            ) : null}
          </div>
        ) : (
          <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <h3 className="text-base font-semibold text-slate-900">Return Details</h3>
            {!selectedReturnId ? (
              <p className="mt-3 text-sm text-slate-500">Select a return from the left list.</p>
            ) : null}
            {returnDetail.isLoading ? (
              <p className="mt-3 text-sm text-slate-500">Loading return details...</p>
            ) : null}
            {returnDetail.data ? (
              <>
                <div className="mt-3 rounded border border-slate-200 bg-slate-50 p-3 text-sm text-slate-700">
                  <p>
                    <span className="font-semibold">Return No:</span> {returnDetail.data.returnNo}
                  </p>
                  <p>
                    <span className="font-semibold">Invoice No:</span> {returnDetail.data.saleInvoiceNo}
                  </p>
                  <p>
                    <span className="font-semibold">Customer:</span> {returnDetail.data.customerName}
                  </p>
                  <p>
                    <span className="font-semibold">Refund Mode:</span> {returnDetail.data.refundMode}
                  </p>
                  <p>
                    <span className="font-semibold">Total:</span> ₹ {money(returnDetail.data.totalAmount)}
                  </p>
                </div>

                <div className="mt-4 overflow-x-auto">
                  <table className="min-w-full divide-y divide-slate-200 text-sm">
                    <thead>
                      <tr className="text-left text-xs uppercase tracking-wide text-slate-500">
                        <th className="px-2 py-2">Item</th>
                        <th className="px-2 py-2">Qty</th>
                        <th className="px-2 py-2 text-right">Amount</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {returnDetail.data.lines.map((line) => (
                        <tr key={line.id}>
                          <td className="px-2 py-2">{line.itemName}</td>
                          <td className="px-2 py-2">{Number(line.qty).toFixed(3)}</td>
                          <td className="px-2 py-2 text-right">₹ {money(line.amount)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            ) : null}
            {message ? <p className="mt-3 rounded bg-emerald-100 p-2 text-sm text-emerald-700">{message}</p> : null}
          </div>
        )}
      </div>
    </section>
  );
}
