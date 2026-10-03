import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useSearch } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { sanitizeReceiptCss } from "@pos/contracts";
import { API_BASE_URL, api, apiErrorMessage, authHeaders } from "../lib/api";
import { useReceiptPrinting } from "../lib/printing";
import { branchReceiptTemplate, receiptStyleFor, renderReceipt, saleReceiptDocument } from "../lib/receipt";
import { invoiceGstOf, type InvoiceGst } from "../lib/gstReceipt";
import { formatReceiptDate } from "../lib/receiptFormat";
import { ReceiptView } from "../components/ReceiptView";
import { ReceiptPrintStyles } from "./pos/ReceiptPrintStyles";
import { IconCheck, IconPrinter, IconSend } from "../components/icons";
import { StatusBadge } from "../components/StatusBadge";
import { inr, money, requireOperationalSession } from "./route-helpers";

type PaymentMode = "CASH" | "CARD" | "WALLET";
type PaymentFilter = "ALL" | "PENDING" | "SETTLED";

type SettledSummary = {
  invoiceId: string;
  invoiceNo: string;
  createdBy: string;
  createdByName: string;
  receiptId: string;
  receiptNo: string;
  receiptAmount: number;
  createdAt: string;
  status: string;
  paidTotal: number;
  subTotal: number;
  taxTotal: number;
  grandTotal: number;
  lines: Array<{
    id: string;
    itemId: string;
    itemName: string;
    qty: number;
    rate: number;
    saleUom?: string | null;
    saleUomQty?: number | null;
    saleUomConversionQty?: number | null;
    discountAmount: number;
    itemDiscountAmount?: number;
    orderDiscountAmount?: number;
    taxMode?: "INCLUSIVE" | "EXCLUSIVE";
    taxRate: number;
    taxAmount: number;
    taxableAmount: number;
    netAmount: number;
    hsnCode?: string | null;
  }>;
  payments: Array<{ mode: PaymentMode; amount: number }>;
  gst: InvoiceGst;
};

