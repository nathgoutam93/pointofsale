import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { API_BASE_URL, api, authHeaders } from "../lib/api";
import {
  buildReceiptLines,
  formatReceiptDate,
  formatReceiptTime,
  resolveReceiptWidth,
} from "../lib/receiptFormat";
import { money, requireOperationalSession } from "./route-helpers";

type CartLine = {
  itemId: string;
  name: string;
  qty: number;
  rate: number;
  discountAmount: number;
  itemDiscountAmount?: number;
  orderDiscountAmount?: number;
  taxRate: number;
  taxAmount?: number;
  taxMode: "INCLUSIVE" | "EXCLUSIVE";
  imageUrl?: string | null;
  netAmount?: number;
};

type PostPaymentSummary = {
  invoiceNo: string;
  receiptNo: string;
  createdAt: string;
  customerName: string;
  customerPhone: string;
  subTotal: number;
  orderDiscountAmount: number;
  taxTotal: number;
  grandTotal: number;
  paymentLines: Array<{ mode: "CASH" | "CARD" | "WALLET"; amount: number }>;
  lines: CartLine[];
};

export function PosPage() {
  const session = requireOperationalSession();
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
  const [editLineId, setEditLineId] = useState<string | null>(null);
  const [editField, setEditField] = useState<"QTY" | "DISCOUNT" | "PRICE">(
    "QTY",
  );
  const [editValue, setEditValue] = useState("1");
  const [discountMode, setDiscountMode] = useState<"AMOUNT" | "PERCENT">(
    "AMOUNT",
  );
  const [draftLine, setDraftLine] = useState<CartLine | null>(null);
  const [orderDiscountModalOpen, setOrderDiscountModalOpen] = useState(false);
  const [orderDiscountMode, setOrderDiscountMode] = useState<
    "AMOUNT" | "PERCENT"
  >("AMOUNT");
  const [orderDiscountValue, setOrderDiscountValue] = useState("0");
  const printableSaleLines = postPayment?.lines ?? [];
  const printableGrandTotal = postPayment?.grandTotal ?? 0;
  const printableOrderDiscount = postPayment?.orderDiscountAmount ?? 0;
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
      { label: "Cashier", value: session.username ?? "" },
      { label: "Customer", value: postPayment.customerName },
      { label: "GSTIN", value: businessSettings.data?.gstNumber ?? "" },
    ];

    const items = printableSaleLines.map((line) => {
      const netAmount = line.netAmount ?? computeLineAmounts(line).net;
      const displayTotal = netAmount + Number(line.orderDiscountAmount ?? 0);
      const itemDiscount = Number(line.itemDiscountAmount ?? 0);
      const taxAmount = Number(line.taxAmount ?? 0);
      const baseExclusive = getBaseExclusive(line);
      const baseUnitRate = line.qty > 0 ? baseExclusive / line.qty : 0;
      return {
        name: line.name,
        detailRows: [
          {
            label: `${line.qty} x ${money(baseUnitRate)}`,
            value: money(baseExclusive),
          },
          ...(line.taxRate > 0 || taxAmount > 0
            ? [{ label: `tax ${line.taxRate}%`, value: money(taxAmount) }]
            : []),
          ...(itemDiscount > 0
            ? [{ label: "discount", value: `-${money(itemDiscount)}` }]
            : []),
        ],
        totalLabel: "line total",
        qty: line.qty,
        price: line.rate,
        total: displayTotal,
      };
    });

    const totals = [
      { label: "Items Total", value: money(printableGrandTotal + printableOrderDiscount) },
      ...(printableOrderDiscount > 0
        ? [
            {
              label: "Order Discount",
              value: `- ${money(printableOrderDiscount)}`,
            },
          ]
        : []),
      { label: "TOTAL", value: money(printableGrandTotal), isGrandTotal: true },
    ];

    const payments = postPayment.paymentLines.map((line) => ({
      label: `Paid by ${line.mode}`,
      value: money(line.amount),
    }));

    const footerLines =
      invoiceFooterLines.length > 0 ? invoiceFooterLines : receiptFooterLines;

    return buildReceiptLines({
      width: receiptCharWidth,
      storeName: storeDisplayName,
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
    printableOrderDiscount,
    printableGrandTotal,
    invoiceHeaderLines,
    invoiceFooterLines,
    receiptFooterLines,
    businessSettings.data?.gstNumber,
    storeDisplayName,
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
      const res = await api.items.list({
        query: { activeOnly: true },
        extraHeaders: authHeaders(),
      });
      if (res.status !== 200) throw new Error("Failed to load items");
      return res.body;
    },
  });

  const customers = useQuery({
    queryKey: ["customers-pos", session.branchId],
    queryFn: async () => {
      const res = await api.customers.list({
        query: { branchId: session.branchId },
        extraHeaders: authHeaders(),
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
        extraHeaders: authHeaders(),
      });
      if (res.status !== 200)
        throw new Error("Failed to load walk-in customer");
      return res.body;
    },
  });

  function round2(value: number) {
    return Math.round(value * 100) / 100;
  }

  const taxCalculationMode =
    businessSettings.data?.taxCalculationMode ?? "AFTER_DISCOUNT";

  function getBaseExclusive(
    line: Pick<CartLine, "qty" | "rate" | "taxRate" | "taxMode">,
  ) {
    const gross = round2(line.qty * line.rate);
    return round2(
      line.taxMode === "INCLUSIVE" && line.taxRate > 0
        ? (gross * 100) / (100 + line.taxRate)
        : gross,
    );
  }

  function allocateDiscountAcrossBases(
    bases: number[],
    discountAmount: number,
  ) {
    const totalBase = round2(bases.reduce((acc, base) => acc + base, 0));
    const cappedDiscount = round2(Math.min(Math.max(0, discountAmount), totalBase));
    if (totalBase <= 0 || cappedDiscount <= 0) {
      return new Array(bases.length).fill(0);
    }

    const rawShares = bases.map((base) => (base / totalBase) * cappedDiscount);
    const floored = rawShares.map((share) =>
      round2(Math.floor(share * 100) / 100),
    );
    const fractions = rawShares.map((share, idx) => share - floored[idx]);
    let remainingCents = Math.round(
      round2(cappedDiscount - floored.reduce((acc, val) => acc + val, 0)) * 100,
    );

    const order = fractions
      .map((frac, idx) => ({
        idx,
        frac,
        headroom: round2(bases[idx] - floored[idx]),
      }))
      .filter((entry) => entry.headroom >= 0.01)
      .sort((a, b) => b.frac - a.frac || a.idx - b.idx);

    while (remainingCents > 0) {
      let progressed = false;
      for (const entry of order) {
        if (remainingCents <= 0) break;
        if (round2(bases[entry.idx] - floored[entry.idx]) < 0.01) continue;
        floored[entry.idx] = round2(floored[entry.idx] + 0.01);
        remainingCents -= 1;
        progressed = true;
      }
      if (!progressed) break;
    }

    return floored;
  }

  function computeLineAmounts(
    line: Pick<
      CartLine,
      "qty" | "rate" | "discountAmount" | "taxRate" | "taxMode"
    >,
  ) {
    const baseExclusive = getBaseExclusive(line);
    const discountAmount = round2(Math.min(Math.max(0, line.discountAmount), baseExclusive));
    const taxable = round2(Math.max(0, baseExclusive - discountAmount));
    const taxBase =
      taxCalculationMode === "BEFORE_DISCOUNT" ? baseExclusive : taxable;
    const tax = round2((taxBase * line.taxRate) / 100);
    return { taxable, tax, net: round2(taxable + tax) };
  }

  const orderDiscountBase = useMemo(
    () =>
      cart.reduce((acc, line) => {
        const baseExclusive = getBaseExclusive(line);
        return acc + Math.max(0, baseExclusive - line.discountAmount);
      }, 0),
    [cart],
  );

  const resolvedOrderDiscountAmount = useMemo(() => {
    const input = Number(orderDiscountValue);
    if (!Number.isFinite(input) || input <= 0) return 0;
    if (orderDiscountMode === "PERCENT") {
      return Math.min(orderDiscountBase, (orderDiscountBase * input) / 100);
    }
    return Math.min(orderDiscountBase, input);
  }, [orderDiscountBase, orderDiscountMode, orderDiscountValue]);

  const computedCart = useMemo(() => {
    const normalized = cart.map((line) => {
      const gross = round2(line.qty * line.rate);
      const baseExclusive = getBaseExclusive(line);
      const itemDiscount = round2(Math.min(Math.max(0, line.discountAmount), baseExclusive));
      const baseAfterItem = round2(Math.max(0, baseExclusive - itemDiscount));
      return { line, gross, baseExclusive, itemDiscount, baseAfterItem };
    });

    const bases = normalized.map((entry) => entry.baseAfterItem);
    const allocations = allocateDiscountAcrossBases(bases, resolvedOrderDiscountAmount);

    const lines = normalized.map((entry, idx) => {
      const orderDiscount = round2(allocations[idx] ?? 0);
      const discountAmount = round2(entry.itemDiscount + orderDiscount);
      const taxable = round2(Math.max(0, entry.baseExclusive - discountAmount));
      const taxBase =
        taxCalculationMode === "BEFORE_DISCOUNT"
          ? entry.baseExclusive
          : taxable;
      const tax = round2((taxBase * entry.line.taxRate) / 100);
      const net = round2(taxable + tax);
      return {
        ...entry.line,
        gross: entry.gross,
        baseExclusive: entry.baseExclusive,
        itemDiscount: entry.itemDiscount,
        orderDiscount,
        discountAmount,
        taxable,
        tax,
        net,
      };
    });

    return {
      lines,
      subTotal: round2(lines.reduce((acc, line) => acc + line.baseExclusive, 0)),
      taxTotal: round2(lines.reduce((acc, line) => acc + line.tax, 0)),
      grandTotal: round2(lines.reduce((acc, line) => acc + line.net, 0)),
      orderDiscountTotal: round2(lines.reduce((acc, line) => acc + line.orderDiscount, 0)),
    };
  }, [cart, resolvedOrderDiscountAmount, taxCalculationMode]);

  const activeEditLine = useMemo(
    () => cart.find((line) => line.itemId === editLineId) ?? null,
    [cart, editLineId],
  );
  const displayEditLine = draftLine ?? activeEditLine;

  const getDiscountPercent = (line: CartLine) => {
    const baseExclusive = getBaseExclusive(line);
    if (baseExclusive <= 0) return 0;
    return (line.discountAmount / baseExclusive) * 100;
  };

  const formatPercentValue = (value: number) => {
    if (!Number.isFinite(value)) return "0";
    const fixed = value.toFixed(2);
    return fixed.replace(/\.?0+$/, "");
  };

  const buildEditedLine = (
    line: CartLine,
    field: "QTY" | "DISCOUNT" | "PRICE",
    value: string,
    mode: "AMOUNT" | "PERCENT",
  ) => {
    const input = Number(value);
    if (!Number.isFinite(input)) return line;
    let qty = line.qty;
    let rate = line.rate;
    let discountAmount = line.discountAmount;
    if (field === "QTY") {
      qty = Math.max(0, input);
    }
    if (field === "PRICE") {
      rate = Math.max(0, input);
    }
    if (field === "DISCOUNT") {
      if (mode === "PERCENT") {
        const baseExclusive = getBaseExclusive({ ...line, qty, rate });
        discountAmount = Math.max(0, (baseExclusive * input) / 100);
      } else {
        discountAmount = Math.max(0, input);
      }
    }
    const baseExclusive = getBaseExclusive({ ...line, qty, rate });
    if (discountAmount > baseExclusive) discountAmount = baseExclusive;
    return { ...line, qty, rate, discountAmount };
  };

  const setEditFieldWithValue = (
    field: "QTY" | "DISCOUNT" | "PRICE",
    line: CartLine,
    mode: "AMOUNT" | "PERCENT" = discountMode,
  ) => {
    setEditField(field);
    if (field === "QTY") {
      setEditValue(String(line.qty));
      return;
    }
    if (field === "PRICE") {
      setEditValue(String(line.rate));
      return;
    }
    if (mode === "PERCENT") {
      setEditValue(formatPercentValue(getDiscountPercent(line)));
      return;
    }
    setEditValue(String(line.discountAmount));
  };

  const openLineEditor = (line: CartLine) => {
    setEditLineId(line.itemId);
    setDiscountMode("AMOUNT");
    setEditFieldWithValue("QTY", line, "AMOUNT");
    setDraftLine({ ...line });
  };

  const closeLineEditor = () => {
    setEditLineId(null);
    setEditValue("1");
    setEditField("QTY");
    setDiscountMode("AMOUNT");
    setDraftLine(null);
  };

  const updateDraftLine = (
    line: CartLine,
    field: "QTY" | "DISCOUNT" | "PRICE",
    value: string,
    mode: "AMOUNT" | "PERCENT",
  ) => {
    const next = buildEditedLine(line, field, value, mode);
    setDraftLine(next);
  };

  const lineEditKeypadPress = (key: string) => {
    if (key === "C") {
      setEditValue("0");
      if (draftLine) {
        updateDraftLine(draftLine, editField, "0", discountMode);
      }
      return;
    }
    if (key === "<") {
      setEditValue((current) => {
        const next = current.length <= 1 ? "0" : current.slice(0, -1);
        if (draftLine) {
          updateDraftLine(draftLine, editField, next, discountMode);
        }
        return next;
      });
      return;
    }
    if (key === "+/-") {
      setEditValue((current) => {
        if (current === "0") return current;
        const next = current.startsWith("-") ? current.slice(1) : `-${current}`;
        if (draftLine) {
          updateDraftLine(draftLine, editField, next, discountMode);
        }
        return next;
      });
      return;
    }
    if (key === ".") {
      setEditValue((current) => {
        const next = current.includes(".") ? current : `${current}.`;
        if (draftLine) {
          updateDraftLine(draftLine, editField, next, discountMode);
        }
        return next;
      });
      return;
    }
    if (key === "QTY" || key === "PRICE") {
      if (draftLine) {
        setEditFieldWithValue(key, draftLine);
      }
      return;
    }
    if (key === "%") {
      if (editField !== "DISCOUNT") {
        if (draftLine) {
          setEditFieldWithValue("DISCOUNT", draftLine);
        }
        return;
      }
      const nextMode = discountMode === "AMOUNT" ? "PERCENT" : "AMOUNT";
      setDiscountMode(nextMode);
      if (draftLine) {
        setEditFieldWithValue("DISCOUNT", draftLine, nextMode);
      }
      return;
    }
    if (key === "DISCOUNT") {
      if (draftLine) {
        setEditFieldWithValue("DISCOUNT", draftLine);
      }
      return;
    }

    if (!/^\d$/.test(key)) return;
    setEditValue((current) => {
      const next = current === "0" ? key : `${current}${key}`;
      if (draftLine) {
        updateDraftLine(draftLine, editField, next, discountMode);
      }
      return next;
    });
  };

  const orderDiscountKeypadPress = (key: string) => {
    if (key === "C") {
      setOrderDiscountValue("0");
      return;
    }
    if (key === "<") {
      setOrderDiscountValue((current) =>
        current.length <= 1 ? "0" : current.slice(0, -1),
      );
      return;
    }
    if (key === "+/-") {
      setOrderDiscountValue((current) => {
        if (current === "0") return current;
        return current.startsWith("-") ? current.slice(1) : `-${current}`;
      });
      return;
    }
    if (key === ".") {
      setOrderDiscountValue((current) =>
        current.includes(".") ? current : `${current}.`,
      );
      return;
    }
    if (key === "%") {
      setOrderDiscountMode((current) =>
        current === "AMOUNT" ? "PERCENT" : "AMOUNT",
      );
      return;
    }
    if (!/^\d$/.test(key)) return;
    setOrderDiscountValue((current) =>
      current === "0" ? key : `${current}${key}`,
    );
  };

  const applyLineEdits = () => {
    if (!activeEditLine) return;
    setCart((prev) =>
      prev.map((line) => {
        if (line.itemId !== activeEditLine.itemId) return line;
        return draftLine ?? line;
      }),
    );
    closeLineEditor();
  };

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
    return computedCart.grandTotal;
  }, [computedCart.grandTotal]);

  const totalTax = useMemo(() => {
    return computedCart.taxTotal;
  }, [computedCart.taxTotal]);

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
      const res = await api.customers.getWallet({
        params: { id: customerId },
        extraHeaders: authHeaders(),
      });
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
    setOrderDiscountValue("0");
    setOrderDiscountMode("AMOUNT");
    setOrderDiscountModalOpen(false);
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
        lines: cart.map((line) => ({
          itemId: line.itemId,
          qty: line.qty,
          rate: line.rate,
          taxRate: line.taxRate,
          taxMode: line.taxMode,
          discounts:
            line.discountAmount > 0
              ? [{ type: "FIXED" as const, value: line.discountAmount }]
              : [],
        })),
        discounts:
          Number(orderDiscountValue) > 0
            ? [
                {
                  type:
                    orderDiscountMode === "PERCENT"
                      ? ("PERCENTAGE" as const)
                      : ("FIXED" as const),
                  value: Number(orderDiscountValue),
                },
              ]
            : [],
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
      setOrderDiscountValue("0");
      setOrderDiscountMode("AMOUNT");
      setOrderDiscountModalOpen(false);
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
      };
    },
    onSuccess: (result) => {
      const cartSnapshotById = new Map(cart.map((line) => [line.itemId, line]));
      const itemDiscountIds = new Set(
        (result.invoice.discounts ?? [])
          .filter((discount) => discount.scope === "ITEM")
          .map((discount) => discount.id),
      );
      setPostPayment({
        invoiceNo: result.invoice.invoiceNo,
        receiptNo: result.receipt.receiptNo,
        createdAt: result.receipt.createdAt,
        customerName: result.invoice.customerName,
        customerPhone: result.invoice.customerPhone ?? "",
        subTotal: Number(result.invoice.subTotal),
        orderDiscountAmount: Number(result.invoice.orderDiscountAmount ?? 0),
        taxTotal: Number(result.invoice.taxTotal),
        grandTotal: Number(result.invoice.grandTotal),
        paymentLines: result.invoice.payments.map((line) => ({
          mode: line.mode,
          amount: Number(line.amount),
        })),
        lines: result.invoice.lines.map((line) => {
          const snapshot = cartSnapshotById.get(line.itemId);
          const itemDiscountAmount = (line.discountAllocations ?? []).reduce(
            (acc, allocation) =>
              itemDiscountIds.has(allocation.discountId)
                ? acc + Number(allocation.amount ?? 0)
                : acc,
            0,
          );
          const orderDiscountAmount =
            Number(line.discountAmount ?? 0) - itemDiscountAmount;
          return {
            itemId: line.itemId,
            name: line.itemName ?? snapshot?.name ?? `Item ${line.itemId.slice(0, 6)}`,
            qty: Number(line.qty),
            rate: Number(line.rate),
            discountAmount: Number(line.discountAmount ?? 0),
            itemDiscountAmount,
            orderDiscountAmount,
            taxRate: Number(line.taxRate),
            taxAmount: Number(line.taxAmount ?? 0),
            taxMode: line.taxMode ?? snapshot?.taxMode ?? "EXCLUSIVE",
            imageUrl: snapshot?.imageUrl,
            netAmount: Number(line.netAmount ?? 0),
          };
        }),
      });
      setReceiptContact(result.invoice.customerPhone ?? "");
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
    <section className="grid h-[calc(100vh-48px)] grid-cols-1 xl:grid-cols-[450px_1fr]">
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
                const itemDiscount =
                  line.itemDiscountAmount ?? line.discountAmount;
                return (
                  <div
                    className="flex cursor-pointer items-start justify-between border-b border-slate-100 px-3 py-2 hover:bg-slate-50"
                    key={line.itemId}
                    onClick={() => openLineEditor(line)}
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
                        {itemDiscount > 0 ? (
                          <p className="text-sm text-amber-700">
                            Item Discount: ₹ {money(itemDiscount)}
                          </p>
                        ) : null}
                      </div>
                    </div>
                    <div className="text-right">
                      <p className="text-[26px] font-bold leading-none text-slate-800">
                        {money(lineNet)} ₹
                      </p>
                      <div className="mt-1 flex justify-end gap-1">
                        <button
                          className="h-7 w-7 rounded bg-slate-200 p-0 text-sm text-slate-700"
                          onClick={(event) => {
                            event.stopPropagation();
                            setCart((prev) =>
                              prev
                                .map((x) =>
                                  x.itemId === line.itemId
                                    ? { ...x, qty: Math.max(1, x.qty - 1) }
                                    : x,
                                )
                                .filter((x) => x.qty > 0),
                            );
                          }}
                        >
                          -
                        </button>
                        <button
                          className="h-7 w-7 rounded bg-slate-200 p-0 text-sm text-slate-700"
                          onClick={(event) => {
                            event.stopPropagation();
                            setCart((prev) =>
                              prev.map((x) =>
                                x.itemId === line.itemId
                                  ? { ...x, qty: x.qty + 1 }
                                  : x,
                              ),
                            );
                          }}
                        >
                          +
                        </button>
                        <button
                          className="h-7 w-7 rounded bg-rose-200 p-0 text-sm font-bold text-rose-700"
                          onClick={(event) => {
                            event.stopPropagation();
                            setCart((prev) =>
                              prev.filter((x) => x.itemId !== line.itemId),
                            );
                            if (editLineId === line.itemId) {
                              closeLineEditor();
                            }
                          }}
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
                <p className="text-lg text-slate-500">Taxes:</p>
                <p className="text-lg text-slate-500">{money(totalTax)} ₹</p>
              </div>
              <div className="mt-1 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <p className="text-lg text-slate-500">Order Discount:</p>
                  <button
                    className="rounded bg-slate-200 px-2 py-0.5 text-xs font-semibold text-slate-700"
                    onClick={() => setOrderDiscountModalOpen(true)}
                  >
                    Edit
                  </button>
                </div>
                <p className="text-lg text-amber-700">
                  {resolvedOrderDiscountAmount > 0
                    ? `- ${money(resolvedOrderDiscountAmount)} ₹`
                    : "—"}
                </p>
              </div>
              <div className="flex items-center justify-between">
                <p className="text-2xl font-semibold leading-none text-slate-700">
                  Total:
                </p>
                <p className="text-2xl font-semibold leading-none text-slate-700">
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
                    Wallet Balance: ₹ {money(customerWallet.data?.balance ?? 0)}
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
            <div className="mx-auto">
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
                <div className="receipt-text text-center">
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

            <div className="grid max-h-[calc(100vh-150px)] grid-cols-2 gap-2 overflow-auto p-2 sm:grid-cols-4 lg:grid-cols-6 2xl:grid-cols-8">
              {filteredItems.map((item) => (
                <button
                  key={item.id}
                  className="rounded border border-slate-200 bg-white p-2 text-left hover:bg-slate-50"
                  onClick={() => addItem(item)}
                >
                  <div className="mb-2 h-20 overflow-hidden rounded bg-slate-100">
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
                  {/* <p className="text-xs font-semibold text-indigo-700">
                    {money(item.sellPrice)} ₹
                  </p> */}
                </button>
              ))}
            </div>
          </>
        )}
      </div>

      {paymentModalOpen ? (
        <div className="fixed inset-0 z-40 grid place-items-center bg-slate-900/40 p-4">
          <div className="grid w-full max-w-6xl grid-cols-2 overflow-hidden rounded-xl border border-slate-300 bg-white shadow-2xl">
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
          </div>
        </div>
      ) : null}

      {orderDiscountModalOpen ? (
        <div className="fixed inset-0 z-40 grid place-items-center bg-slate-900/40 p-4">
          <div className="w-full max-w-3xl overflow-hidden rounded-xl border border-slate-300 bg-white shadow-2xl">
            <div className="border-b border-slate-200 p-4">
              <p className="text-2xl font-semibold text-slate-900">
                Order Discount
              </p>
              <p className="text-sm text-slate-500">
                Base eligible: ₹ {money(orderDiscountBase)}
              </p>
              <div className="mt-3 flex items-center gap-3">
                <div className="rounded border border-slate-200 bg-slate-50 px-3 py-2 text-2xl font-semibold text-slate-800">
                  {orderDiscountValue}{" "}
                  {orderDiscountMode === "PERCENT" ? "%" : "₹"}
                </div>
                <div className="text-lg text-amber-700">
                  Applied: ₹ {money(resolvedOrderDiscountAmount)}
                </div>
              </div>
            </div>

            <div className="grid grid-cols-4 gap-1 p-4">
              {[
                "1",
                "2",
                "3",
                "%",
                "4",
                "5",
                "6",
                "C",
                "7",
                "8",
                "9",
                "<",
                "+/-",
                "0",
                ".",
                "Done",
              ].map((key) => {
                if (key === "Done") {
                  return (
                    <button
                      key={key}
                      className="col-span-4 rounded bg-emerald-600 px-2 py-4 text-xl font-bold text-white"
                      onClick={() => setOrderDiscountModalOpen(false)}
                    >
                      Done
                    </button>
                  );
                }
                return (
                  <button
                    key={key}
                    className={`rounded px-2 py-4 text-2xl font-semibold ${
                      key === "%"
                        ? "bg-amber-200 text-amber-900"
                        : key === "C"
                          ? "bg-rose-200 text-rose-800"
                          : "bg-slate-100 text-slate-800"
                    }`}
                    onClick={() => orderDiscountKeypadPress(key)}
                  >
                    {key}
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      ) : null}

      {activeEditLine ? (
        <div className="fixed inset-0 z-40 grid place-items-center bg-slate-900/40 p-4">
          <div className="w-full max-w-5xl overflow-hidden rounded-xl border border-slate-300 bg-white shadow-2xl">
            <div className="grid grid-cols-1 lg:grid-cols-[1fr_420px]">
              <div className="border-r border-slate-200 bg-slate-50 p-4">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-2xl font-semibold text-slate-900">
                      {displayEditLine?.name}
                    </p>
                    <p className="text-sm text-slate-500">
                      Item ID: {displayEditLine?.itemId}
                    </p>
                  </div>
                </div>

                <div className="mt-4 grid gap-3 sm:grid-cols-3">
                  <button
                    className={`rounded border px-3 py-3 text-left ${editField === "QTY" ? "border-emerald-400 bg-emerald-50" : "border-slate-200 bg-white"}`}
                    onClick={() =>
                      displayEditLine
                        ? setEditFieldWithValue("QTY", displayEditLine)
                        : null
                    }
                  >
                    <p className="text-xs uppercase tracking-wide text-slate-500">
                      Qty
                    </p>
                    <p className="text-2xl font-semibold text-slate-800">
                      {displayEditLine?.qty.toFixed(3)}
                    </p>
                  </button>
                  <button
                    className={`rounded border px-3 py-3 text-left ${editField === "DISCOUNT" ? "border-amber-400 bg-amber-50" : "border-slate-200 bg-white"}`}
                    onClick={() =>
                      displayEditLine
                        ? setEditFieldWithValue("DISCOUNT", displayEditLine)
                        : null
                    }
                  >
                    <p className="text-xs uppercase tracking-wide text-slate-500">
                      Discount
                    </p>
                    <p className="text-2xl font-semibold text-slate-800">
                      ₹ {money(displayEditLine?.discountAmount ?? 0)}
                    </p>
                  </button>
                  <button
                    className={`rounded border px-3 py-3 text-left ${editField === "PRICE" ? "border-indigo-400 bg-indigo-50" : "border-slate-200 bg-white"}`}
                    onClick={() =>
                      displayEditLine
                        ? setEditFieldWithValue("PRICE", displayEditLine)
                        : null
                    }
                  >
                    <p className="text-xs uppercase tracking-wide text-slate-500">
                      Price / Unit
                    </p>
                    <p className="text-2xl font-semibold text-slate-800">
                      ₹ {money(displayEditLine?.rate ?? 0)}
                    </p>
                  </button>
                </div>

                <div className="mt-6 rounded-lg border border-slate-200 bg-white p-4">
                  <p className="text-xs uppercase tracking-wide text-slate-500">
                    Editing
                  </p>
                  <div className="mt-2 flex items-end justify-between">
                    <div>
                      <p className="text-sm text-slate-500">
                        {editField === "QTY"
                          ? "Quantity"
                          : editField === "PRICE"
                            ? "Unit Price"
                            : discountMode === "PERCENT"
                              ? "Discount (%)"
                              : "Discount Amount"}
                      </p>
                      <p className="text-5xl font-semibold text-slate-900">
                        {editValue}
                        {editField === "DISCOUNT" && discountMode === "PERCENT"
                          ? "%"
                          : ""}
                      </p>
                    </div>
                    <div className="text-right">
                      <p className="text-xs uppercase tracking-wide text-slate-500">
                        Line Total
                      </p>
                      <p className="text-3xl font-semibold text-slate-800">
                        ₹{" "}
                        {money(
                          computeLineAmounts(displayEditLine ?? activeEditLine)
                            .net,
                        )}
                      </p>
                    </div>
                  </div>
                  {editField === "DISCOUNT" ? (
                    <p className="mt-2 text-xs text-slate-500">
                      {discountMode === "PERCENT"
                        ? "Press % to switch to amount."
                        : "Press % to switch to percentage."}
                    </p>
                  ) : null}
                </div>
              </div>

              <div className="bg-slate-900 p-4 space-y-2">
                <div className="grid grid-cols-4 gap-2">
                  {[
                    "1",
                    "2",
                    "3",
                    "QTY",
                    "4",
                    "5",
                    "6",
                    "%",
                    "7",
                    "8",
                    "9",
                    "PRICE",
                    "+/-",
                    "0",
                    ".",
                    "<",
                  ].map((key) => (
                    <button
                      key={key}
                      className={`rounded px-2 py-4 text-xl font-semibold ${
                        key === "QTY" || key === "PRICE" || key === "%"
                          ? "bg-slate-700 text-white"
                          : key === "<"
                            ? "bg-rose-500 text-white"
                            : "bg-slate-100 text-slate-900"
                      }`}
                      onClick={() => lineEditKeypadPress(key)}
                    >
                      {key}
                    </button>
                  ))}

                  <button
                    className="col-span-3 rounded bg-emerald-600 px-4 py-3 text-base font-semibold text-white"
                    onClick={applyLineEdits}
                  >
                    Apply
                  </button>
                  <button
                    className="col-span-1 rounded bg-amber-200 px-2 py-4 text-xl font-semibold text-amber-900"
                    onClick={() => lineEditKeypadPress("C")}
                  >
                    Clear
                  </button>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    className="rounded bg-slate-200 px-2 py-4 text-xl font-semibold text-slate-800"
                    onClick={closeLineEditor}
                  >
                    Back
                  </button>
                  <button
                    className="rounded bg-rose-200 px-4 py-3 text-base font-semibold text-rose-800"
                    onClick={() => {
                      setCart((prev) =>
                        prev.filter((x) => x.itemId !== activeEditLine.itemId),
                      );
                      closeLineEditor();
                    }}
                  >
                    Remove Item
                  </button>
                </div>
              </div>
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
