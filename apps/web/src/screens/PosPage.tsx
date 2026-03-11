import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { API_BASE_URL, api, authHeaders } from "../lib/api";
import {
  buildReceiptLines,
  formatReceiptDate,
  formatReceiptTime,
  resolveReceiptWidth,
} from "../lib/receiptFormat";
import { money, requireSession } from "./route-helpers";

type CartLine = {
  itemId: string;
  name: string;
  qty: number;
  rate: number;
  discountAmount: number;
  taxRate: number;
  taxMode: "INCLUSIVE" | "EXCLUSIVE";
  imageUrl?: string | null;
};

type PostPaymentSummary = {
  invoiceNo: string;
  receiptNo: string;
  createdAt: string;
  customerName: string;
  customerPhone: string;
  subTotal: number;
  taxTotal: number;
  grandTotal: number;
  paymentLines: Array<{ mode: "CASH" | "CARD" | "WALLET"; amount: number }>;
  lines: CartLine[];
};

export function PosPage() {
  const session = requireSession();
  const queryClient = useQueryClient();
  const [customerId, setCustomerId] = useState("");
  const [cart, setCart] = useState<CartLine[]>([]);
  const [search, setSearch] = useState("");
  const [activeCategory, setActiveCategory] = useState("All");
  const [customerModalOpen, setCustomerModalOpen] = useState(false);
  const [customerPhoneQuery, setCustomerPhoneQuery] = useState("");
  const [newCustomerName, setNewCustomerName] = useState("");
  const [customerModalError, setCustomerModalError] = useState("");
  const [paymentModalOpen, setPaymentModalOpen] = useState(false);
  const [paymentMethod, setPaymentMethod] = useState<
    "CASH" | "CARD" | "WALLET"
  >("CASH");
  const [paymentAmount, setPaymentAmount] = useState("0");
  const [paymentLines, setPaymentLines] = useState<
    Array<{ mode: "CASH" | "CARD" | "WALLET"; amount: number }>
  >([]);
  const [paymentModalError, setPaymentModalError] = useState("");
  const [message, setMessage] = useState("");
  const [postPayment, setPostPayment] = useState<PostPaymentSummary | null>(
    null,
  );
  const printableSaleLines = postPayment?.lines ?? [];
  const printableSubtotal = postPayment?.subTotal ?? 0;
  const printableTaxTotal = postPayment?.taxTotal ?? 0;
  const printableGrandTotal = postPayment?.grandTotal ?? 0;
  const [receiptContact, setReceiptContact] = useState("");

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

  const invoiceHeaderLines = useMemo(() => {
    const raw = branchSettings.data?.invoiceHeader ?? "";
    return raw
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean);
  }, [branchSettings.data?.invoiceHeader]);

  const invoiceFooterLines = useMemo(() => {
    const raw = branchSettings.data?.invoiceFooter ?? "";
    return raw
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean);
  }, [branchSettings.data?.invoiceFooter]);

  const receiptFooterLines = useMemo(() => {
    const raw = branchSettings.data?.receiptFooter ?? "";
    return raw
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean);
  }, [branchSettings.data?.receiptFooter]);

  const invoiceLogoSrc = useMemo(() => {
    const logoUrl = branchSettings.data?.logoUrl;
    if (!logoUrl) return null;
    if (logoUrl.startsWith("http://") || logoUrl.startsWith("https://")) {
      return logoUrl;
    }
    return `${API_BASE_URL.replace(/\/$/, "")}${logoUrl.startsWith("/") ? "" : "/"}${logoUrl}`;
  }, [branchSettings.data?.logoUrl]);

  const receiptCharWidth = resolveReceiptWidth(
    branchSettings.data?.invoiceCss,
    48,
  );
  const receiptTemplateCss = `
    #printable-invoice {
      font-family: "Courier New", Courier, monospace;
      --receipt-ch: ${receiptCharWidth};
      width: calc(var(--receipt-ch) * 1ch);
      max-width: 100%;
      margin: 0 auto;
      color: #111827;
    }
    #printable-invoice .receipt-line {
      white-space: pre;
      font-size: 12px;
      line-height: 1.25;
    }
    #printable-invoice .receipt-strong {
      font-weight: 700;
    }
    #printable-invoice .receipt-logo {
      display: block;
      margin: 0 auto 6px;
      max-height: 64px;
      max-width: 100%;
      object-fit: contain;
    }
  `;

  const printableInvoice = useMemo(() => {
    if (!postPayment) return null;

    const createdAt = postPayment.createdAt;
    const metadata = [
      { label: "Invoice", value: postPayment.invoiceNo },
      { label: "Receipt", value: postPayment.receiptNo },
      { label: "Date", value: formatReceiptDate(createdAt) },
      { label: "Time", value: formatReceiptTime(createdAt) },
      { label: "Cashier", value: session.username },
      { label: "Customer", value: postPayment.customerName },
    ];

    const items = printableSaleLines.map((line) => {
      const net = computeLineAmounts(line);
      const unitPrice = line.rate ?? (net.net / line.qty || 0);
      const taxLabel =
        line.taxRate > 0
          ? `@${line.taxRate}% ${line.taxMode === "INCLUSIVE" ? "Incl." : "Excl."}`
          : "";
      return {
        name: line.name,
        subLine: taxLabel || undefined,
        qty: line.qty,
        price: unitPrice,
        total: net.net,
      };
    });

    const totals = [
      { label: "Subtotal", value: money(printableSubtotal) },
      { label: "Tax", value: money(printableTaxTotal) },
      { label: "TOTAL", value: money(printableGrandTotal), isGrandTotal: true },
    ];

    const payments = postPayment.paymentLines.map((line) => ({
      label: `Paid ${line.mode}`,
      value: money(line.amount),
    }));

    const footerLines =
      invoiceFooterLines.length > 0 ? invoiceFooterLines : receiptFooterLines;

    return buildReceiptLines({
      width: receiptCharWidth,
      storeName: branchSettings.data?.name ?? "Store",
      headerLines: invoiceHeaderLines,
      metadata,
      items,
      totals,
      payments,
      footerLines,
    });
  }, [
    postPayment,
    printableSaleLines,
    printableSubtotal,
    printableTaxTotal,
    printableGrandTotal,
    invoiceHeaderLines,
    invoiceFooterLines,
    receiptFooterLines,
    branchSettings.data?.name,
    session.username,
    receiptCharWidth,
  ]);

  const buildPrintableInvoiceDocument = () => {
    if (!postPayment) {
      return null;
    }
    const invoiceElement = document.getElementById("printable-invoice");
    if (!invoiceElement) {
      return null;
    }
    const customCss = branchSettings.data?.invoiceCss ?? "";
    return `<!doctype html><html><head><meta charset="utf-8"><title>Invoice ${postPayment.invoiceNo}</title><style>body{font-family:\"Courier New\",Courier,monospace;margin:0;padding:24px;background:#fff;color:#111827;}@media print{body{margin:0;}}${receiptTemplateCss}${customCss}</style></head><body>${invoiceElement.outerHTML}</body></html>`;
  };

  const exportPrintableInvoice = () => {
    const htmlDocument = buildPrintableInvoiceDocument();
    if (!htmlDocument) {
      setMessage("Printable invoice is not ready to download yet.");
      return;
    }

    const blob = new Blob([htmlDocument], { type: "text/html" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `invoice-${postPayment?.invoiceNo ?? "receipt"}.html`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);

    if (receiptContact.trim()) {
      setMessage(
        `Invoice download ready for sharing via WhatsApp (${receiptContact.trim()}).`,
      );
    } else {
      setMessage("Invoice download started. Share it on WhatsApp manually.");
    }
  };

  const items = useQuery({
    queryKey: ["items-pos"],
    queryFn: async () => {
      const res = await api.items.list({ query: { activeOnly: true } });
      if (res.status !== 200) throw new Error("Failed to load items");
      return res.body;
    },
  });

  const customers = useQuery({
    queryKey: ["customers-pos", session.branchId],
    queryFn: async () => {
      const res = await api.customers.list({
        query: { branchId: session.branchId },
      });
      if (res.status !== 200) throw new Error("Failed to load customers");
      return res.body;
    },
  });

  const walkIn = useQuery({
    queryKey: ["walk-in", session.branchId],
    queryFn: async () => {
      const res = await api.customers.getWalkIn({
        params: { branchId: session.branchId },
      });
      if (res.status !== 200)
        throw new Error("Failed to load walk-in customer");
      return res.body;
    },
  });

  function computeLineAmounts(
    line: Pick<
      CartLine,
      "qty" | "rate" | "discountAmount" | "taxRate" | "taxMode"
    >,
  ) {
    const gross = line.qty * line.rate;
    const afterDiscount = gross - line.discountAmount;
    if (line.taxMode === "INCLUSIVE") {
      const taxable =
        line.taxRate > 0
          ? (afterDiscount * 100) / (100 + line.taxRate)
          : afterDiscount;
      const tax = afterDiscount - taxable;
      return { taxable, tax, net: afterDiscount };
    }
    const tax = (afterDiscount * line.taxRate) / 100;
    return { taxable: afterDiscount, tax, net: afterDiscount + tax };
  }

  const addItem = (item: {
    id: string;
    name: string;
    sellPrice: number | string;
    taxRate: number | string;
    taxMode?: "INCLUSIVE" | "EXCLUSIVE";
    imageUrl?: string | null;
  }) => {
    const rate = Number(item.sellPrice) || 0;
    const taxRate = Number(item.taxRate) || 0;
    const taxMode = item.taxMode ?? "EXCLUSIVE";
    setCart((prev) => {
      const idx = prev.findIndex((l) => l.itemId === item.id);
      if (idx === -1) {
        return [
          ...prev,
          {
            itemId: item.id,
            name: item.name,
            qty: 1,
            rate,
            discountAmount: 0,
            taxRate,
            taxMode,
            imageUrl: item.imageUrl,
          },
        ];
      }
      const next = [...prev];
      next[idx] = { ...next[idx], qty: next[idx].qty + 1 };
      return next;
    });
  };

  const total = useMemo(() => {
    return cart.reduce((acc, line) => {
      const { net } = computeLineAmounts(line);
      return acc + net;
    }, 0);
  }, [cart]);

  const totalTax = useMemo(() => {
    return cart.reduce((acc, line) => {
      const { tax } = computeLineAmounts(line);
      return acc + tax;
    }, 0);
  }, [cart]);

  const totalItems = useMemo(
    () => cart.reduce((acc, line) => acc + line.qty, 0),
    [cart],
  );

  const categories = useMemo(() => {
    const set = new Set<string>();
    for (const item of items.data ?? []) {
      set.add(item.category || "Uncategorized");
    }
    return ["All", ...Array.from(set)];
  }, [items.data]);

  const filteredItems = useMemo(() => {
    const keyword = search.trim().toLowerCase();
    return (items.data ?? []).filter((item) => {
      const category = item.category || "Uncategorized";
      const categoryMatch =
        activeCategory === "All" || category === activeCategory;
      const textMatch =
        keyword.length === 0 ||
        item.name.toLowerCase().includes(keyword) ||
        item.code.toLowerCase().includes(keyword) ||
        category.toLowerCase().includes(keyword);
      return categoryMatch && textMatch;
    });
  }, [items.data, search, activeCategory]);

  const matchingCustomers = useMemo(() => {
    const q = customerPhoneQuery.trim();
    if (!q) return [];
    return (customers.data ?? []).filter((c) => (c.phone ?? "").includes(q));
  }, [customers.data, customerPhoneQuery]);

  const selectedCustomer = useMemo(() => {
    if (!customerId) return walkIn.data;
    return (
      (customers.data ?? []).find((c) => c.id === customerId) ?? walkIn.data
    );
  }, [customerId, customers.data, walkIn.data]);

  const isWalkInSelected = !customerId || !!selectedCustomer?.isWalkIn;

  const customerWallet = useQuery({
    queryKey: ["customer-wallet", customerId],
    enabled: !!customerId,
    queryFn: async () => {
      const res = await api.customers.getWallet({ params: { id: customerId } });
      if (res.status !== 200) throw new Error("Failed to load customer wallet");
      return res.body;
    },
  });

  const availablePaymentMethods = useMemo<
    Array<{ key: "CASH" | "CARD" | "WALLET"; label: string }>
  >(() => {
    if (isWalkInSelected) {
      return [
        { key: "CASH", label: "Cash" },
        { key: "CARD", label: "Card" },
      ];
    }
    return [
      { key: "CASH", label: "Cash" },
      { key: "CARD", label: "Card" },
      { key: "WALLET", label: "Customer Wallet" },
    ];
  }, [isWalkInSelected]);

  useEffect(() => {
    if (isWalkInSelected) {
      setPaymentLines((prev) => prev.filter((line) => line.mode !== "WALLET"));
      if (paymentMethod === "WALLET") setPaymentMethod("CASH");
    }
  }, [isWalkInSelected, paymentMethod]);

  const openPayment = () => {
    if (cart.length === 0) {
      setMessage("Cart is empty");
      return;
    }
    setPaymentMethod("CASH");
    setPaymentAmount(money(total));
    setPaymentLines([]);
    setPaymentModalError("");
    setPaymentModalOpen(true);
  };

  const startNewOrder = () => {
    setPostPayment(null);
    setMessage("");
    setReceiptContact("");
    setCart([]);
    setPaymentAmount("0");
    setPaymentLines([]);
    setPaymentModalError("");
    setPaymentModalOpen(false);
  };

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
    if (paymentMethod === "WALLET") {
      const balance = Number(customerWallet.data?.balance ?? 0);
      if (amount > balance) {
        setPaymentModalError(
          `Wallet balance is insufficient. Available: ₹ ${money(balance)}`,
        );
        return;
      }
    }
    setPaymentModalError("");
    setPaymentLines((prev) => {
      const withoutCurrent = prev.filter((line) => line.mode !== paymentMethod);
      if (isWalkInSelected) {
        const paidWithoutCurrent = withoutCurrent.reduce(
          (acc, line) => acc + line.amount,
          0,
        );
        const maxAllowedForCurrent = total - paidWithoutCurrent;
        if (amount > maxAllowedForCurrent + 0.0001) {
          setPaymentModalError(
            `Amount exceeds remaining. You can add up to ₹ ${money(maxAllowedForCurrent)}`,
          );
          return prev;
        }
      }

      const next = [...withoutCurrent, { mode: paymentMethod, amount }];
      const nextPaid = next.reduce((acc, line) => acc + line.amount, 0);
      const nextRemaining = Math.max(0, total - nextPaid);
      setPaymentAmount(money(nextRemaining));
      return next;
    });
  };

  const removePaymentLine = (mode: "CASH" | "CARD" | "WALLET") => {
    setPaymentLines((prev) => prev.filter((line) => line.mode !== mode));
  };

  const totalPaid = useMemo(
    () => paymentLines.reduce((acc, line) => acc + line.amount, 0),
    [paymentLines],
  );
  const remainingAmount = useMemo(
    () => Math.max(0, total - totalPaid),
    [total, totalPaid],
  );
  const walletBalance = Number(customerWallet.data?.balance ?? 0);
  const walletLineAmount = useMemo(
    () =>
      paymentLines
        .filter((line) => line.mode === "WALLET")
        .reduce((acc, line) => acc + line.amount, 0),
    [paymentLines],
  );
  const walletOverused = walletLineAmount > walletBalance;
  const paymentMatchesTotal = Math.abs(totalPaid - total) < 0.005;
  const excessAmount = useMemo(
    () => Math.max(0, totalPaid - total),
    [totalPaid, total],
  );
  const paymentCanValidate = isWalkInSelected
    ? paymentLines.length > 0 && paymentMatchesTotal
    : paymentLines.length > 0;

  const createInvoice = async () => {
    if (cart.length === 0) throw new Error("Cart is empty");

    const selected = customerId || walkIn.data?.id;
    if (!selected) throw new Error("Customer not resolved");

    const createRes = await api.sales.create({
      body: {
        branchId: session.branchId,
        customerId: selected,
        lines: cart.map((line) => {
          const conversionFactor =
            line.taxMode === "INCLUSIVE" && line.taxRate > 0
              ? 100 / (100 + line.taxRate)
              : 1;
          return {
            itemId: line.itemId,
            qty: line.qty,
            rate: line.rate * conversionFactor,
            discountAmount: line.discountAmount * conversionFactor,
            taxRate: line.taxRate,
          };
        }),
      },
      extraHeaders: authHeaders(),
    });

    if (createRes.status !== 201) {
      throw new Error("Failed to create invoice");
    }

    return createRes.body;
  };

  const saveDraft = useMutation({
    mutationFn: async () => createInvoice(),
    onSuccess: (invoice) => {
      setCart([]);
      setMessage(
        `Draft saved: ${invoice.invoiceNo}. Open Sales module to settle later.`,
      );
      queryClient.invalidateQueries({
        queryKey: ["sales-module", session.branchId],
      });
    },
  });

  const checkout = useMutation({
    mutationFn: async (payload: {
      payments: Array<{ mode: "CASH" | "CARD" | "WALLET"; amount: number }>;
      cartSnapshot: CartLine[];
    }) => {
      const invoice = await createInvoice();
      const finalPayments =
        payload.payments.length > 0
          ? payload.payments
          : [{ mode: "CASH" as const, amount: Number(invoice.grandTotal) }];

      const settleRes = await api.sales.settle({
        params: { id: invoice.id },
        body: { payments: finalPayments },
        extraHeaders: authHeaders(),
      });

      if (settleRes.status !== 200) {
        throw new Error(
          `Invoice ${invoice.invoiceNo} created but settlement failed`,
        );
      }

      return {
        invoice: settleRes.body.invoice,
        receipt: settleRes.body.receipt,
        cartSnapshot: payload.cartSnapshot,
      };
    },
    onSuccess: (result) => {
      const selected = selectedCustomer ?? walkIn.data;
      const customerName = selected?.name ?? "Walk In";
      const customerPhone = selected?.phone ?? "";
      setPostPayment({
        invoiceNo: result.invoice.invoiceNo,
        receiptNo: result.receipt.receiptNo,
        createdAt: result.receipt.createdAt,
        customerName,
        customerPhone,
        subTotal: Number(result.invoice.subTotal),
        taxTotal: Number(result.invoice.taxTotal),
        grandTotal: Number(result.invoice.grandTotal),
        paymentLines: result.invoice.payments.map((line) => ({
          mode: line.mode,
          amount: Number(line.amount),
        })),
        lines: result.cartSnapshot,
      });
      setReceiptContact(customerPhone);
      setCart([]);
      setPaymentAmount("0");
      setPaymentLines([]);
      setPaymentModalOpen(false);
      setMessage(
        `Done: ${result.invoice.invoiceNo}, Receipt: ${result.receipt.receiptNo}, Status: ${result.invoice.status}`,
      );
      queryClient.invalidateQueries({
        queryKey: ["sales-module", session.branchId],
      });
      queryClient.invalidateQueries({
        queryKey: ["stock-module", session.branchId],
      });
    },
  });

  const createCustomerFromModal = useMutation({
    mutationFn: async () => {
      const phone = customerPhoneQuery.trim();
      const name = newCustomerName.trim() || `Customer ${phone}`;
      if (!phone) throw new Error("Phone number is required");

      const res = await api.customers.create({
        body: { branchId: session.branchId, name, phone },
        extraHeaders: authHeaders(),
      });
      if (res.status !== 201) throw new Error("Failed to create customer");
      return res.body;
    },
    onSuccess: (customer) => {
      queryClient.invalidateQueries({
        queryKey: ["customers-pos", session.branchId],
      });
      setCustomerId(customer.id);
      setCustomerModalOpen(false);
      setCustomerPhoneQuery("");
      setNewCustomerName("");
      setCustomerModalError("");
    },
    onError: (error) => {
      setCustomerModalError((error as Error).message);
    },
  });

  return (
    <section className="grid h-[calc(100vh-48px)] grid-cols-1 xl:grid-cols-[390px_1fr]">
      <style>{`
        @media print {
          body * {
            visibility: hidden !important;
          }

          #printable-invoice,
          #printable-invoice * {
            visibility: visible !important;
          }

          #printable-invoice {
            position: absolute;
            inset: 0;
            margin: 0;
            width: 100%;
            max-width: none;
            border: none;
            border-radius: 0;
            box-shadow: none;
            padding: 16px;
            -webkit-print-color-adjust: exact;
            print-color-adjust: exact;
          }
        }
        ${receiptTemplateCss}
        ${branchSettings.data?.invoiceCss ?? ""}
      `}</style>
      <aside className="flex h-full flex-col overflow-hidden bg-white">
        {postPayment ? (
          <>
            <div className="flex-1 space-y-4 overflow-y-auto border-b border-slate-200 p-3">
              <div className="rounded-lg border border-emerald-300 bg-emerald-100 p-4 text-center">
                <div className="mx-auto mb-2 grid h-12 w-12 place-items-center rounded-full bg-emerald-600 text-2xl font-bold text-white">
                  ✓
                </div>
                <p className="text-4xl font-semibold text-emerald-700">
                  Payment Successful
                </p>
                <div className="mt-2 flex items-center justify-center gap-3">
                  <p className="text-3xl font-bold text-emerald-800">
                    ₹ {money(postPayment.grandTotal)}
                  </p>
                  <button
                    className="rounded bg-emerald-500 px-3 py-1 text-sm font-semibold text-white"
                    onClick={() =>
                      setMessage("Payment already settled. Start a new order.")
                    }
                  >
                    Edit Payment
                  </button>
                </div>
              </div>

              <button
                className="w-full rounded border border-slate-200 bg-slate-50 px-4 py-4 text-3xl text-slate-700 print:hidden"
                onClick={() => window.print()}
              >
                Print Full Receipt
              </button>

              <div className="flex overflow-hidden rounded border border-slate-300">
                <input
                  className="w-full px-3 py-3 text-lg text-slate-700 outline-none"
                  placeholder="Send receipt to whatsapp"
                  value={receiptContact}
                  onChange={(e) => setReceiptContact(e.target.value)}
                />
                <button
                  className="w-20 bg-fuchsia-800 text-2xl text-white"
                  onClick={() => exportPrintableInvoice()}
                >
                  ➤
                </button>
              </div>
            </div>

            <button
              className="m-3 rounded bg-fuchsia-900 px-3 py-5 text-4xl font-semibold text-white"
              onClick={startNewOrder}
            >
              New Order
            </button>
          </>
        ) : (
          <>
            <div className="flex-1 overflow-y-scroll border-b border-slate-200">
              {cart.length === 0 ? (
                <p className="p-4 text-sm text-slate-500">
                  Add products from the right to start an order.
                </p>
              ) : null}
              {cart.map((line) => {
                const lineNet = computeLineAmounts(line).net;
                return (
                  <div
                    className="flex items-start justify-between border-b border-slate-100 px-3 py-2"
                    key={line.itemId}
                  >
                    <div className="flex gap-2">
                      <div className="h-12 w-12 shrink-0 overflow-hidden rounded bg-slate-100">
                        {line.imageUrl ? (
                          <img
                            src={line.imageUrl}
                            alt={line.name}
                            className="h-full w-full object-cover"
                          />
                        ) : null}
                      </div>
                      <div>
                        <p className="text-[20px] font-semibold leading-tight text-slate-800">
                          {line.name}
                        </p>
                        <p className="text-base text-slate-500">
                          {line.qty.toFixed(3)} x {money(line.rate)} / unit
                        </p>
                      </div>
                    </div>
                    <div className="text-right">
                      <p className="text-[26px] font-bold leading-none text-slate-800">
                        {money(lineNet)} ₹
                      </p>
                      <div className="mt-1 flex justify-end gap-1">
                        <button
                          className="h-7 w-7 rounded bg-slate-200 p-0 text-sm text-slate-700"
                          onClick={() =>
                            setCart((prev) =>
                              prev
                                .map((x) =>
                                  x.itemId === line.itemId
                                    ? { ...x, qty: Math.max(1, x.qty - 1) }
                                    : x,
                                )
                                .filter((x) => x.qty > 0),
                            )
                          }
                        >
                          -
                        </button>
                        <button
                          className="h-7 w-7 rounded bg-slate-200 p-0 text-sm text-slate-700"
                          onClick={() =>
                            setCart((prev) =>
                              prev.map((x) =>
                                x.itemId === line.itemId
                                  ? { ...x, qty: x.qty + 1 }
                                  : x,
                              ),
                            )
                          }
                        >
                          +
                        </button>
                        <button
                          className="h-7 w-7 rounded bg-rose-200 p-0 text-sm font-bold text-rose-700"
                          onClick={() =>
                            setCart((prev) =>
                              prev.filter((x) => x.itemId !== line.itemId),
                            )
                          }
                          title="Remove item"
                        >
                          x
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>

            <div className="border-b border-slate-200 px-3 py-4 text">
              <div className="flex items-center justify-between">
                <p className="text-xl text-slate-500">Taxes:</p>
                <p className="text-xl text-slate-500">{money(totalTax)} ₹</p>
              </div>
              <div className="flex items-center justify-between">
                <p className="text-3xl font-semibold leading-none text-slate-700">
                  Total:
                </p>
                <p className="text-3xl font-semibold leading-none text-slate-700">
                  {money(total)} ₹
                </p>
              </div>
            </div>

            <div className="p-2">
              <div className="rounded border border-slate-200 p-2">
                <div className="flex items-center justify-between">
                  <label className="text-sm text-slate-600">Customer</label>
                  <button
                    className="rounded bg-slate-200 px-2 py-1 text-xs font-semibold text-slate-700"
                    onClick={() => setCustomerId("")}
                    title="Reset to walk in customer"
                  >
                    Walk In
                  </button>
                </div>
                <button
                  className="mt-1 w-full rounded border border-slate-300 bg-slate-50 px-2 py-2 text-left text-sm font-semibold text-slate-700"
                  onClick={() => {
                    setCustomerModalOpen(true);
                    setCustomerModalError("");
                  }}
                >
                  {selectedCustomer
                    ? `${selectedCustomer.name} (${selectedCustomer.phone ?? "No phone"})`
                    : "Select Customer"}
                </button>
                {!isWalkInSelected ? (
                  <p className="mt-1 text-xs text-slate-600">
                    Account Balance: ₹{" "}
                    {money(customerWallet.data?.balance ?? 0)}
                  </p>
                ) : null}

                <button
                  className="mt-2 w-full rounded bg-emerald-600 px-2 py-2 text-xl font-bold text-white disabled:bg-emerald-300"
                  onClick={openPayment}
                  disabled={checkout.isPending || saveDraft.isPending}
                >
                  Payment
                </button>
              </div>
            </div>
          </>
        )}

        {saveDraft.error ? (
          <p className="px-3 pb-1 text-sm text-red-700">
            {(saveDraft.error as Error).message}
          </p>
        ) : null}
        {checkout.error ? (
          <p className="px-3 pb-1 text-sm text-red-700">
            {(checkout.error as Error).message}
          </p>
        ) : null}
        {message ? (
          <p className="px-3 pb-2 text-sm text-emerald-700">{message}</p>
        ) : null}
      </aside>

      <div className="bg-slate-100 p-6 print:bg-white print:p-0">
        {postPayment ? (
          <div className="grid min-h-full place-items-center">
            <div className="mx-auto grid w-full max-w-6xl gap-4 lg:grid-cols-[minmax(0,1fr)_420px]">
              <div className="space-y-4 rounded border border-slate-200 bg-white p-5 shadow-sm print:hidden">
                <p className="text-center text-3xl font-semibold text-fuchsia-800">
                  Payment summary
                </p>
                <div className="grid gap-2 text-sm text-slate-700 sm:grid-cols-2">
                  <p>
                    Invoice:{" "}
                    <span className="font-semibold">
                      {postPayment.invoiceNo}
                    </span>
                  </p>
                  <p>
                    Receipt:{" "}
                    <span className="font-semibold">
                      {postPayment.receiptNo}
                    </span>
                  </p>
                  <p>
                    Customer:{" "}
                    <span className="font-semibold">
                      {postPayment.customerName}
                    </span>
                  </p>
                  <p>
                    Phone:{" "}
                    <span className="font-semibold">
                      {postPayment.customerPhone || "—"}
                    </span>
                  </p>
                  <p className="sm:col-span-2 text-xs text-slate-500">
                    {new Date(postPayment.createdAt).toLocaleString()}
                  </p>
                </div>

                <div className="rounded border border-slate-200">
                  <div className="border-b border-slate-200 px-3 py-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
                    Items
                  </div>
                  <div className="space-y-2 px-3 py-3 text-sm text-slate-700">
                    {postPayment.lines.map((line) => {
                      const net = computeLineAmounts(line);
                      return (
                        <div
                          key={line.itemId}
                          className="flex items-start justify-between"
                        >
                          <p className="mr-3">
                            {line.qty.toFixed(0)} x {line.name}
                          </p>
                          <p>₹ {money(net.net)}</p>
                        </div>
                      );
                    })}
                  </div>
                </div>

                <div className="grid gap-2 text-sm text-slate-700 sm:grid-cols-2">
                  <div className="flex items-center justify-between rounded bg-slate-100 px-3 py-2">
                    <p>Subtotal</p>
                    <p>₹ {money(printableSubtotal)}</p>
                  </div>
                  <div className="flex items-center justify-between rounded bg-slate-100 px-3 py-2">
                    <p>Tax</p>
                    <p>₹ {money(printableTaxTotal)}</p>
                  </div>
                  <div className="flex items-center justify-between rounded bg-slate-100 px-3 py-2 sm:col-span-2">
                    <p className="font-semibold">Grand Total</p>
                    <p className="text-base font-semibold">
                      ₹ {money(printableGrandTotal)}
                    </p>
                  </div>
                </div>

                <div className="rounded border border-slate-200">
                  <div className="border-b border-slate-200 px-3 py-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
                    Payments
                  </div>
                  <div className="space-y-2 px-3 py-3 text-sm text-slate-700">
                    {postPayment.paymentLines.map((line, idx) => (
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

                <button
                  className="w-full rounded bg-emerald-600 px-3 py-3 text-base font-semibold text-white print:hidden"
                  onClick={() => window.print()}
                >
                  Print Invoice
                </button>
              </div>

              <div
                id="printable-invoice"
                className="w-full rounded border border-slate-200 bg-white p-6 shadow-sm"
              >
                {invoiceLogoSrc ? (
                  <img
                    src={invoiceLogoSrc}
                    alt="Branch logo"
                    className="receipt-logo"
                  />
                ) : null}
                <div className="receipt-text">
                  {(printableInvoice?.lines ?? []).map((line, idx) => (
                    <div
                      key={`${line.text}-${idx}`}
                      className={`receipt-line ${line.strong ? "receipt-strong" : ""}`}
                    >
                      {line.text}
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        ) : (
          <>
            <div className="flex items-center justify-between gap-2 border-b border-slate-200 p-2">
              <div className="flex flex-wrap gap-1">
                {categories.map((category) => (
                  <button
                    key={category}
                    className={`rounded px-3 py-2 text-sm font-semibold ${activeCategory === category ? "bg-emerald-600 text-white" : "bg-slate-100 text-slate-700"}`}
                    onClick={() => setActiveCategory(category)}
                  >
                    {category}
                  </button>
                ))}
              </div>
              <input
                className="w-full max-w-72 rounded-full border border-slate-300 px-4 py-2 text-sm"
                placeholder="Search Products"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>

            <div className="grid max-h-[calc(100vh-150px)] grid-cols-2 gap-2 overflow-auto p-2 sm:grid-cols-3 lg:grid-cols-4 2xl:grid-cols-6">
              {filteredItems.map((item) => (
                <button
                  key={item.id}
                  className="rounded border border-slate-200 bg-white p-2 text-left hover:bg-slate-50"
                  onClick={() => addItem(item)}
                >
                  <div className="mb-2 h-30 overflow-hidden rounded bg-slate-100">
                    {item.imageUrl ? (
                      <img
                        src={item.imageUrl}
                        alt={item.name}
                        className="h-full w-full object-scale-down"
                      />
                    ) : null}
                  </div>
                  <p className="truncate text-sm font-semibold text-slate-800">
                    {item.name}
                  </p>
                  <p className="truncate text-xs text-slate-500">{item.code}</p>
                  <p className="text-xs font-semibold text-indigo-700">
                    {money(item.sellPrice)} ₹
                  </p>
                </button>
              ))}
            </div>
          </>
        )}
      </div>

      {paymentModalOpen ? (
        <div className="fixed inset-0 z-40 grid place-items-center bg-slate-900/40 p-4">
          <div className="grid w-full max-w-6xl grid-cols-1 overflow-hidden rounded-xl border border-slate-300 bg-white shadow-2xl lg:grid-cols-[480px_1fr]">
            <div className="border-r border-slate-200 p-3">
              <div className="mb-3 grid gap-2">
                {availablePaymentMethods.map((method) => (
                  <button
                    key={method.key}
                    className={`rounded px-3 py-4 text-left text-3xl ${paymentMethod === method.key ? "bg-indigo-100 text-indigo-900" : "bg-slate-100 text-slate-700"}`}
                    onClick={() =>
                      setPaymentMethod(method.key as "CASH" | "CARD" | "WALLET")
                    }
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
                    ${money(paymentAmount)}
                  </p>
                  {paymentMethod === "WALLET" && !isWalkInSelected ? (
                    <p className="mt-4 text-2xl text-slate-600">
                      Wallet Balance: ₹ {money(walletBalance)}
                    </p>
                  ) : null}
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
                          $ {money(line.amount)}
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
                  <p className="text-emerald-500">$ {money(remainingAmount)}</p>
                </div>
              </div>

              <button
                className="mt-2 w-full rounded bg-emerald-600 px-3 py-4 text-2xl font-bold text-white disabled:bg-emerald-300"
                onClick={() =>
                  checkout.mutate({
                    payments: paymentLines,
                    cartSnapshot: cart,
                  })
                }
                disabled={
                  checkout.isPending || walletOverused || !paymentCanValidate
                }
              >
                Validate
              </button>

              {walletOverused ? (
                <p className="mt-2 text-sm text-rose-700">
                  Wallet payment exceeds available balance.
                </p>
              ) : null}

              {!walletOverused &&
              isWalkInSelected &&
              paymentLines.length > 0 &&
              !paymentMatchesTotal ? (
                <p className="mt-2 text-sm text-rose-700">
                  Walk-in payment must be exactly ₹ {money(total)}. Current: ₹{" "}
                  {money(totalPaid)}.
                </p>
              ) : null}
              {!walletOverused &&
              !isWalkInSelected &&
              paymentLines.length > 0 &&
              totalPaid < total ? (
                <p className="mt-2 text-sm text-amber-700">
                  Partial payment selected. Remaining due: ₹{" "}
                  {money(total - totalPaid)}.
                </p>
              ) : null}
              {!walletOverused &&
              !isWalkInSelected &&
              paymentLines.length > 0 &&
              excessAmount > 0 ? (
                <p className="mt-2 text-sm text-emerald-700">
                  Excess ₹ {money(excessAmount)} will be deposited to customer
                  wallet.
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

      {customerModalOpen ? (
        <div className="fixed inset-0 z-50 grid place-items-center bg-slate-900/40 p-4">
          <div className="w-full max-w-xl rounded-xl border border-slate-300 bg-white p-4 shadow-2xl">
            <div className="mb-3 flex items-center justify-between">
              <h3 className="text-xl font-semibold text-slate-900">
                Select or Create Customer
              </h3>
              <button
                className="rounded bg-slate-200 px-2 py-1 text-sm text-slate-700"
                onClick={() => {
                  setCustomerModalOpen(false);
                  setCustomerModalError("");
                }}
              >
                Close
              </button>
            </div>

            <label className="text-sm text-slate-600">Phone Number</label>
            <input
              className="mt-1 w-full rounded border border-slate-300 px-3 py-2"
              value={customerPhoneQuery}
              onChange={(e) => setCustomerPhoneQuery(e.target.value)}
              placeholder="Enter phone number"
            />

            <div className="mt-3 max-h-52 space-y-2 overflow-auto rounded border border-slate-200 p-2">
              {matchingCustomers.length === 0 ? (
                <p className="text-sm text-slate-500">
                  No matching customer found.
                </p>
              ) : null}
              {matchingCustomers.map((c) => (
                <button
                  key={c.id}
                  className="w-full rounded border border-slate-200 bg-slate-50 px-3 py-2 text-left hover:bg-slate-100"
                  onClick={() => {
                    setCustomerId(c.id);
                    setCustomerModalOpen(false);
                    setCustomerPhoneQuery("");
                    setNewCustomerName("");
                    setCustomerModalError("");
                  }}
                >
                  <p className="font-semibold text-slate-800">{c.name}</p>
                  <p className="text-xs text-slate-500">
                    {c.phone ?? "No phone"} | {c.code}
                  </p>
                </button>
              ))}
            </div>

            {customerPhoneQuery.trim() && matchingCustomers.length === 0 ? (
              <div className="mt-3 rounded border border-emerald-200 bg-emerald-50 p-3">
                <p className="text-sm font-semibold text-emerald-800">
                  Create new customer
                </p>
                <input
                  className="mt-2 w-full rounded border border-slate-300 px-3 py-2"
                  value={newCustomerName}
                  onChange={(e) => setNewCustomerName(e.target.value)}
                  placeholder="Customer name (optional)"
                />
                <button
                  className="mt-2 rounded bg-emerald-600 px-3 py-2 text-sm font-semibold text-white"
                  onClick={() => createCustomerFromModal.mutate()}
                  disabled={createCustomerFromModal.isPending}
                >
                  Create Customer
                </button>
              </div>
            ) : null}

            {customerModalError ? (
              <p className="mt-2 text-sm text-red-700">{customerModalError}</p>
            ) : null}
          </div>
        </div>
      ) : null}
    </section>
  );
}
