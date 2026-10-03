import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { returnLineAmounts, sanitizeReceiptCss } from "@pos/contracts";
import { API_BASE_URL, api, apiErrorMessage, authHeaders } from "../lib/api";
import { useReceiptPrinting } from "../lib/printing";
import { branchReceiptTemplate, rateFromAmounts, receiptStyleFor, renderReceipt, returnReceiptDocument } from "../lib/receipt";
import { ReceiptView } from "../components/ReceiptView";
import { ReceiptPrintStyles } from "./pos/ReceiptPrintStyles";
import { IconPrinter } from "../components/icons";
import { inr, money, requireOperationalSession } from "./route-helpers";

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

const formatReceiptQty = (qty: number) =>
  qty.toFixed(3).replace(/0+$/, "").replace(/\.$/, "");

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
  const receiptPrinting = useReceiptPrinting();

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

  const branchSettings = useQuery({
    queryKey: ["branch-settings", session.branchId],
    queryFn: async () => {
      const res = await api.branches.get({
        params: { id: session.branchId },
        extraHeaders: authHeaders(),
      });
      if (res.status !== 200) throw new Error("Failed to load branch settings");
      return res.body;
    },
  });

  const businessSettings = useQuery({
    queryKey: ["business-settings"],
    queryFn: async () => {
      const res = await api.business.get({
        extraHeaders: authHeaders(),
      });
      if (res.status !== 200) throw new Error("Failed to load business settings");
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

  const receiptHeaderLines = useMemo(() => {
    const raw = branchSettings.data?.receiptHeader ?? "";
    return raw
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean);
  }, [branchSettings.data?.receiptHeader]);

  const receiptFooterLines = useMemo(() => {
    const raw = branchSettings.data?.receiptFooter ?? "";
    return raw
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean);
  }, [branchSettings.data?.receiptFooter]);

  const receiptLogoSrc = useMemo(() => {
    const logoUrl = branchSettings.data?.logoUrl ?? businessSettings.data?.logoUrl;
    if (!logoUrl) return null;
    if (logoUrl.startsWith("http://") || logoUrl.startsWith("https://")) {
      return logoUrl;
    }
    return `${API_BASE_URL.replace(/\/$/, "")}${logoUrl.startsWith("/") ? "" : "/"}${logoUrl}`;
  }, [branchSettings.data?.logoUrl, businessSettings.data?.logoUrl]);

  const storeDisplayName = useMemo(() => {
    return (
      businessSettings.data?.name?.trim() ||
      branchSettings.data?.name?.trim() ||
      "Store"
    );
  }, [businessSettings.data?.name, branchSettings.data?.name]);

  // Branch CSS is admin-written; render only the sanitized, receipt-scoped rules.
  const customReceiptCss = useMemo(
    () => sanitizeReceiptCss(branchSettings.data?.receiptCss).css,
    [branchSettings.data?.receiptCss],
  );
  const receiptTemplate = useMemo(() => branchReceiptTemplate(branchSettings.data), [branchSettings.data]);

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
      // What earlier returns already took from this line, part by part.
      const alreadyReturnedParts = (line.returnLines ?? []).reduce(
        (acc, returnedLine) => ({
          taxable: round2(acc.taxable + Number(returnedLine.taxableAmount)),
          cgst: round2(acc.cgst + Number(returnedLine.cgstAmount)),
          sgst: round2(acc.sgst + Number(returnedLine.sgstAmount)),
          igst: round2(acc.igst + Number(returnedLine.igstAmount)),
        }),
        { taxable: 0, cgst: 0, sgst: 0, igst: 0 },
      );
      const returnQty = Number(lineQtyMap[line.id] ?? 0);
      // The same calculation the server makes, so the amount shown is the amount refunded.
      const { amount } = returnLineAmounts({
        line: {
          taxable: Number(line.taxableAmount),
          cgst: Number(line.cgstAmount),
          sgst: Number(line.sgstAmount),
          igst: Number(line.igstAmount),
        },
        soldQty,
        alreadyReturnedQty: alreadyReturned,
        alreadyReturned: alreadyReturnedParts,
        qty: returnQty,
      });
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

  const printableReturn = useMemo(() => {
    if (!returnDetail.data) return null;

    const detail = returnDetail.data;
    const items = detail.lines.map((line) => {
      const qty = Number(line.qty);
      const amount = Number(line.amount);
      const taxable = Number(line.taxableAmount);
      const taxAmount = Number(line.taxAmount);
      return {
        name: line.itemName,
        hsn: null,
        qty,
        qtyLabel: formatReceiptQty(qty),
        rate: qty > 0 ? round2(taxable / qty) : 0,
        amount: taxable,
        taxRate: rateFromAmounts(taxable, taxAmount),
        taxAmount,
        discount: 0,
        total: amount,
        taxable,
      };
    });

    const doc = returnReceiptDocument({
      branding: { storeName: storeDisplayName, headerLines: receiptHeaderLines, footerLines: receiptFooterLines },
      returnNo: detail.returnNo,
      invoiceNo: detail.saleInvoiceNo,
      createdAt: detail.createdAt ?? new Date().toISOString(),
      customer: detail.customerName,
      refundMode: detail.refundMode,
      items,
      totalAmount: Number(detail.totalAmount),
      tax: { cgst: Number(detail.cgstTotal), sgst: Number(detail.sgstTotal), igst: Number(detail.igstTotal) },
    });
    return renderReceipt(doc, receiptTemplate);
  }, [
    receiptTemplate,
    receiptFooterLines,
    receiptHeaderLines,
    returnDetail.data,
    storeDisplayName,
  ]);
  const receiptStyle = receiptStyleFor(printableReturn ?? { columns: 48 }, receiptTemplate, customReceiptCss);

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
        throw new Error(apiErrorMessage(res.body, "Failed to create return"));
      }

      return res.body;
    },
    onSuccess: (result) => {
      if (result.refundMode === "CASH") void receiptPrinting.openDrawer();
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
    <section className="grid grid-cols-1 xl:h-[calc(100vh-48px)] xl:grid-cols-[340px_1fr]">
      <ReceiptPrintStyles css={receiptStyle.css} />
      <aside className="flex h-full max-h-[75vh] flex-col overflow-hidden border-r border-slate-200 bg-white xl:max-h-none">
        <div className="flex shrink-0 items-center justify-between gap-2 border-b border-slate-200 p-4">
          <h2 className="page-title">Returns</h2>
          <button
            type="button"
            className="btn-primary text-xs"
            onClick={() => {
              setCreateMode(true);
              setSelectedInvoiceId("");
              setInvoiceSearch("");
              setLineQtyMap({});
              setMessage("");
            }}
          >
            New Return
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto bg-slate-50 p-3">

        {returnsList.isLoading ? (
          <p className="text-sm text-slate-500">Loading returns...</p>
        ) : null}
        {(returnsList.data ?? []).length === 0 && !returnsList.isLoading ? (
          <div className="rounded-md border border-dashed border-slate-300 bg-white p-6 text-center text-sm text-slate-500">No returns yet.</div>
        ) : null}

        <div className="space-y-2">
          {(returnsList.data ?? []).map((row) => (
            <button
              key={row.id}
              type="button"
              className={`list-row ${!createMode && selectedReturnId === row.id ? "is-active" : ""}`}
              onClick={() => {
                setCreateMode(false);
                setSelectedReturnId(row.id);
                setMessage("");
              }}
            >
              <div className="flex items-start justify-between gap-2">
                <p className="truncate text-sm font-semibold text-slate-900">{row.returnNo}</p>
                <p className="text-sm font-semibold text-slate-900 tabular-nums">{inr(row.totalAmount)}</p>
              </div>
              <div className="mt-0.5 flex items-center justify-between gap-2 text-xs text-slate-500">
                <p className="truncate">
                  {row.saleInvoiceNo} · {row.customerName}
                </p>
                <span className="badge bg-slate-100 text-slate-600">{row.refundMode}</span>
              </div>
            </button>
          ))}
        </div>
        </div>
      </aside>

      <div className="overflow-y-auto bg-slate-100 p-6">
        {createMode ? (
          <div className="card mx-auto max-w-5xl p-5">
            <div className="mb-4 flex items-center justify-between gap-2">
              <h3 className="page-title">New Return</h3>
              <button
                type="button"
                className="btn-ghost"
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
                <label className="field-label">
                  Search Invoice
                </label>
                <input
                  className="field"
                  placeholder="Type invoice no or customer name"
                  value={invoiceSearch}
                  onChange={(e) => setInvoiceSearch(e.target.value)}
                />
                {invoiceSearch.trim() ? (
                  <div className="mt-2 max-h-56 space-y-1 overflow-y-auto rounded-md border border-slate-200 bg-white p-1 shadow-sm">
                    {filteredInvoices.map((invoice) => (
                      <button
                        key={invoice.id}
                        type="button"
                        className={`w-full rounded-md px-3 py-2 text-left text-sm ${selectedInvoiceId === invoice.id ? "bg-brand-50 text-brand-800 ring-1 ring-brand-500" : "text-slate-700 hover:bg-slate-50"}`}
                        onClick={() => {
                          setSelectedInvoiceId(invoice.id);
                          setInvoiceSearch(invoice.invoiceNo);
                          setLineQtyMap({});
                          setMessage("");
                        }}
                      >
                        <p className="font-semibold">{invoice.invoiceNo}</p>
                        <p className="text-xs text-slate-500">
                          {customerById.get(invoice.customerId)?.name ?? "Unknown"} · {inr(invoice.grandTotal)}
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
                <label className="field-label">
                  Refund Mode
                </label>
                <select
                  className="field"
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
              <div className="mt-4 rounded-md border border-slate-200 bg-slate-50 p-3 text-sm text-slate-700">
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
                            className="field w-28"
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
                        <td className="px-2 py-2 text-right font-medium">{inr(line.amount)}</td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr className="border-t border-slate-200">
                      <td colSpan={5} className="px-2 py-3 text-right font-semibold text-slate-700">
                        Total Refund
                      </td>
                      <td className="px-2 py-3 text-right text-base font-bold text-slate-900">
                        {inr(totalReturnAmount)}
                      </td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            ) : null}

            <button
              className="btn-primary mt-4"
              disabled={createReturn.isPending || !selectedInvoiceId || returnLines.length === 0}
              onClick={() => createReturn.mutate()}
            >
              {createReturn.isPending ? "Processing Return..." : "Create Return"}
            </button>

            {message ? (
              <p
                className={`mt-3 rounded-md border px-3 py-2 text-sm ${createReturn.isError ? "border-rose-200 bg-rose-50 text-rose-700" : "border-emerald-200 bg-emerald-50 text-emerald-700"}`}
              >
                {message}
              </p>
            ) : null}
          </div>
        ) : (
          <div className="card mx-auto max-w-5xl p-5">
            <div className="flex items-center justify-between gap-3">
              <h3 className="page-title">{returnDetail.data?.returnNo ?? "Return Details"}</h3>
              {returnDetail.data ? (
                <button
                  type="button"
                  className="btn-secondary print:hidden"
                  disabled={receiptPrinting.busy}
                  onClick={() =>
                    void receiptPrinting.print(receiptStyle)
                  }
                >
                  <IconPrinter width={16} height={16} />
                  {receiptPrinting.busy ? "Printing…" : "Print Receipt"}
                </button>
              ) : null}
            </div>
            {receiptPrinting.error ? (
              <p className="mt-3 rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700 print:hidden" role="alert">
                {receiptPrinting.error}
              </p>
            ) : null}
            {!selectedReturnId ? (
              <p className="mt-3 text-sm text-slate-500">Select a return from the left list.</p>
            ) : null}
            {returnDetail.isLoading ? (
              <p className="mt-3 text-sm text-slate-500">Loading return details...</p>
            ) : null}
            {returnDetail.data ? (
              <>
                <dl className="mt-4 grid grid-cols-2 gap-x-6 gap-y-4 rounded-md border border-slate-200 bg-slate-50 p-4 text-sm md:grid-cols-4">
                  <div>
                    <dt className="eyebrow">Invoice</dt>
                    <dd className="mt-1 font-medium text-slate-900">{returnDetail.data.saleInvoiceNo}</dd>
                  </div>
                  <div>
                    <dt className="eyebrow">Customer</dt>
                    <dd className="mt-1 font-medium text-slate-900">{returnDetail.data.customerName}</dd>
                  </div>
                  <div>
                    <dt className="eyebrow">Refund mode</dt>
                    <dd className="mt-1 font-medium text-slate-900">{returnDetail.data.refundMode}</dd>
                  </div>
                  <div>
                    <dt className="eyebrow">Total refund</dt>
                    <dd className="mt-1 font-semibold text-slate-900 tabular-nums">{inr(returnDetail.data.totalAmount)}</dd>
                  </div>
                </dl>

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
                          <td className="px-2 py-2 text-right">{inr(line.amount)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                <div className="mt-6 rounded-md border border-slate-200 bg-slate-50 p-4">
                  <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-slate-500 print:hidden">
                    Printable Return Receipt
                  </p>
                  <ReceiptView
                    receipt={printableReturn}
                    logoSrc={receiptLogoSrc}
                    className="mx-auto w-fit border border-slate-200 bg-white p-4 shadow-xs"
                  />
                </div>
              </>
            ) : null}
            {message ? <p className="mt-3 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700">{message}</p> : null}
          </div>
        )}
      </div>
    </section>
  );
}