export function SalesPage() {
  const session = requireOperationalSession();
  const salesSearch = useSearch({ from: "/sales" });
  const queryClient = useQueryClient();
  const formatSaleCreator = (createdBy: string, createdByName?: string) => {
    const name = createdByName?.trim() || "Unknown User";
    if (createdBy === session.userId) {
      return session.username?.trim() || name;
    }
    return name;
  };
  const formatQtyLabel = (qty: number) =>
    Number.isInteger(qty) ? qty.toFixed(0) : qty.toFixed(3);
  const getPricingQty = (line: { qty: number; saleUomQty?: number | null }) =>
    line.saleUomQty ?? line.qty;
  const getSaleQtyLabel = (line: {
    itemId: string;
    qty: number;
    saleUom?: string | null;
    saleUomQty?: number | null;
  }) => {
    const uom = line.saleUom ?? itemUomById.get(line.itemId);
    const qty = line.saleUom ? line.saleUomQty ?? getPricingQty(line) : line.qty;
    return uom ? `${formatQtyLabel(qty)} ${uom}` : formatQtyLabel(qty);
  };
  const getItemDiscountAmount = (
    line: {
      discountAllocations?: Array<{
        discountId: string;
        amount: number | string;
      }>;
    },
    discounts?: Array<{ id: string; scope: "ITEM" | "ORDER" }>,
  ) => {
    const itemDiscountIds = new Set(
      (discounts ?? [])
        .filter((discount) => discount.scope === "ITEM")
        .map((discount) => discount.id),
    );
    return (line.discountAllocations ?? []).reduce(
      (acc, allocation) =>
        itemDiscountIds.has(allocation.discountId)
          ? acc + Number(allocation.amount ?? 0)
          : acc,
      0,
    );
  };

  const [selectedInvoiceId, setSelectedInvoiceId] = useState("");
  const [paymentModalOpen, setPaymentModalOpen] = useState(false);
  const [paymentMethod, setPaymentMethod] = useState<PaymentMode>("CASH");
  const [paymentAmount, setPaymentAmount] = useState("0");
  const [paymentLines, setPaymentLines] = useState<
    Array<{ mode: PaymentMode; amount: number }>
  >([]);
  const [paymentModalError, setPaymentModalError] = useState("");
  const [message, setMessage] = useState("");
  const receiptPrinting = useReceiptPrinting();
  const [receiptContact, setReceiptContact] = useState("");
  const [selectedReceiptId, setSelectedReceiptId] = useState("");
  const [settledSummary, setSettledSummary] = useState<SettledSummary | null>(
    null,
  );
  const [searchQuery, setSearchQuery] = useState(salesSearch.q ?? "");
  const [statusFilter, setStatusFilter] = useState(salesSearch.status ?? "ALL");
  const [paymentFilter, setPaymentFilter] = useState<PaymentFilter>(
    salesSearch.paymentFilter ?? "ALL",
  );
  const linkedCustomerId = salesSearch.customerId ?? "";

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
      if (res.status !== 200)
        throw new Error("Failed to load business settings");
      return res.body;
    },
  });

  useEffect(() => {
    setSearchQuery(salesSearch.q ?? "");
    setStatusFilter(salesSearch.status ?? "ALL");
    setPaymentFilter(salesSearch.paymentFilter ?? "ALL");
  }, [salesSearch.paymentFilter, salesSearch.q, salesSearch.status]);

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

  const invoiceFooterLines = useMemo(() => {
    const raw = branchSettings.data?.invoiceFooter ?? "";
    return raw
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean);
  }, [branchSettings.data?.invoiceFooter]);

  const receiptLogoSrc = useMemo(() => {
    const logoUrl =
      branchSettings.data?.logoUrl ?? businessSettings.data?.logoUrl;
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

  const sales = useQuery({
    queryKey: ["sales-module", session.branchId],
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
    queryKey: ["items-sales"],
    queryFn: async () => {
      const res = await api.items.list({ extraHeaders: authHeaders() });
      if (res.status !== 200) throw new Error("Failed to load items");
      return res.body;
    },
  });

  const itemUomById = useMemo(() => {
    const map = new Map<string, string>();
    for (const item of items.data ?? []) {
      map.set(item.id, item.uom);
    }
    return map;
  }, [items.data]);

  const customers = useQuery({
    queryKey: ["customers-sales", session.branchId],
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
    enabled: !!selectedInvoiceId,
    queryFn: async () => {
      const res = await api.sales.getById({
        params: { id: selectedInvoiceId },
        extraHeaders: authHeaders(),
      });
      if (res.status !== 200) throw new Error("Failed to load invoice details");
      return res.body;
    },
  });

  const selectedReceipts = useQuery({
    queryKey: ["receipt-list-by-invoice-sales", selectedInvoiceId],
    enabled: !!selectedInvoiceId,
    queryFn: async () => {
      const res = await api.receipts.getByInvoice({
        params: { invoiceId: selectedInvoiceId },
        extraHeaders: authHeaders(),
      });
      if (res.status !== 200) return [];
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

  useEffect(() => {
    const receipts = selectedReceipts.data ?? [];
    if (!selectedInvoiceId || receipts.length === 0) {
      setSelectedReceiptId("");
      return;
    }
    const selectedStillExists = receipts.some(
      (receipt) => receipt.id === selectedReceiptId,
    );
    if (!selectedStillExists) {
      setSelectedReceiptId(receipts[0].id);
    }
  }, [selectedInvoiceId, selectedReceiptId, selectedReceipts.data]);

  const selectedInvoice = useMemo(() => {
    if (!selectedInvoiceId) return null;
    return (
      (sales.data ?? []).find((invoice) => invoice.id === selectedInvoiceId) ??
      null
    );
  }, [sales.data, selectedInvoiceId]);

  const currentInvoice = selectedInvoiceDetails.data ?? selectedInvoice;
  const currentSaleCreatorId =
    settledSummary?.createdBy ?? currentInvoice?.createdBy ?? "";
  const currentSaleCreatorName =
    settledSummary?.createdByName ?? currentInvoice?.createdByName ?? "";
  const currentCustomerName = currentInvoice?.customerName ?? "Walk-in";
  const selectedCustomer = useMemo(() => {
    if (!currentInvoice) return null;
    return (
      (customers.data ?? []).find(
        (customer) => customer.id === currentInvoice.customerId,
      ) ?? null
    );
  }, [currentInvoice, customers.data]);
  const isRegisteredCustomer = !!selectedCustomer && !selectedCustomer.isWalkIn;

  const linkedCustomer = useMemo(() => {
    if (!linkedCustomerId) return null;
    return (
      (customers.data ?? []).find((customer) => customer.id === linkedCustomerId) ??
      null
    );
  }, [customers.data, linkedCustomerId]);

  const customerWallet = useQuery({
    queryKey: ["customer-wallet-sales", selectedCustomer?.id],
    enabled: paymentModalOpen && isRegisteredCustomer && !!selectedCustomer?.id,
    queryFn: async () => {
      if (!selectedCustomer?.id) {
        throw new Error("No customer selected");
      }
      const res = await api.customers.getWallet({
        params: { id: selectedCustomer.id },
        extraHeaders: authHeaders(),
      });
      if (res.status !== 200) throw new Error("Failed to load customer wallet");
      return res.body;
    },
  });

  const availablePaymentMethods = useMemo<
    Array<{ key: PaymentMode; label: string }>
  >(() => {
    if (!isRegisteredCustomer) {
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
  }, [isRegisteredCustomer]);

  useEffect(() => {
    if (isRegisteredCustomer) return;
    setPaymentLines((prev) => prev.filter((line) => line.mode !== "WALLET"));
    if (paymentMethod === "WALLET") {
      setPaymentMethod("CASH");
    }
  }, [isRegisteredCustomer, paymentMethod]);

  const fallbackReceipt =
    settledSummary && settledSummary.invoiceId === selectedInvoiceId
      ? {
          id: settledSummary.receiptId,
          receiptNo: settledSummary.receiptNo,
          invoiceId: settledSummary.invoiceId,
          amount: settledSummary.receiptAmount,
          createdAt: settledSummary.createdAt,
        }
      : null;
  const receiptsForInvoice =
    (selectedReceipts.data ?? []).length > 0
      ? (selectedReceipts.data ?? [])
      : fallbackReceipt
        ? [fallbackReceipt]
        : [];
  const previewReceipt =
    receiptsForInvoice.find((receipt) => receipt.id === selectedReceiptId) ??
    receiptsForInvoice[0] ??
    null;
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
  const paymentCanSubmit =
    totalPaid > 0 &&
    totalPaid <= pendingAmount + 0.005 &&
    Math.abs(pendingAmount) >= 0.005;
  const walletBalance = Number(customerWallet.data?.balance ?? 0);
  const walletLineAmount = useMemo(
    () =>
      paymentLines
        .filter((line) => line.mode === "WALLET")
        .reduce((acc, line) => acc + line.amount, 0),
    [paymentLines],
  );
  const walletOverused = walletLineAmount > walletBalance;

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
      if (!isRegisteredCustomer) {
        setPaymentModalError(
          "Wallet payment is allowed only for registered customers.",
        );
        return;
      }
      if (customerWallet.isLoading) {
        setPaymentModalError("Loading wallet balance. Try again.");
        return;
      }
      if (customerWallet.isError) {
        setPaymentModalError("Failed to fetch wallet balance. Try again.");
        return;
      }
      if (amount > walletBalance + 0.0001) {
        setPaymentModalError(
          `Wallet balance is insufficient. Available: ${inr(walletBalance)}`,
        );
        return;
      }
    }

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
          `Amount exceeds remaining. You can add up to ${inr(maxAllowedForCurrent)}`,
        );
        return prev;
      }
      if (paymentMethod === "WALLET" && amount > walletBalance + 0.0001) {
        setPaymentModalError(
          `Wallet balance is insufficient. Available: ${inr(walletBalance)}`,
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

  const shouldIgnoreDialogKey = (event: KeyboardEvent) => {
    const target = event.target as HTMLElement | null;
    if (!target) return false;
    const tagName = target.tagName;
    return (
      target.isContentEditable ||
      tagName === "INPUT" ||
      tagName === "TEXTAREA" ||
      tagName === "SELECT"
    );
  };

  const keypadKeyFromEvent = (event: KeyboardEvent) => {
    if (/^\d$/.test(event.key)) return event.key;
    if (event.key === "." || event.key === "Decimal") return ".";
    if (event.key === "Backspace") return "<";
    if (event.key === "Delete" || event.key.toLowerCase() === "c") return "C";
    if (event.key === "-") return "+/-";
    return null;
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

  // Admins can cancel an unpaid draft (e.g. one left by a failed checkout); its stock goes back.
  const canCancelInvoice =
    session.role === "ADMIN" &&
    currentInvoice?.status === "DRAFT" &&
    Number(currentInvoice?.paidTotal ?? 0) === 0;

  const cancelInvoice = useMutation({
    mutationFn: async (invoiceId: string) => {
      const res = await api.sales.cancel({
        params: { id: invoiceId },
        extraHeaders: authHeaders(),
      });
      if (res.status !== 200) {
        throw new Error(apiErrorMessage(res.body, "Failed to cancel invoice"));
      }
      return res.body;
    },
    onSuccess: (invoice) => {
      setMessage(`Cancelled ${invoice.invoiceNo}; its stock is back on hand.`);
      queryClient.invalidateQueries({ queryKey: ["sales-module", session.branchId] });
      queryClient.invalidateQueries({ queryKey: ["sales-by-id", invoice.id] });
      queryClient.invalidateQueries({ queryKey: ["stock-module", session.branchId] });
    },
    onError: (error) => {
      setMessage((error as Error).message);
    },
  });

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
      if (res.status !== 200) {
        throw new Error(apiErrorMessage(res.body, "Failed to settle invoice"));
      }
      return res.body;
    },
    onSuccess: (result, payload) => {
      if (payload.payments.some((line) => line.mode === "CASH" && line.amount > 0)) {
        void receiptPrinting.openDrawer();
      }
      setSettledSummary({
        invoiceId: result.invoice.id,
        invoiceNo: result.invoice.invoiceNo,
        createdBy: result.invoice.createdBy,
        createdByName: result.invoice.createdByName,
        receiptId: result.receipt.id,
        receiptNo: result.receipt.receiptNo,
        receiptAmount: Number(result.receipt.amount),
        createdAt: result.receipt.createdAt,
        status: result.invoice.status,
        paidTotal: Number(result.invoice.paidTotal),
        subTotal: Number(result.invoice.subTotal),
        taxTotal: Number(result.invoice.taxTotal),
        grandTotal: Number(result.invoice.grandTotal),
        lines: result.invoice.lines.map((line) => ({
          id: line.id,
          itemId: line.itemId,
          qty: Number(line.qty),
          rate: Number(line.rate),
          saleUom: line.saleUom,
          saleUomQty:
            line.saleUomQty === null ? null : Number(line.saleUomQty ?? 0) || null,
          saleUomConversionQty:
            line.saleUomConversionQty === null
              ? null
              : Number(line.saleUomConversionQty ?? 0) || null,
          itemName: line.itemName,
          discountAmount: Number(line.discountAmount ?? 0),
          itemDiscountAmount: getItemDiscountAmount(
            line,
            result.invoice.discounts,
          ),
          orderDiscountAmount:
            Number(line.discountAmount ?? 0) -
            getItemDiscountAmount(line, result.invoice.discounts),
          taxMode: line.taxMode ?? "EXCLUSIVE",
          taxRate: Number(line.taxRate),
          taxAmount: Number(line.taxAmount ?? 0),
          taxableAmount: Number(line.taxableAmount ?? 0),
          netAmount: Number(line.netAmount),
          hsnCode: line.hsnCode ?? null,
        })),
        gst: invoiceGstOf(result.invoice),
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
      setSelectedReceiptId(result.receipt.id);
      setMessage(
        `${result.invoice.status === "SETTLED" ? "Settled" : "Payment recorded"}: ${result.invoice.invoiceNo}, Receipt: ${result.receipt.receiptNo}`,
      );
      queryClient.invalidateQueries({
        queryKey: ["sales-module", session.branchId],
      });
      queryClient.invalidateQueries({
        queryKey: ["sales-by-id", result.invoice.id],
      });
      queryClient.invalidateQueries({
        queryKey: ["receipt-list-by-invoice-sales", result.invoice.id],
      });
    },
  });

  useEffect(() => {
    if (!paymentModalOpen) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (shouldIgnoreDialogKey(event)) return;

      if (event.key === "Enter") {
        event.preventDefault();
        if (event.ctrlKey || event.metaKey) {
          if (
            !settleInvoice.isPending &&
            !walletOverused &&
            currentInvoice &&
            paymentLines.length > 0 &&
            paymentCanSubmit
          ) {
            settleInvoice.mutate({
              invoiceId: currentInvoice.id,
              payments: paymentLines,
            });
          }
          return;
        }
        applyPaymentLine();
        return;
      }
      if (event.key === "Escape") {
        event.preventDefault();
        setPaymentModalOpen(false);
        setPaymentModalError("");
        return;
      }

      const keypadKey = keypadKeyFromEvent(event);
      if (!keypadKey) return;
      event.preventDefault();
      paymentKeypadPress(keypadKey);
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [
    paymentModalOpen,
    applyPaymentLine,
    currentInvoice,
    paymentCanSubmit,
    paymentKeypadPress,
    paymentLines,
    settleInvoice,
    walletOverused,
  ]);

  const statusOptions = useMemo(() => {
    const statuses = new Set<string>();
    for (const invoice of sales.data ?? []) {
      if (invoice.status) statuses.add(invoice.status);
    }
    return ["ALL", ...Array.from(statuses).sort((a, b) => a.localeCompare(b))];
  }, [sales.data]);

  const filteredSales = useMemo(() => {
    let list = sales.data ?? [];
    if (linkedCustomerId) {
      list = list.filter((invoice) => invoice.customerId === linkedCustomerId);
    }
    if (paymentFilter !== "ALL") {
      list = list.filter((invoice) => {
        const pending =
          Number(invoice.grandTotal) - Number(invoice.paidTotal) > 0;
        return paymentFilter === "PENDING" ? pending : !pending;
      });
    }
    if (statusFilter !== "ALL") {
      list = list.filter((invoice) => invoice.status === statusFilter);
    }
      const query = searchQuery.trim().toLowerCase();
    if (!query) return list;
    return list.filter((invoice) => {
      const customerName = invoice.customerName?.toLowerCase() ?? "";
      const createdByNameRaw =
        invoice.createdByName?.trim() || invoice.createdBy || "";
      const createdByName =
        invoice.createdBy === session.userId
          ? session.username?.trim() || createdByNameRaw
          : createdByNameRaw;
      const haystack = [
        invoice.invoiceNo,
        invoice.status,
        invoice.createdBy,
        createdByName,
        customerName,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return haystack.includes(query);
    });
  }, [
    sales.data,
    linkedCustomerId,
    paymentFilter,
    statusFilter,
    searchQuery,
    session.userId,
    session.username,
  ]);

  const filteredPendingInvoices = useMemo(
    () =>
      filteredSales.filter(
        (invoice) => Number(invoice.grandTotal) - Number(invoice.paidTotal) > 0,
      ),
    [filteredSales],
  );

  useEffect(() => {
    if (!filteredSales.length) return;
    if (
      selectedInvoiceId &&
      filteredSales.some((invoice) => invoice.id === selectedInvoiceId)
    ) {
      return;
    }
    setSelectedInvoiceId(filteredSales[0].id);
  }, [filteredSales, selectedInvoiceId]);

  const saleLines =
    settledSummary?.lines ??
    selectedInvoiceDetails.data?.lines.map((line) => ({
      id: line.id,
      itemId: line.itemId,
      qty: Number(line.qty),
      rate: Number(line.rate),
      saleUom: line.saleUom,
      saleUomQty:
        line.saleUomQty === null ? null : Number(line.saleUomQty ?? 0) || null,
      saleUomConversionQty:
        line.saleUomConversionQty === null
          ? null
          : Number(line.saleUomConversionQty ?? 0) || null,
      itemName: line.itemName,
      discountAmount: Number(line.discountAmount ?? 0),
      itemDiscountAmount: getItemDiscountAmount(
        line,
        selectedInvoiceDetails.data?.discounts,
      ),
      orderDiscountAmount:
        Number(line.discountAmount ?? 0) -
        getItemDiscountAmount(line, selectedInvoiceDetails.data?.discounts),
      taxMode: line.taxMode ?? "EXCLUSIVE",
      taxRate: Number(line.taxRate),
      taxAmount: Number(line.taxAmount ?? 0),
      taxableAmount: Number(line.taxableAmount ?? 0),
      netAmount: Number(line.netAmount),
      hsnCode: line.hsnCode ?? null,
    })) ??
    [];

  const paymentBreakdown =
    settledSummary?.payments ??
    selectedInvoiceDetails.data?.payments.map((line) => ({
      mode: line.mode as PaymentMode,
      amount: Number(line.amount),
    })) ??
    [];

  const invoiceSubTotal =
    settledSummary?.subTotal ?? Number(currentInvoice?.subTotal ?? 0);
  const invoiceTaxTotal =
    settledSummary?.taxTotal ?? Number(currentInvoice?.taxTotal ?? 0);
  const invoiceGrandTotal =
    settledSummary?.grandTotal ?? Number(currentInvoice?.grandTotal ?? 0);
  const invoicePaidTotal =
    settledSummary?.paidTotal ?? Number(currentInvoice?.paidTotal ?? 0);

  const printableReceipt = useMemo(() => {
    if (!currentInvoice) return null;

    const createdAt =
      previewReceipt?.createdAt ??
      currentInvoice.createdAt ??
      new Date().toISOString();
    const cashier = currentSaleCreatorId
      ? formatSaleCreator(currentSaleCreatorId, currentSaleCreatorName)
      : "";

    const items = saleLines.map((line) => {
      const taxMode = line.taxMode ?? "EXCLUSIVE";
      const pricingQty = getPricingQty(line);
      const gross = pricingQty * line.rate;
      const taxAmount = Math.max(0, line.taxAmount ?? 0);
      const baseExclusive =
        taxMode === "INCLUSIVE" && Number(line.taxRate ?? 0) > 0
          ? (gross * 100) / (100 + Number(line.taxRate ?? 0))
          : gross;
      return {
        name: line.itemName ?? `Item ${line.itemId.slice(0, 6)}`,
        hsn: line.hsnCode ?? null,
        qty: pricingQty,
        qtyLabel: getSaleQtyLabel(line),
        rate: pricingQty > 0 ? baseExclusive / pricingQty : 0,
        amount: baseExclusive,
        taxRate: Number(line.taxRate ?? 0),
        taxAmount,
        discount: Math.max(0, line.itemDiscountAmount ?? line.discountAmount ?? 0),
        // Before the order discount, which is shown once under the items.
        total: Number(line.netAmount ?? 0) + Number(line.orderDiscountAmount ?? 0),
        taxable: Number(line.taxableAmount ?? 0),
      };
    });

    const doc = saleReceiptDocument({
      branding: {
        storeName: storeDisplayName,
        headerLines: receiptHeaderLines,
        footerLines: receiptFooterLines.length > 0 ? receiptFooterLines : invoiceFooterLines,
      },
      invoiceNo: currentInvoice.invoiceNo,
      receiptNo: previewReceipt?.receiptNo ?? null,
      createdAt,
      cashier,
      customer: currentInvoice.customerName ?? "",
      // The GST facts recorded on the invoice, never the current settings.
      gst: settledSummary?.gst ?? invoiceGstOf(currentInvoice),
      items,
      orderDiscount: Number(currentInvoice.orderDiscountAmount ?? 0),
      grandTotal: invoiceGrandTotal,
      payments: paymentBreakdown,
      paidTotal: invoicePaidTotal,
    });
    return renderReceipt(doc, receiptTemplate);
  }, [
    currentInvoice,
    previewReceipt?.receiptNo,
    previewReceipt?.createdAt,
    currentSaleCreatorId,
    currentSaleCreatorName,
    saleLines,
    itemUomById,
    invoiceGrandTotal,
    invoicePaidTotal,
    settledSummary?.gst,
    storeDisplayName,
    receiptHeaderLines,
    receiptFooterLines,
    invoiceFooterLines,
    receiptTemplate,
    paymentBreakdown,
    formatQtyLabel,
  ]);
  const receiptStyle = receiptStyleFor(printableReceipt ?? { columns: 48 }, receiptTemplate, customReceiptCss);

  return (
    <section className="grid grid-cols-1 xl:h-[calc(100vh-48px)] xl:grid-cols-[360px_1fr]">
      <ReceiptPrintStyles css={receiptStyle.css} />

      <aside className="flex h-full max-h-[75vh] flex-col overflow-hidden border-r border-slate-200 bg-white xl:max-h-none">
        {settledSummary ? (
          <>
            <div className="flex-1 space-y-4 overflow-y-auto p-4">
              <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-5 text-center">
                <div className="mx-auto mb-3 grid h-11 w-11 place-items-center rounded-full bg-emerald-600 text-white">
                  <IconCheck width={22} height={22} strokeWidth={2.5} />
                </div>
                <p className="text-sm font-semibold text-emerald-800">
                  {settledSummary.status === "SETTLED"
                    ? "Payment successful"
                    : "Payment recorded"}
                </p>
                <p className="mt-1 text-3xl font-semibold tracking-tight text-slate-900 tabular-nums">
                  {inr(settledSummary.receiptAmount)}
                </p>
                <p className="mt-1 text-xs text-slate-500">
                  {settledSummary.status === "SETTLED"
                    ? "Invoice settled"
                    : `Remaining ${inr(Math.max(0, settledSummary.grandTotal - settledSummary.paidTotal))}`}
                </p>
              </div>

              <div>
                <label className="field-label">Send receipt</label>
                <div className="flex gap-2">
                  <input
                    className="field"
                    placeholder="Email or phone"
                    value={receiptContact}
                    onChange={(e) => setReceiptContact(e.target.value)}
                  />
                  <button
                    className="btn-secondary shrink-0"
                    onClick={() => {
                      if (!receiptContact.trim()) {
                        setMessage("Enter email or phone to send receipt.");
                        return;
                      }
                      setMessage(`Receipt sent to ${receiptContact.trim()}`);
                    }}
                  >
                    <IconSend width={16} height={16} />
                    Send
                  </button>
                </div>
              </div>
            </div>

            <div className="border-t border-slate-200 p-4">
              <button className="btn-primary h-11 w-full" onClick={() => setSettledSummary(null)}>
                Back to Invoices
              </button>
            </div>
          </>
        ) : (
          <>
            <div className="border-b border-slate-200 p-4">
              <div className="grid grid-cols-2 gap-2">
                <div className="rounded-md border border-slate-200 px-3 py-2">
                  <p className="eyebrow">Pending</p>
                  <p className="mt-0.5 text-lg font-semibold text-amber-700 tabular-nums">
                    {filteredPendingInvoices.length}
                  </p>
                </div>
                <div className="rounded-md border border-slate-200 px-3 py-2">
                  <p className="eyebrow">Invoices</p>
                  <p className="mt-0.5 text-lg font-semibold text-slate-900 tabular-nums">
                    {filteredSales.length}
                  </p>
                </div>
              </div>
              <div className="mt-3 grid gap-2 text-sm">
                <input
                  className="field"
                  placeholder="Search by invoice, customer, status, or staff"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                />
                <div className="grid grid-cols-2 gap-2">
                  <select
                    className="field"
                    value={statusFilter}
                    onChange={(e) => setStatusFilter(e.target.value)}
                  >
                    {statusOptions.map((status) => (
                      <option key={status} value={status}>
                        {status === "ALL" ? "All Statuses" : status}
                      </option>
                    ))}
                  </select>
                  <select
                    className="field"
                    value={paymentFilter}
                    onChange={(e) =>
                      setPaymentFilter(e.target.value as PaymentFilter)
                    }
                  >
                    <option value="ALL">All Payments</option>
                    <option value="PENDING">Pending Only</option>
                    <option value="SETTLED">Settled Only</option>
                  </select>
                </div>
                {linkedCustomerId ? (
                  <div className="flex items-center justify-between gap-2 rounded border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
                    <span className="min-w-0 truncate">
                      Customer:{" "}
                      <span className="font-semibold">
                        {linkedCustomer?.name ?? "Selected customer"}
                      </span>
                    </span>
                    <Link
                      className="shrink-0 font-semibold text-amber-900 underline-offset-2 hover:underline"
                      search={{
                        paymentFilter:
                          paymentFilter === "ALL" ? undefined : paymentFilter,
                        q: searchQuery.trim() || undefined,
                        status: statusFilter === "ALL" ? undefined : statusFilter,
                      }}
                      to="/sales"
                    >
                      Clear
                    </Link>
                  </div>
                ) : null}
                <p className="text-xs text-slate-500">
                  Showing {filteredSales.length} of {(sales.data ?? []).length}
                </p>
              </div>
            </div>

            <div className="flex-1 space-y-2 overflow-y-auto bg-slate-50 p-3">
              {filteredSales.map((invoice) => {
                const pending =
                  Number(invoice.grandTotal) - Number(invoice.paidTotal);
                const isSelected = selectedInvoiceId === invoice.id;
                return (
                  <button
                    key={invoice.id}
                    className={`list-row ${isSelected ? "is-active" : ""}`}
                    onClick={() => {
                      setSelectedInvoiceId(invoice.id);
                      setMessage("");
                    }}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-semibold text-slate-900">
                          {invoice.invoiceNo}
                        </p>
                        <p className="mt-0.5 text-xs text-slate-500">
                          {formatReceiptDate(invoice.createdAt)} ·{" "}
                          {formatSaleCreator(
                            invoice.createdBy,
                            invoice.createdByName,
                          )}
                        </p>
                      </div>
                      <StatusBadge status={invoice.status} />
                    </div>
                    <div className="mt-2 flex items-center justify-between text-xs text-slate-500">
                      <p>
                        Total{" "}
                        <span className="font-semibold text-slate-900 tabular-nums">
                          {inr(Number(invoice.grandTotal))}
                        </span>
                      </p>
                      {pending > 0 && invoice.status !== "CANCELLED" ? (
                        <p className="font-medium text-amber-700 tabular-nums">Due {inr(pending)}</p>
                      ) : (
                        <p className="tabular-nums">Paid {inr(Number(invoice.paidTotal))}</p>
                      )}
                    </div>
                  </button>
                );
              })}
              {filteredSales.length === 0 ? (
                <div className="rounded-md border border-dashed border-slate-300 bg-white p-6 text-center text-sm text-slate-500">
                  No invoices match the current filters.
                </div>
              ) : null}
            </div>
          </>
        )}

        {settleInvoice.error ? (
          <p className="mx-4 mb-3 rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700" role="alert">
            {(settleInvoice.error as Error).message}
          </p>
        ) : null}
        {sales.error ? (
          <p className="mx-4 mb-3 rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700" role="alert">
            {(sales.error as Error).message}
          </p>
        ) : null}
        {selectedInvoiceDetails.error ? (
          <p className="mx-4 mb-3 rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700" role="alert">
            {(selectedInvoiceDetails.error as Error).message}
          </p>
        ) : null}
        {customers.error ? (
          <p className="mx-4 mb-3 rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700" role="alert">
            {(customers.error as Error).message}
          </p>
        ) : null}
        {receiptPrinting.error ? (
          <p className="mx-4 mb-3 rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700" role="alert">
            {receiptPrinting.error}
          </p>
        ) : null}
        {message ? (
          <p className="mx-4 mb-3 rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700" role="status">{message}</p>
        ) : null}
      </aside>

      <div className="flex h-full min-h-0 flex-col bg-slate-100 print:block print:bg-white print:p-0">
        <div className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-b border-slate-200 bg-white px-6 py-3 print:hidden">
          <div className="flex min-w-0 items-center gap-3">
            <h2 className="page-title truncate">
              {settledSummary?.invoiceNo ?? currentInvoice?.invoiceNo ?? "No invoice selected"}
            </h2>
            {currentInvoice ? <StatusBadge status={currentInvoice.status} /> : null}
          </div>
          <div className="flex items-center gap-2">
            {canCancelInvoice ? (
              <button
                className="btn-danger"
                disabled={cancelInvoice.isPending}
                onClick={() => {
                  if (!currentInvoice) return;
                  if (!window.confirm(`Cancel ${currentInvoice.invoiceNo}? Nothing has been paid; its stock will be put back.`)) return;
                  cancelInvoice.mutate(currentInvoice.id);
                }}
              >
                Cancel Invoice
              </button>
            ) : null}
            <button
              className="btn-secondary"
              disabled={receiptPrinting.busy}
              onClick={() =>
                void receiptPrinting.print(receiptStyle)
              }
            >
              <IconPrinter width={16} height={16} />
              {receiptPrinting.busy ? "Printing…" : "Print"}
            </button>
            <button
              className="btn-primary"
              onClick={openSettleModal}
              disabled={
                !currentInvoice ||
                pendingAmount <= 0 ||
                currentInvoice.status === "CANCELLED" ||
                settleInvoice.isPending
              }
            >
              Settle
            </button>
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto p-6 print:overflow-visible print:p-0">
        <div className="mx-auto grid w-full max-w-6xl items-start gap-6 lg:grid-cols-[minmax(0,1fr)_380px]">
          <div className="card overflow-hidden print:hidden">
            <dl className="grid grid-cols-2 gap-x-6 gap-y-4 border-b border-slate-200 p-5 text-sm 2xl:grid-cols-4">
              <div>
                <dt className="eyebrow">Customer</dt>
                <dd className="mt-1 truncate font-medium text-slate-900">{currentCustomerName}</dd>
              </div>
              <div>
                <dt className="eyebrow">Sold by</dt>
                <dd className="mt-1 truncate font-medium text-slate-900">
                  {currentSaleCreatorId
                    ? formatSaleCreator(
                        currentSaleCreatorId,
                        currentSaleCreatorName,
                      )
                    : "—"}
                </dd>
              </div>
              <div>
                <dt className="eyebrow">Grand total</dt>
                <dd className="mt-1 font-semibold text-slate-900 tabular-nums">{inr(invoiceGrandTotal)}</dd>
              </div>
              <div>
                <dt className="eyebrow">Balance due</dt>
                <dd className={`mt-1 font-semibold tabular-nums ${pendingAmount > 0 ? "text-amber-700" : "text-slate-900"}`}>
                  {inr(pendingAmount)}
                </dd>
              </div>
            </dl>

            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50 text-left">
                  <th className="eyebrow px-5 py-2 font-semibold">Item</th>
                  <th className="eyebrow px-5 py-2 text-right font-semibold">Amount</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {saleLines.map((line) => (
                  <tr key={line.id}>
                    <td className="px-5 py-2.5 text-slate-700">
                      <span className="font-medium text-slate-900">
                        {line.itemName ?? `Item ${line.itemId.slice(0, 6)}`}
                      </span>
                      <span className="ml-2 text-xs text-slate-500">
                        {getSaleQtyLabel(line)}
                        {line.saleUom ? ` (${formatQtyLabel(line.qty)} base)` : ""}
                      </span>
                    </td>
                    <td className="px-5 py-2.5 text-right text-slate-900 tabular-nums">{inr(line.netAmount)}</td>
                  </tr>
                ))}
                {saleLines.length === 0 ? (
                  <tr>
                    <td colSpan={2} className="px-5 py-4 text-center text-xs text-slate-500">
                      No line items available.
                    </td>
                  </tr>
                ) : null}
              </tbody>
              <tfoot className="border-t border-slate-200 text-slate-600">
                <tr>
                  <td className="px-5 pt-3 text-right">Subtotal</td>
                  <td className="px-5 pt-3 text-right tabular-nums">{inr(invoiceSubTotal)}</td>
                </tr>
                <tr>
                  <td className="px-5 pt-1 text-right">Tax</td>
                  <td className="px-5 pt-1 text-right tabular-nums">{inr(invoiceTaxTotal)}</td>
                </tr>
                <tr className="text-base font-semibold text-slate-900">
                  <td className="px-5 pt-2 pb-4 text-right">Grand total</td>
                  <td className="px-5 pt-2 pb-4 text-right tabular-nums">{inr(invoiceGrandTotal)}</td>
                </tr>
              </tfoot>
            </table>

            <div className="border-t border-slate-200 p-5">
              <p className="eyebrow">Payments</p>
              <div className="mt-2 divide-y divide-slate-100 text-sm">
                {paymentBreakdown.map((line, idx) => (
                  <div
                    key={`${line.mode}-${idx}`}
                    className="flex items-center justify-between py-1.5"
                  >
                    <p className="text-slate-700">{line.mode}</p>
                    <p className="font-medium text-slate-900 tabular-nums">{inr(line.amount)}</p>
                  </div>
                ))}
                {paymentBreakdown.length === 0 ? (
                  <p className="py-1.5 text-xs text-slate-500">
                    No payments recorded yet.
                  </p>
                ) : null}
              </div>
            </div>

            {receiptsForInvoice.length > 0 ? (
              <div className="border-t border-slate-200 p-5">
                <p className="eyebrow">Receipts</p>
                <div className="mt-2 grid gap-2 xl:grid-cols-2">
                  {receiptsForInvoice.map((receipt) => {
                    const isActive = previewReceipt?.id === receipt.id;
                    return (
                      <button
                        key={receipt.id}
                        className={`list-row text-xs ${isActive ? "is-active" : ""}`}
                        onClick={() => setSelectedReceiptId(receipt.id)}
                      >
                        <div className="flex items-center justify-between gap-2">
                          <p className="font-semibold text-slate-900">{receipt.receiptNo}</p>
                          <p className="font-semibold text-slate-900 tabular-nums">{inr(Number(receipt.amount))}</p>
                        </div>
                        <p className="mt-0.5 text-slate-500">{new Date(receipt.createdAt).toLocaleString()}</p>
                      </button>
                    );
                  })}
                </div>
              </div>
            ) : null}
          </div>

          <ReceiptView receipt={printableReceipt} logoSrc={receiptLogoSrc} className="card w-full p-5" />
        </div>
        </div>
      </div>

      {paymentModalOpen ? (
        <div className="modal-backdrop">
          <div className="grid max-h-[calc(100vh-2rem)] w-full max-w-6xl grid-cols-1 overflow-y-auto rounded-xl border border-slate-200 bg-white shadow-2xl md:grid-cols-2">
            <div className="flex flex-col bg-slate-50 p-6">
              <div className="flex-1">
                <div className="text-center">
                  <p className="eyebrow">{paymentMethod}</p>
                  <p className="mt-2 text-5xl font-semibold tracking-tight text-slate-900 tabular-nums">
                    {inr(paymentAmount)}
                  </p>
                  {paymentMethod === "WALLET" ? (
                    <p
                      className={`mt-2 text-sm ${isRegisteredCustomer && !customerWallet.isError ? "text-slate-600" : "text-rose-700"}`}
                    >
                      {!isRegisteredCustomer
                        ? "Wallet not available for walk-in customer."
                        : customerWallet.isLoading
                          ? "Loading wallet balance..."
                          : customerWallet.isError
                            ? "Failed to load wallet balance."
                            : `Wallet Balance: ${inr(walletBalance)}`}
                    </p>
                  ) : null}
                </div>

                <div className="mt-8 space-y-2">
                  {paymentLines.length === 0 ? (
                    <p className="rounded-md border border-dashed border-slate-300 px-4 py-6 text-center text-sm text-slate-500">
                      No payments added yet. Choose a method, enter an amount and press Add.
                    </p>
                  ) : null}

                  {paymentLines.map((line) => (
                    <div
                      key={line.mode}
                      className="flex items-center justify-between rounded-md border border-slate-200 bg-white px-4 py-3 shadow-xs"
                    >
                      <p className="text-sm font-semibold text-slate-800">
                        {line.mode === "WALLET"
                          ? "Customer Account"
                          : line.mode}
                      </p>
                      <div className="flex items-center gap-3">
                        <p className="text-base font-semibold text-slate-900 tabular-nums">
                          {inr(line.amount)}
                        </p>
                        <button
                          className="grid h-7 w-7 place-items-center rounded-md text-lg leading-none text-slate-400 hover:bg-rose-50 hover:text-rose-600"
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

              <div className="mt-6 border-t border-slate-200 pt-4">
                <div className="flex items-center justify-between">
                  <p className="text-sm font-medium text-slate-600">Remaining</p>
                  <p className="text-2xl font-semibold text-slate-900 tabular-nums">{inr(remainingAmount)}</p>
                </div>
              </div>

              <button
                className="btn-primary mt-4 h-12 w-full text-base"
                onClick={() => {
                  if (!currentInvoice) return;
                  settleInvoice.mutate({
                    invoiceId: currentInvoice.id,
                    payments: paymentLines,
                  });
                }}
                disabled={
                  settleInvoice.isPending ||
                  walletOverused ||
                  !currentInvoice ||
                  paymentLines.length === 0 ||
                  !paymentCanSubmit
                }
              >
                Validate
              </button>

              {walletOverused ? (
                <p className="mt-2 text-sm text-rose-700">
                  Wallet payment exceeds available balance.
                </p>
              ) : null}
              {paymentLines.length > 0 && totalPaid > pendingAmount + 0.005 ? (
                <p className="mt-2 text-sm text-rose-700">
                  Payment total cannot exceed {inr(pendingAmount)}.
                  Current: {inr(totalPaid)}.
                </p>
              ) : null}
              {paymentModalError ? (
                <p className="mt-2 text-sm text-rose-700">
                  {paymentModalError}
                </p>
              ) : null}
            </div>

            <div className="border-t border-slate-200 p-6 md:border-t-0 md:border-l">
              <div className="mb-4 grid grid-cols-2 gap-2">
                {availablePaymentMethods.map((method) => (
                  <button
                    key={method.key}
                    className={`rounded-md border px-3 py-3 text-left text-sm font-semibold transition-colors ${paymentMethod === method.key ? "border-brand-600 bg-brand-50 text-brand-700 ring-1 ring-brand-600" : "border-slate-200 bg-white text-slate-700 hover:bg-slate-50"}`}
                    onClick={() => setPaymentMethod(method.key)}
                  >
                    {method.label}
                  </button>
                ))}
              </div>

              <div className="grid grid-cols-4 gap-2">
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
                    className={`h-14 rounded-md border text-xl font-semibold tabular-nums transition-colors active:scale-[0.97] ${/^\+\d+$/.test(key) ? "border-brand-200 bg-brand-50 text-brand-700 hover:bg-brand-100" : "border-slate-200 bg-white text-slate-800 hover:bg-slate-50"}`}
                    onClick={() => paymentKeypadPress(key)}
                  >
                    {key}
                  </button>
                ))}

                <button
                  className="btn-primary col-span-3 h-14 text-base"
                  onClick={applyPaymentLine}
                >
                  Add / Update {paymentMethod}
                </button>
                <button
                  className="btn-danger col-span-1 h-14 text-base"
                  onClick={() => paymentKeypadPress("C")}
                >
                  Clear
                </button>

                <button
                  className="btn-secondary col-span-4 h-12 text-base"
                  onClick={() => {
                    setPaymentModalOpen(false);
                    setPaymentModalError("");
                  }}
                >
                  Back
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}
