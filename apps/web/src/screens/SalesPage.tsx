import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { api, authHeaders } from "../lib/api";
import { money, requireSession } from "./route-helpers";

type PaymentMode = "CASH" | "CARD" | "WALLET";

type SettledSummary = {
  invoiceId: string;
  invoiceNo: string;
  receiptNo: string;
  createdAt: string;
  subTotal: number;
  taxTotal: number;
  grandTotal: number;
  lines: Array<{
    id: string;
    itemId: string;
    qty: number;
    netAmount: number;
  }>;
  payments: Array<{ mode: PaymentMode; amount: number }>;
};

export function SalesPage() {
  const session = requireSession();
  const queryClient = useQueryClient();

  const [selectedInvoiceId, setSelectedInvoiceId] = useState("");
  const [paymentModalOpen, setPaymentModalOpen] = useState(false);
  const [paymentMethod, setPaymentMethod] = useState<PaymentMode>("CASH");
  const [paymentAmount, setPaymentAmount] = useState("0");
  const [paymentLines, setPaymentLines] = useState<
    Array<{ mode: PaymentMode; amount: number }>
  >([]);
  const [paymentModalError, setPaymentModalError] = useState("");
  const [message, setMessage] = useState("");
  const [receiptContact, setReceiptContact] = useState("");
  const [settledSummary, setSettledSummary] = useState<SettledSummary | null>(
    null,
  );

  const sales = useQuery({
    queryKey: ["sales-module", session.branchId],
    queryFn: async () => {
      const res = await api.sales.list({
        query: { branchId: session.branchId },
      });
      if (res.status !== 200) throw new Error("Failed to load sales");
      return res.body;
    },
  });

  const items = useQuery({
    queryKey: ["items-sales"],
    queryFn: async () => {
      const res = await api.items.list({});
      if (res.status !== 200) throw new Error("Failed to load items");
      return res.body;
    },
  });

  const selectedInvoiceDetails = useQuery({
    queryKey: ["sales-by-id", selectedInvoiceId],
    enabled: !!selectedInvoiceId,
    queryFn: async () => {
      const res = await api.sales.getById({
        params: { id: selectedInvoiceId },
      });
      if (res.status !== 200) throw new Error("Failed to load invoice details");
      return res.body;
    },
  });

  const selectedReceipt = useQuery({
    queryKey: ["receipt-by-invoice-sales", selectedInvoiceId],
    enabled: !!selectedInvoiceId,
    queryFn: async () => {
      const res = await api.receipts.getByInvoice({
        params: { invoiceId: selectedInvoiceId },
      });
      if (res.status !== 200) return null;
      return res.body;
    },
  });

  useEffect(() => {
    if (!sales.data || sales.data.length === 0) return;
    if (selectedInvoiceId) {
      const exists = sales.data.some(
        (invoice) => invoice.id === selectedInvoiceId,
      );
      if (exists) return;
    }
    const firstPending =
      sales.data.find(
        (invoice) => Number(invoice.grandTotal) - Number(invoice.paidTotal) > 0,
      ) ?? sales.data[0];
    setSelectedInvoiceId(firstPending.id);
  }, [sales.data, selectedInvoiceId]);

  const itemNameById = useMemo(() => {
    const map = new Map<string, string>();
    for (const item of items.data ?? []) {
      map.set(item.id, item.name);
    }
    return map;
  }, [items.data]);

  const selectedInvoice = useMemo(() => {
    if (!selectedInvoiceId) return null;
    return (
      (sales.data ?? []).find((invoice) => invoice.id === selectedInvoiceId) ??
      null
    );
  }, [sales.data, selectedInvoiceId]);

  const currentInvoice = selectedInvoiceDetails.data ?? selectedInvoice;
  const pendingAmount = useMemo(() => {
    if (!currentInvoice) return 0;
    const pending =
      Number(currentInvoice.grandTotal) - Number(currentInvoice.paidTotal);
    return Math.max(0, pending);
  }, [currentInvoice]);

  const totalPaid = useMemo(
    () => paymentLines.reduce((acc, line) => acc + line.amount, 0),
    [paymentLines],
  );
  const remainingAmount = useMemo(
    () => Math.max(0, pendingAmount - totalPaid),
    [pendingAmount, totalPaid],
  );
  const paymentMatchesPending = Math.abs(totalPaid - pendingAmount) < 0.005;

  const paymentKeypadPress = (key: string) => {
    const current = paymentAmount;
    if (key === "C") {
      setPaymentAmount("0");
      return;
    }
    if (key === "<") {
      const next = current.length <= 1 ? "0" : current.slice(0, -1);
      setPaymentAmount(next);
      return;
    }
    if (key === "+/-") {
      if (current === "0") return;
      setPaymentAmount(
        current.startsWith("-") ? current.slice(1) : `-${current}`,
      );
      return;
    }
    if (key === ".") {
      if (current.includes(".")) return;
      setPaymentAmount(`${current}.`);
      return;
    }
    if (key.startsWith("+")) {
      const increment = Number(key.slice(1));
      if (!Number.isFinite(increment)) return;
      const next = (Number(current) || 0) + increment;
      setPaymentAmount(String(next));
      return;
    }

    const next = current === "0" ? key : `${current}${key}`;
    setPaymentAmount(next);
  };

  const applyPaymentLine = () => {
    const amount = Number(paymentAmount);
    if (!Number.isFinite(amount) || amount <= 0) return;

    setPaymentModalError("");
    setPaymentLines((prev) => {
      const withoutCurrent = prev.filter((line) => line.mode !== paymentMethod);
      const paidWithoutCurrent = withoutCurrent.reduce(
        (acc, line) => acc + line.amount,
        0,
      );
      const maxAllowedForCurrent = pendingAmount - paidWithoutCurrent;
      if (amount > maxAllowedForCurrent + 0.0001) {
        setPaymentModalError(
          `Amount exceeds remaining. You can add up to ₹ ${money(maxAllowedForCurrent)}`,
        );
        return prev;
      }

      const next = [...withoutCurrent, { mode: paymentMethod, amount }];
      const nextPaid = next.reduce((acc, line) => acc + line.amount, 0);
      const nextRemaining = Math.max(0, pendingAmount - nextPaid);
      setPaymentAmount(money(nextRemaining));
      return next;
    });
  };

  const removePaymentLine = (mode: PaymentMode) => {
    setPaymentLines((prev) => prev.filter((line) => line.mode !== mode));
  };

  const openSettleModal = () => {
    if (!currentInvoice || pendingAmount <= 0) {
      setMessage("This invoice is already fully settled.");
      return;
    }
    setPaymentMethod("CASH");
    setPaymentAmount(money(pendingAmount));
    setPaymentLines([]);
    setPaymentModalError("");
    setPaymentModalOpen(true);
    setMessage("");
  };

  const settleInvoice = useMutation({
    mutationFn: async (payload: {
      invoiceId: string;
      payments: Array<{ mode: PaymentMode; amount: number }>;
    }) => {
      const res = await api.sales.settle({
        params: { id: payload.invoiceId },
        body: { payments: payload.payments },
        extraHeaders: authHeaders(),
      });
      if (res.status !== 200) throw new Error("Failed to settle invoice");
      return res.body;
    },
    onSuccess: (result) => {
      setSettledSummary({
        invoiceId: result.invoice.id,
        invoiceNo: result.invoice.invoiceNo,
        receiptNo: result.receipt.receiptNo,
        createdAt: result.receipt.createdAt,
        subTotal: Number(result.invoice.subTotal),
        taxTotal: Number(result.invoice.taxTotal),
        grandTotal: Number(result.invoice.grandTotal),
        lines: result.invoice.lines.map((line) => ({
          id: line.id,
          itemId: line.itemId,
          qty: Number(line.qty),
          netAmount: Number(line.netAmount),
        })),
        payments: result.invoice.payments.map((line) => ({
          mode: line.mode,
          amount: Number(line.amount),
        })),
      });
      setReceiptContact("");
      setPaymentModalOpen(false);
      setPaymentLines([]);
      setPaymentAmount("0");
      setSelectedInvoiceId(result.invoice.id);
      setMessage(
        `Done: ${result.invoice.invoiceNo}, Receipt: ${result.receipt.receiptNo}`,
      );
      queryClient.invalidateQueries({
        queryKey: ["sales-module", session.branchId],
      });
      queryClient.invalidateQueries({
        queryKey: ["sales-by-id", result.invoice.id],
      });
      queryClient.invalidateQueries({
        queryKey: ["receipt-by-invoice-sales", result.invoice.id],
      });
    },
  });

  const pendingInvoices = useMemo(
    () =>
      (sales.data ?? []).filter(
        (invoice) => Number(invoice.grandTotal) - Number(invoice.paidTotal) > 0,
      ),
    [sales.data],
  );

  return (
    <section className="grid h-[calc(100vh-48px)] grid-cols-1 gap-4 xl:grid-cols-[1fr_420px]">
      <aside className="flex flex-col overflow-hidden border-r border-slate-200 bg-white">
        {settledSummary ? (
          <>
            <div className="flex-1 space-y-4 overflow-y-auto border-b border-slate-200 p-4">
              <div className="rounded-lg border border-emerald-300 bg-emerald-100 p-4 text-center">
                <div className="mx-auto mb-2 grid h-10 w-10 place-items-center rounded-full bg-emerald-600 text-lg font-bold text-white">
                  ✓
                </div>
                <p className="text-3xl font-semibold text-emerald-700">
                  Payment Successful
                </p>
                <p className="mt-1 text-2xl font-bold text-emerald-800">
                  ₹ {money(settledSummary.grandTotal)}
                </p>
                <button
                  className="mt-2 rounded bg-emerald-500 px-3 py-1 text-xs font-semibold text-white"
                  onClick={() =>
                    setMessage("Payment already settled. Pick another invoice.")
                  }
                >
                  Edit Payment
                </button>
              </div>

              <div className="flex overflow-hidden rounded border border-slate-300">
                <input
                  className="w-full px-3 py-3 text-base text-slate-700 outline-none"
                  placeholder="Send receipt to email or phone"
                  value={receiptContact}
                  onChange={(e) => setReceiptContact(e.target.value)}
                />
                <button
                  className="w-20 bg-fuchsia-800 text-2xl text-white"
                  onClick={() => {
                    if (!receiptContact.trim()) {
                      setMessage("Enter email or phone to send receipt.");
                      return;
                    }
                    setMessage(`Receipt sent to ${receiptContact.trim()}`);
                  }}
                >
                  ➤
                </button>
              </div>
            </div>

            <button
              className="m-3 rounded bg-fuchsia-900 px-3 py-4 text-2xl font-semibold text-white"
              onClick={() => setSettledSummary(null)}
            >
              Settle Another Invoice
            </button>
          </>
        ) : (
          <>
            <div className="border-b border-slate-200 p-4">
              <h2 className="text-2xl font-semibold text-slate-900">Sales</h2>
              <p className="mt-1 text-sm text-slate-600">
                Settle draft or on-credit invoices with split payments.
              </p>
              <div className="mt-3 grid grid-cols-2 gap-2 text-sm">
                <div className="rounded bg-slate-100 p-2 text-slate-700">
                  Pending Invoices:{" "}
                  <span className="font-semibold text-slate-900">
                    {pendingInvoices.length}
                  </span>
                </div>
                <div className="rounded bg-slate-100 p-2 text-slate-700">
                  Total Invoices:{" "}
                  <span className="font-semibold text-slate-900">
                    {(sales.data ?? []).length}
                  </span>
                </div>
              </div>
            </div>

            <div className="flex-1 space-y-2 overflow-y-auto p-3">
              {(sales.data ?? []).map((invoice) => {
                const pending =
                  Number(invoice.grandTotal) - Number(invoice.paidTotal);
                const isSelected = selectedInvoiceId === invoice.id;
                return (
                  <button
                    key={invoice.id}
                    className={`w-full rounded-lg border p-3 text-left ${isSelected ? "border-fuchsia-600 bg-fuchsia-50" : "border-slate-200 bg-white"}`}
                    onClick={() => {
                      setSelectedInvoiceId(invoice.id);
                      setMessage("");
                    }}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="text-sm font-semibold text-slate-900">
                          {invoice.invoiceNo}
                        </p>
                        <p className="text-xs text-slate-500">
                          {invoice.status}
                        </p>
                      </div>
                      <p
                        className={`text-sm font-semibold ${pending > 0 ? "text-amber-700" : "text-emerald-700"}`}
                      >
                        {pending > 0
                          ? `Pending ₹ ${money(pending)}`
                          : "Settled"}
                      </p>
                    </div>
                    <div className="mt-2 flex items-center justify-between text-xs text-slate-600">
                      <p>Total ₹ {money(Number(invoice.grandTotal))}</p>
                      <p>Paid ₹ {money(Number(invoice.paidTotal))}</p>
                    </div>
                  </button>
                );
              })}
            </div>
          </>
        )}

        {settleInvoice.error ? (
          <p className="px-4 pb-2 text-sm text-red-700">
            {(settleInvoice.error as Error).message}
          </p>
        ) : null}
        {sales.error ? (
          <p className="px-4 pb-2 text-sm text-red-700">
            {(sales.error as Error).message}
          </p>
        ) : null}
        {selectedInvoiceDetails.error ? (
          <p className="px-4 pb-2 text-sm text-red-700">
            {(selectedInvoiceDetails.error as Error).message}
          </p>
        ) : null}
        {message ? (
          <p className="px-4 pb-3 text-sm text-emerald-700">{message}</p>
        ) : null}
      </aside>

      <div className="bg-slate-100 p-4">
        <div className="mx-auto mb-3 flex w-full max-w-sm items-center justify-between rounded border border-slate-200 bg-white p-2">
          <div></div>
          <div className="flex items-center gap-2">
            <button
              className="rounded bg-emerald-600 px-3 py-2 text-sm font-semibold text-white disabled:bg-emerald-300"
              onClick={openSettleModal}
              disabled={
                !currentInvoice || pendingAmount <= 0 || settleInvoice.isPending
              }
            >
              Settle
            </button>
            <button
              className="rounded border border-slate-300 bg-slate-50 px-3 py-2 text-sm font-semibold text-slate-700"
              onClick={() => window.print()}
            >
              Print
            </button>
          </div>
        </div>
        <div className="mx-auto w-full max-w-sm rounded border border-slate-200 bg-white p-5 shadow-sm">
          <p className="text-center text-3xl font-semibold text-fuchsia-800">
            Your logo
          </p>
          <p className="mt-3 text-center text-xs text-slate-600">
            Ticket{" "}
            {settledSummary?.receiptNo ??
              selectedReceipt.data?.receiptNo ??
              "—"}
          </p>
          <p className="text-center text-xs text-slate-600">
            {new Date(
              settledSummary?.createdAt ??
                selectedReceipt.data?.createdAt ??
                Date.now(),
            ).toLocaleString()}
          </p>
          <p className="mt-1 text-center text-xs text-slate-600">
            Invoice:{" "}
            {settledSummary?.invoiceNo ?? currentInvoice?.invoiceNo ?? "—"}
          </p>

          <div className="mt-5 space-y-2 text-sm text-slate-700">
            {(
              settledSummary?.lines ??
              selectedInvoiceDetails.data?.lines.map((line) => ({
                id: line.id,
                itemId: line.itemId,
                qty: Number(line.qty),
                netAmount: Number(line.netAmount),
              })) ??
              []
            ).map((line) => (
              <div key={line.id} className="flex items-start justify-between">
                <p className="mr-3">
                  {line.qty.toFixed(0)} x{" "}
                  {itemNameById.get(line.itemId) ??
                    `Item ${line.itemId.slice(0, 6)}`}
                </p>
                <p>₹ {money(line.netAmount)}</p>
              </div>
            ))}
          </div>

          <div className="mt-5 space-y-1 border-t border-slate-200 pt-4 text-slate-700">
            <div className="flex items-center justify-between">
              <p>Subtotal</p>
              <p>
                ₹{" "}
                {money(
                  settledSummary?.subTotal ??
                    Number(currentInvoice?.subTotal ?? 0),
                )}
              </p>
            </div>
            <div className="flex items-center justify-between">
              <p>Tax</p>
              <p>
                ₹{" "}
                {money(
                  settledSummary?.taxTotal ??
                    Number(currentInvoice?.taxTotal ?? 0),
                )}
              </p>
            </div>
            <div className="flex items-center justify-between text-lg font-semibold">
              <p>Total</p>
              <p>
                ₹{" "}
                {money(
                  settledSummary?.grandTotal ??
                    Number(currentInvoice?.grandTotal ?? 0),
                )}
              </p>
            </div>
          </div>

          <div className="mt-4 space-y-1 text-sm text-slate-700">
            {(
              settledSummary?.payments ??
              selectedInvoiceDetails.data?.payments.map((line) => ({
                mode: line.mode as PaymentMode,
                amount: Number(line.amount),
              })) ??
              []
            ).map((line, idx) => (
              <div
                key={`${line.mode}-${idx}`}
                className="flex items-center justify-between"
              >
                <p>{line.mode}</p>
                <p>₹ {money(line.amount)}</p>
              </div>
            ))}
          </div>
        </div>
      </div>

      {paymentModalOpen ? (
        <div className="fixed inset-0 z-40 grid place-items-center bg-slate-900/40 p-4">
          <div className="grid w-full max-w-6xl grid-cols-1 overflow-hidden rounded-xl border border-slate-300 bg-white shadow-2xl lg:grid-cols-[480px_1fr]">
            <div className="border-r border-slate-200 p-3">
              <div className="mb-3 grid gap-2">
                {[
                  { key: "CASH" as const, label: "Cash" },
                  { key: "CARD" as const, label: "Card" },
                  { key: "WALLET" as const, label: "Customer Wallet" },
                ].map((method) => (
                  <button
                    key={method.key}
                    className={`rounded px-3 py-4 text-left text-3xl ${paymentMethod === method.key ? "bg-indigo-100 text-indigo-900" : "bg-slate-100 text-slate-700"}`}
                    onClick={() => setPaymentMethod(method.key)}
                  >
                    {method.label}
                  </button>
                ))}
              </div>

              <div className="grid grid-cols-4 gap-1">
                {[
                  "1",
                  "2",
                  "3",
                  "+10",
                  "4",
                  "5",
                  "6",
                  "+20",
                  "7",
                  "8",
                  "9",
                  "+50",
                  "+/-",
                  "0",
                  ".",
                  "<",
                ].map((key) => (
                  <button
                    key={key}
                    className={`rounded px-2 py-4 text-2xl font-semibold ${key.startsWith("+") && key.length > 1 ? "bg-emerald-200 text-emerald-900" : "bg-slate-100 text-slate-800"}`}
                    onClick={() => paymentKeypadPress(key)}
                  >
                    {key}
                  </button>
                ))}

                <button
                  className="col-span-3 rounded bg-indigo-600 px-2 py-4 text-xl font-bold text-white"
                  onClick={applyPaymentLine}
                >
                  Add / Update {paymentMethod}
                </button>
                <button
                  className="col-span-1 rounded bg-rose-200 px-2 py-4 text-2xl font-semibold text-rose-800"
                  onClick={() => paymentKeypadPress("C")}
                >
                  Clear
                </button>

                <button
                  className="col-span-4 rounded bg-slate-200 px-2 py-4 text-2xl font-semibold text-slate-800"
                  onClick={() => {
                    setPaymentModalOpen(false);
                    setPaymentModalError("");
                  }}
                >
                  Back
                </button>
              </div>
            </div>

            <div className="flex flex-col bg-slate-50 p-3">
              <div className="flex-1">
                <div className="text-center">
                  <p className="text-3xl text-slate-500">{paymentMethod}</p>
                  <p className="mt-3 text-7xl leading-none text-slate-900">
                    ₹ {money(paymentAmount)}
                  </p>
                </div>

                <div className="mx-auto mt-10 max-w-3xl space-y-3">
                  {paymentLines.length === 0 ? (
                    <p className="text-center text-lg text-slate-500">
                      No payment lines yet. Add a payment mode from the left.
                    </p>
                  ) : null}

                  {paymentLines.map((line) => (
                    <div
                      key={line.mode}
                      className="flex items-center justify-between rounded-lg border border-cyan-200 bg-cyan-50 px-5 py-4"
                    >
                      <p className="text-4xl text-slate-800">
                        {line.mode === "WALLET"
                          ? "Customer Account"
                          : line.mode}
                      </p>
                      <div className="flex items-center gap-6">
                        <p className="text-4xl text-slate-700">
                          ₹ {money(line.amount)}
                        </p>
                        <button
                          className="text-4xl font-bold text-rose-600"
                          onClick={() => removePaymentLine(line.mode)}
                          title="Remove payment line"
                        >
                          ×
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              <div className="mt-8 border-t border-slate-200 pt-5">
                <div className="flex items-center justify-between text-3xl">
                  <p className="text-emerald-600">Remaining</p>
                  <p className="text-emerald-500">₹ {money(remainingAmount)}</p>
                </div>
              </div>

              <button
                className="mt-2 w-full rounded bg-emerald-600 px-3 py-4 text-2xl font-bold text-white disabled:bg-emerald-300"
                onClick={() => {
                  if (!currentInvoice) return;
                  settleInvoice.mutate({
                    invoiceId: currentInvoice.id,
                    payments: paymentLines,
                  });
                }}
                disabled={
                  settleInvoice.isPending ||
                  !currentInvoice ||
                  paymentLines.length === 0 ||
                  !paymentMatchesPending
                }
              >
                Validate
              </button>

              {paymentLines.length > 0 && !paymentMatchesPending ? (
                <p className="mt-2 text-sm text-rose-700">
                  Payment total must be exactly ₹ {money(pendingAmount)}.
                  Current: ₹ {money(totalPaid)}.
                </p>
              ) : null}
              {paymentModalError ? (
                <p className="mt-2 text-sm text-rose-700">
                  {paymentModalError}
                </p>
              ) : null}
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}
