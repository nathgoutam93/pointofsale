import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState } from "react";
import { computeSaleTotals } from "@pos/contracts";
import type { DiscountInput } from "@pos/contracts";
import { api, apiErrorMessage, authHeaders } from "../lib/api";
import { newUuid } from "../lib/id";
import { receiptPrinterSettings, useReceiptPrinting } from "../lib/printing";
import { removeDrafts, upsertDraft } from "../lib/draftStore";
import { inr, requireOperationalSession } from "./route-helpers";
import {
  getCartLineKey,
  normalizeLeastCount,
  round3,
  snapQtyToLeastCount,
  stepLineQty,
} from "./pos/cartMath";
import { CartLines } from "./pos/CartLines";
import { CartTotals } from "./pos/CartTotals";
import { CustomerPickerModal } from "./pos/CustomerPickerModal";
import { CustomerSection } from "./pos/CustomerSection";
import { DraftList } from "./pos/DraftList";
import { LeaveDialog } from "./pos/LeaveDialog";
import { LineEditorModal } from "./pos/LineEditorModal";
import { OrderDiscountModal } from "./pos/OrderDiscountModal";
import { PaymentModal } from "./pos/PaymentModal";
import { PostPaymentPanel } from "./pos/PostPaymentPanel";
import { PrintableInvoice } from "./pos/PrintableInvoice";
import { ProductGrid } from "./pos/ProductGrid";
import { ReceiptPrintStyles } from "./pos/ReceiptPrintStyles";
import { buildInvoiceReceipt, buildPrintableInvoiceDocument, downloadHtml } from "./pos/receipt";
import { receiptStyleFor } from "../lib/receipt";
import { useLeaveGuard } from "./pos/useLeaveGuard";
import { useLineEditor } from "./pos/useLineEditor";
import { useLocalDrafts } from "./pos/useLocalDrafts";
import { useOrderDiscount } from "./pos/useOrderDiscount";
import { usePayment } from "./pos/usePayment";
import { useStoreSettings } from "./pos/useStoreSettings";
import type { CartLine, LocalSaleDraft, PostPaymentSummary } from "./pos/types";
import { invoiceGstOf } from "../lib/gstReceipt";

export function PosPage() {
  const session = requireOperationalSession();
  const queryClient = useQueryClient();
  const [customerId, setCustomerId] = useState("");
  const [cart, setCart] = useState<CartLine[]>([]);
  const [search, setSearch] = useState("");
  const [scanCode, setScanCode] = useState("");
  const [activeCategory, setActiveCategory] = useState("All");
  const [customerModalOpen, setCustomerModalOpen] = useState(false);
  const [walkInCustomerName, setWalkInCustomerName] = useState("");
  const [walkInCustomerPhone, setWalkInCustomerPhone] = useState("");
  // The state goods are shipped to; null for a counter sale (the branch's own state).
  const [placeOfSupply, setPlaceOfSupply] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const [postPayment, setPostPayment] = useState<PostPaymentSummary | null>(
    null,
  );
  const orderDiscount = useOrderDiscount();
  const orderDiscounts = orderDiscount.discounts;
  const [receiptContact, setReceiptContact] = useState("");
  const draftStorageKey = useMemo(
    () => `pos_sale_drafts:${session.branchId}:${session.userId}`,
    [session.branchId, session.userId],
  );
  const { localDrafts, setLocalDrafts, activeDraftIdRef, setActiveDraft } = useLocalDrafts(draftStorageKey);
  const [isOrderOpen, setIsOrderOpen] = useState(false);

  const store = useStoreSettings(session.branchId);
  const { taxCalculationMode, chargeTax, invoiceLogoSrc, customReceiptCss, receiptTemplate } = store;
  const lineEditor = useLineEditor({ cart, setCart, chargeTax });

  const printableInvoice = useMemo(
    () => (postPayment ? buildInvoiceReceipt(postPayment, store, session.username ?? "") : null),
    [postPayment, store.businessSettings.data, store.branchSettings.data, session.username],
  );

  const receiptPrinting = useReceiptPrinting();
  const receiptStyle = receiptStyleFor(printableInvoice ?? { columns: 48 }, receiptTemplate, customReceiptCss);
  // Once per sale, as soon as it's paid: the drawer opens for cash, and the receipt prints
  // if this computer is set to. The receipt is on the page by now (effects run after render).
  const handledSaleRef = useRef<string | null>(null);
  useEffect(() => {
    if (!postPayment || handledSaleRef.current === postPayment.invoiceNo) return;
    handledSaleRef.current = postPayment.invoiceNo;
    const tookCash = postPayment.paymentLines.some((line) => line.mode === "CASH" && line.amount > 0);
    void (async () => {
      if (tookCash) await receiptPrinting.openDrawer();
      if ((await receiptPrinterSettings())?.autoPrint) {
        await receiptPrinting.print(receiptStyle, { dialogOnFailure: false });
      }
    })();
  }, [postPayment]);

  const exportPrintableInvoice = () => {
    const htmlDocument = postPayment ? buildPrintableInvoiceDocument(postPayment, receiptStyle) : null;
    if (!htmlDocument) {
      setMessage("Printable invoice is not ready to download yet.");
      return;
    }
    downloadHtml(htmlDocument, `invoice-${postPayment?.invoiceNo ?? "receipt"}.html`);

    if (receiptContact.trim()) {
      setMessage(
        `Invoice download ready for sharing via WhatsApp (${receiptContact.trim()}).`,
      );
    } else {
      setMessage("Invoice download started. Share it on WhatsApp manually.");
    }
  };

  const items = useQuery({
    // Priced for this branch: its own prices where it has them.
    queryKey: ["items-pos", session.branchId],
    queryFn: async () => {
      const res = await api.items.list({
        query: { activeOnly: true, branchId: session.branchId },
        extraHeaders: authHeaders(),
      });
      if (res.status !== 200) throw new Error("Failed to load items");
      return res.body;
    },
  });

  const onHand = useQuery({
    queryKey: ["stock-module", session.branchId],
    queryFn: async () => {
      const res = await api.stock.onHand({
        query: { branchId: session.branchId },
        extraHeaders: authHeaders(),
      });
      if (res.status !== 200) throw new Error("Failed to load stock");
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

  // The discounts exactly as checkout sends them, so the totals shown here are the
  // totals the server computes (same request, same computeSaleTotals).
  const itemDiscountsFor = (line: Pick<CartLine, "discountAmount">): DiscountInput[] =>
    line.discountAmount > 0 ? [{ type: "FIXED", value: line.discountAmount }] : [];

  const computedCart = useMemo(() => {
    const totals = computeSaleTotals(
      cart.map((line) => ({ ...line, discounts: itemDiscountsFor(line) })),
      orderDiscounts,
      taxCalculationMode,
      { chargeTax },
    );
    return {
      lines: totals.lines.map((entry) => ({
        ...entry.line,
        gross: entry.gross,
        baseExclusive: entry.baseExclusive,
        itemDiscount: entry.itemDiscount,
        orderDiscount: entry.orderDiscount,
        discountAmount: entry.discountAmount,
        taxable: entry.taxable,
        tax: entry.tax,
        net: entry.net,
      })),
      subTotal: totals.subTotal,
      taxTotal: totals.taxTotal,
      grandTotal: totals.grandTotal,
      orderDiscountTotal: totals.orderDiscountTotal,
      orderDiscountBase: totals.orderDiscountBase,
    };
  }, [cart, orderDiscounts, taxCalculationMode, chargeTax]);
  const orderDiscountBase = computedCart.orderDiscountBase;
  const resolvedOrderDiscountAmount = computedCart.orderDiscountTotal;

  const addItem = (item: {
    id: string;
    name: string;
    uom?: string;
    sellPrice: number | string;
    taxRate: number | string;
    taxMode?: "INCLUSIVE" | "EXCLUSIVE";
    leastCount?: number | string;
    imageUrl?: string | null;
    saleUom?: string;
    saleUomQty?: number;
    saleUomConversionQty?: number;
  }) => {
    setIsOrderOpen(true);
    const rate = Number(item.sellPrice) || 0;
    const taxRate = Number(item.taxRate) || 0;
    const taxMode = item.taxMode ?? "EXCLUSIVE";
    const leastCount = normalizeLeastCount(item.leastCount);
    const displayUom = item.saleUom ?? item.uom;
    const saleUom = item.saleUom;
    const saleUomQty = item.saleUomQty ?? 1;
    const saleUomConversionQty = normalizeLeastCount(item.saleUomConversionQty ?? leastCount);
    const qty = item.saleUom ? snapQtyToLeastCount(saleUomQty * saleUomConversionQty, leastCount) : leastCount;
    const cartKey = `${item.id}:${displayUom ?? "BASE"}`;
    setCart((prev) => {
      const idx = prev.findIndex((l) => getCartLineKey(l) === cartKey);
      if (idx === -1) {
        return [
          ...prev,
          {
            cartKey,
            itemId: item.id,
            name: item.name,
            qty,
            leastCount,
            rate,
            baseUom: item.uom,
            saleUom,
            saleUomQty: item.saleUom ? saleUomQty : undefined,
            saleUomConversionQty: item.saleUom ? saleUomConversionQty : undefined,
            discountAmount: 0,
            taxRate,
            taxMode,
            imageUrl: item.imageUrl,
          },
        ];
      }
      const next = [...prev];
      next[idx] = {
        ...next[idx],
        qty: round3(next[idx].qty + qty),
        saleUomQty: next[idx].saleUomQty === undefined ? undefined : round3(next[idx].saleUomQty + saleUomQty),
      };
      return next;
    });
  };

  const addScannedItem = () => {
    const normalizedCode = scanCode.trim().toLowerCase();
    if (!normalizedCode) return;

    const codeMatches = allSaleItemChoices.filter(
      (item) => item.code.trim().toLowerCase() === normalizedCode,
    );
    const match =
      codeMatches.find((item) => !item.saleUom) ??
      codeMatches[0] ??
      allSaleItemChoices.find(
        (item) => item.choiceKey.toLowerCase() === normalizedCode,
      );

    if (!match) {
      setMessage(`No item found for code ${scanCode.trim()}`);
      return;
    }

    addItem(match);
    setScanCode("");
    setMessage(`Added ${match.name} (${match.displayUom})`);
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
      const saleUomText = (item.saleUoms ?? []).map((variant) => variant.uom).join(" ");
      const textMatch =
        keyword.length === 0 ||
        item.name.toLowerCase().includes(keyword) ||
        item.code.toLowerCase().includes(keyword) ||
        category.toLowerCase().includes(keyword) ||
        saleUomText.toLowerCase().includes(keyword);
      return categoryMatch && textMatch;
    });
  }, [items.data, search, activeCategory]);

  const allSaleItemChoices = useMemo(() => {
    return (items.data ?? []).flatMap((item) => {
      const variants = item.saleUoms?.length
        ? item.saleUoms
        : [
            {
              id: `${item.id}-base`,
              uom: item.uom,
              conversionQty: 1,
              sellPrice: item.sellPrice,
              isDefault: true,
            },
          ];
      return variants.map((variant) => ({
        id: item.id,
        choiceKey: `${item.id}:${variant.uom}`,
        name: item.name,
        code: item.code,
        uom: item.uom,
        sellPrice: variant.sellPrice,
        taxRate: item.taxRate,
        taxMode: item.taxMode,
        leastCount: item.leastCount,
        imageUrl: item.imageUrl,
        saleUom: variant.isDefault ? undefined : variant.uom,
        displayUom: variant.uom,
        saleUomQty: 1,
        saleUomConversionQty: variant.conversionQty,
      }));
    });
  }, [items.data]);

  const saleItemChoices = useMemo(() => {
    const visibleItemIds = new Set(filteredItems.map((item) => item.id));
    return allSaleItemChoices.filter((item) => visibleItemIds.has(item.id));
  }, [allSaleItemChoices, filteredItems]);

  const onHandByItem = useMemo(() => {
    const map = new Map<string, number>();
    for (const row of onHand.data ?? []) {
      map.set(row.itemId, Number(row.onHand) || 0);
    }
    return map;
  }, [onHand.data]);

  const selectedCustomer = useMemo(() => {
    if (!customerId) return walkIn.data;
    return (
      (customers.data ?? []).find((c) => c.id === customerId) ?? walkIn.data
    );
  }, [customerId, customers.data, walkIn.data]);

  const isWalkInSelected = !customerId || !!selectedCustomer?.isWalkIn;
  const normalizedWalkInCustomerName = walkInCustomerName.trim();
  const normalizedWalkInCustomerPhone = walkInCustomerPhone.trim();
  const displayCustomerName =
    isWalkInSelected && normalizedWalkInCustomerName
      ? normalizedWalkInCustomerName
      : (selectedCustomer?.name ?? "Walk In");
  const displayCustomerPhone =
    isWalkInSelected && normalizedWalkInCustomerPhone
      ? normalizedWalkInCustomerPhone
      : (selectedCustomer?.phone ?? null);

  const customerWallet = useQuery({
    queryKey: ["customer-wallet", customerId],
    // Walk-in customers have no wallet.
    enabled: !!customerId && !selectedCustomer?.isWalkIn,
    queryFn: async () => {
      const res = await api.customers.getWallet({
        params: { id: customerId },
        extraHeaders: authHeaders(),
      });
      if (res.status !== 200) throw new Error("Failed to load customer wallet");
      return res.body;
    },
  });
  const walletBalance = Number(customerWallet.data?.balance ?? 0);
  const branchStateCode = store.branchSettings.data?.stateCode ?? null;
  // Composition taxpayers can't sell to another state, and a branch without a state can't
  // name one, so the choice only counts for a regular branch with its state set.
  const placeOfSupplyChoice =
    chargeTax && branchStateCode && placeOfSupply && placeOfSupply !== branchStateCode ? placeOfSupply : null;
  const payment = usePayment({ total, isWalkInSelected, walletBalance });

  const openPayment = () => {
    if (cart.length === 0) {
      setMessage("Cart is empty");
      return;
    }
    payment.start();
  };

  const stepCartLine = (line: CartLine, direction: 1 | -1) => {
    const key = getCartLineKey(line);
    setCart((prev) =>
      prev
        .map((x) => (getCartLineKey(x) === key ? stepLineQty(x, direction) : x))
        .filter((x) => x.qty > 0),
    );
  };

  const removeCartLine = (line: CartLine) => {
    const key = getCartLineKey(line);
    setCart((prev) => prev.filter((x) => getCartLineKey(x) !== key));
    if (lineEditor.editLineId === key) {
      lineEditor.close();
    }
  };

  const resetCurrentOrder = () => {
    setPostPayment(null);
    receiptPrinting.clearError();
    setMessage("");
    setReceiptContact("");
    setCustomerId("");
    setWalkInCustomerName("");
    setWalkInCustomerPhone("");
    setPlaceOfSupply(null);
    setCart([]);
    lineEditor.close();
    orderDiscount.reset();
    payment.reset();
    setActiveDraft(null);
  };

  const startNewOrder = () => {
    resetCurrentOrder();
    setIsOrderOpen(true);
  };

  const buildLocalDraft = () => {
    const now = new Date().toISOString();
    return {
      id: activeDraftIdRef.current ?? `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      savedAt: now,
      customerId,
      customerName: displayCustomerName,
      customerPhone: displayCustomerPhone,
      walkInCustomerName: isWalkInSelected ? normalizedWalkInCustomerName : null,
      walkInCustomerPhone: isWalkInSelected ? normalizedWalkInCustomerPhone : null,
      placeOfSupplyStateCode: placeOfSupply,
      cart: cart.map((line) => ({ ...line })),
      orderDiscountMode: orderDiscount.mode,
      orderDiscountValue: orderDiscount.value,
      total,
      totalItems,
    };
  };

  /** Saves the cart as a draft (throws if storage fails). */
  const saveCurrentCartAsLocalDraft = (options?: { resetOrder?: boolean }) => {
    const draft = buildLocalDraft();
    setLocalDrafts(upsertDraft(draftStorageKey, draft));
    setActiveDraft(draft.id);
    if (options?.resetOrder ?? true) {
      resetCurrentOrder();
      setIsOrderOpen(false);
    }
    return draft;
  };

  const backToOrders = () => {
    if (cart.length === 0) {
      // Emptying a resumed draft means it's no longer wanted.
      if (activeDraftIdRef.current) {
        try {
          setLocalDrafts(removeDrafts<LocalSaleDraft>(draftStorageKey, [activeDraftIdRef.current]));
          setMessage("Empty draft discarded.");
        } catch {
          setMessage("Could not remove the empty draft.");
        }
      }
      resetCurrentOrder();
      setIsOrderOpen(false);
      return;
    }
    try {
      const draft = saveCurrentCartAsLocalDraft();
      setMessage(`Local draft saved: ${draft.customerName}, ${inr(draft.total)}`);
    } catch {
      setMessage("Could not save draft locally. The current cart was kept.");
    }
  };

  const restoreLocalDraft = (draft: LocalSaleDraft) => {
    if (
      cart.length > 0 &&
      !window.confirm("Replace the current cart with this saved draft?")
    ) {
      return;
    }
    setPostPayment(null);
    setMessage(`Draft restored: ${draft.customerName}`);
    setIsOrderOpen(true);
    setActiveDraft(draft.id);
    setReceiptContact("");
    setCustomerId(draft.customerId);
    setWalkInCustomerName(draft.walkInCustomerName ?? "");
    setWalkInCustomerPhone(draft.walkInCustomerPhone ?? "");
    setPlaceOfSupply(draft.placeOfSupplyStateCode ?? null);
    setCart(draft.cart.map((line) => ({ ...line })));
    lineEditor.close();
    orderDiscount.restore(draft.orderDiscountValue, draft.orderDiscountMode);
    payment.reset();
  };

  const deleteLocalDraft = (draftId: string) => {
    try {
      setLocalDrafts(removeDrafts<LocalSaleDraft>(draftStorageKey, [draftId]));
      if (activeDraftIdRef.current === draftId) setActiveDraft(null);
      setMessage("Local draft deleted.");
    } catch {
      setMessage("Could not delete local draft.");
    }
  };

  // One idempotency key per checkout attempt. A retry of exactly the same request (e.g.
  // after a network error) reuses it, so the server returns the invoice it already made
  // instead of billing twice; any change to the cart or payments gets a new key.
  const checkoutKeyRef = useRef<{ key: string; fingerprint: string } | null>(null);

  const buildSaleBody = () => {
    if (cart.length === 0) throw new Error("Cart is empty");

    const selected = customerId || walkIn.data?.id;
    if (!selected) throw new Error("Customer not resolved");

    return {
      branchId: session.branchId,
      customerId: selected,
      walkInCustomerName: isWalkInSelected ? normalizedWalkInCustomerName || null : null,
      walkInCustomerPhone: isWalkInSelected ? normalizedWalkInCustomerPhone || null : null,
      // Only a shipped regular sale names one; otherwise the server uses the branch's state.
      placeOfSupplyStateCode: placeOfSupplyChoice ?? undefined,
      lines: cart.map((line) => ({
        itemId: line.itemId,
        qty: line.qty,
        rate: line.rate,
        saleUom: line.saleUom,
        saleUomQty: line.saleUomQty,
        saleUomConversionQty: line.saleUomConversionQty,
        taxRate: line.taxRate,
        taxMode: line.taxMode,
        discounts: itemDiscountsFor(line),
      })),
      discounts: orderDiscounts,
    };
  };

  const checkout = useMutation({
    mutationFn: async (payload: {
      payments: Array<{ mode: "CASH" | "CARD" | "WALLET"; amount: number }>;
    }) => {
      const body = { ...buildSaleBody(), payments: payload.payments };
      const fingerprint = JSON.stringify(body);
      if (checkoutKeyRef.current?.fingerprint !== fingerprint) {
        checkoutKeyRef.current = { key: newUuid(), fingerprint };
      }

      // Creates and pays in one transaction: if payment fails nothing is saved.
      let res;
      try {
        res = await api.sales.checkout({
          body: { ...body, idempotencyKey: checkoutKeyRef.current.key },
          extraHeaders: authHeaders(),
        });
      } catch {
        throw new Error(
          "Couldn't reach the server. Check the connection and press Validate again; the sale won't be charged twice.",
        );
      }
      if (res.status !== 200) {
        throw new Error(apiErrorMessage(res.body, "Checkout failed"));
      }
      checkoutKeyRef.current = null;
      return res.body;
    },
    // The cart's draft at the moment checkout started, removed on success along with the
    // current one, so a paid cart can't stay behind as a draft.
    onMutate: () => ({ draftIdAtStart: activeDraftIdRef.current }),
    onSuccess: (result, _payload, context) => {
      const cartSnapshotByKey = new Map(cart.map((line) => [getCartLineKey(line), line]));
      const cartSnapshotByItemId = new Map(cart.map((line) => [line.itemId, line]));
      const itemDiscountIds = new Set(
        (result.invoice.discounts ?? [])
          .filter((discount) => discount.scope === "ITEM")
          .map((discount) => discount.id),
      );
      setPostPayment({
        invoiceNo: result.invoice.invoiceNo,
        receiptNo: result.receipt?.receiptNo ?? null,
        createdAt: result.receipt?.createdAt ?? result.invoice.createdAt,
        customerName: result.invoice.customerName,
        customerPhone: result.invoice.customerPhone ?? "",
        subTotal: Number(result.invoice.subTotal),
        orderDiscountAmount: Number(result.invoice.orderDiscountAmount ?? 0),
        taxTotal: Number(result.invoice.taxTotal),
        grandTotal: Number(result.invoice.grandTotal),
        paidTotal: Number(result.invoice.paidTotal ?? 0),
        gst: invoiceGstOf(result.invoice),
        paymentLines: result.invoice.payments.map((line) => ({
          mode: line.mode,
          amount: Number(line.amount),
        })),
        lines: result.invoice.lines.map((line) => {
          const snapshot = cartSnapshotByKey.get(
            `${line.itemId}:${line.saleUom ?? "BASE"}`,
          ) ?? cartSnapshotByItemId.get(line.itemId);
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
            cartKey: snapshot?.cartKey ?? `${line.itemId}:${line.saleUom ?? "BASE"}`,
            name: line.itemName ?? snapshot?.name ?? `Item ${line.itemId.slice(0, 6)}`,
            qty: Number(line.qty),
            leastCount: snapshot?.leastCount ?? 1,
            rate: Number(line.rate),
            baseUom: snapshot?.baseUom,
            saleUom: line.saleUom ?? undefined,
            saleUomQty: line.saleUomQty === null ? undefined : Number(line.saleUomQty ?? 0) || undefined,
            saleUomConversionQty:
              line.saleUomConversionQty === null
                ? undefined
                : Number(line.saleUomConversionQty ?? 0) || undefined,
            discountAmount: Number(line.discountAmount ?? 0),
            itemDiscountAmount,
            orderDiscountAmount,
            taxRate: Number(line.taxRate),
            taxAmount: Number(line.taxAmount ?? 0),
            taxMode: line.taxMode ?? snapshot?.taxMode ?? "EXCLUSIVE",
            imageUrl: snapshot?.imageUrl,
            netAmount: Number(line.netAmount ?? 0),
            hsnCode: line.hsnCode ?? null,
          };
        }),
      });
      setReceiptContact(result.invoice.customerPhone ?? "");
      let draftCleanupFailed = false;
      if (context?.draftIdAtStart || activeDraftIdRef.current) {
        try {
          setLocalDrafts(removeDrafts<LocalSaleDraft>(draftStorageKey, [context?.draftIdAtStart, activeDraftIdRef.current]));
        } catch {
          draftCleanupFailed = true;
        }
      }
      setActiveDraft(null);
      setCart([]);
      payment.reset();
      setMessage(
        (result.receipt
          ? `Done: ${result.invoice.invoiceNo}, Receipt: ${result.receipt.receiptNo}, Status: ${result.invoice.status}`
          : `Done: ${result.invoice.invoiceNo}, Full credit, Status: ${result.invoice.status}`) +
          (draftCleanupFailed ? ". Couldn't remove this cart's saved draft: delete it from Saved drafts so it isn't billed again." : ""),
      );
      queryClient.invalidateQueries({
        queryKey: ["sales-module", session.branchId],
      });
      queryClient.invalidateQueries({
        queryKey: ["stock-module", session.branchId],
      });
    },
  });

  const { leavePrompt } = useLeaveGuard({
    hasUnsavedCart: cart.length > 0,
    busy: checkout.isPending,
    onBusy: () => setMessage("Checkout is in progress. Wait for it to finish before leaving."),
    saveDraft: () => saveCurrentCartAsLocalDraft(),
    saveDraftOnUnload: () => saveCurrentCartAsLocalDraft({ resetOrder: false }),
    discard: () => resetCurrentOrder(),
    onSaveFailed: () => setMessage("Could not save the cart as a draft, so you're still on POS."),
  });

  return (
    <section className="grid grid-cols-1 lg:h-[calc(100vh-48px)] lg:grid-cols-[360px_1fr] xl:grid-cols-[420px_1fr]">
      <ReceiptPrintStyles css={receiptStyle.css} />

      <aside className="flex h-full flex-col overflow-hidden border-r border-slate-200 bg-white">
        {postPayment ? (
          <PostPaymentPanel
            postPayment={postPayment}
            receiptContact={receiptContact}
            onReceiptContactChange={setReceiptContact}
            onSend={exportPrintableInvoice}
            onPrint={() => void receiptPrinting.print(receiptStyle)}
            printing={receiptPrinting.busy}
            onNewOrder={startNewOrder}
          />
        ) : !isOrderOpen ? (
          <DraftList
            drafts={localDrafts}
            onNewOrder={startNewOrder}
            onResume={restoreLocalDraft}
            onDelete={deleteLocalDraft}
          />
        ) : (
          <>
            <CartLines
              cart={cart}
              onHandByItem={onHandByItem}
              taxCalculationMode={taxCalculationMode}
              chargeTax={chargeTax}
              onOpen={lineEditor.open}
              onStep={stepCartLine}
              onRemove={removeCartLine}
            />

            <CartTotals
              totalTax={totalTax}
              orderDiscountAmount={resolvedOrderDiscountAmount}
              total={total}
              onEditOrderDiscount={() => orderDiscount.setOpen(true)}
            />

            <CustomerSection
              selectedCustomer={selectedCustomer}
              isWalkInSelected={isWalkInSelected}
              walkInName={walkInCustomerName}
              walkInPhone={walkInCustomerPhone}
              walletBalance={walletBalance}
              branchStateCode={chargeTax ? branchStateCode : null}
              placeOfSupply={placeOfSupplyChoice}
              onPlaceOfSupplyChange={setPlaceOfSupply}
              busy={checkout.isPending}
              onWalkIn={() => {
                setCustomerId("");
                setWalkInCustomerName("");
                setWalkInCustomerPhone("");
              }}
              onPickCustomer={() => setCustomerModalOpen(true)}
              onWalkInNameChange={setWalkInCustomerName}
              onWalkInPhoneChange={setWalkInCustomerPhone}
              onPayment={openPayment}
              onBack={backToOrders}
            />
          </>
        )}

        {checkout.error ? (
          <p className="mx-4 mb-3 rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700" role="alert">
            {(checkout.error as Error).message}
          </p>
        ) : null}
        {postPayment && receiptPrinting.error ? (
          <p className="mx-4 mb-3 rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700" role="alert">
            {receiptPrinting.error}
          </p>
        ) : null}
        {message ? (
          <p className="mx-4 mb-3 rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700" role="status">
            {message}
          </p>
        ) : null}
      </aside>

      <div className="flex h-full min-h-0 flex-col overflow-hidden bg-slate-100 print:bg-white print:p-0">
        {postPayment ? (
          <PrintableInvoice logoSrc={invoiceLogoSrc} receipt={printableInvoice} />
        ) : (
          <ProductGrid
            categories={categories}
            activeCategory={activeCategory}
            onCategoryChange={setActiveCategory}
            search={search}
            onSearchChange={setSearch}
            scanCode={scanCode}
            onScanCodeChange={setScanCode}
            onScan={addScannedItem}
            items={saleItemChoices}
            onHandByItem={onHandByItem}
            onAdd={addItem}
          />
        )}
      </div>

      {payment.open ? (
        <PaymentModal
          payment={payment}
          total={total}
          isWalkInSelected={isWalkInSelected}
          walletBalance={walletBalance}
          checkoutPending={checkout.isPending}
          onValidate={() => checkout.mutate({ payments: payment.lines })}
        />
      ) : null}

      {orderDiscount.open ? (
        <OrderDiscountModal
          base={orderDiscountBase}
          value={orderDiscount.value}
          mode={orderDiscount.mode}
          applied={resolvedOrderDiscountAmount}
          onKey={orderDiscount.press}
          onClose={() => orderDiscount.setOpen(false)}
        />
      ) : null}

      {lineEditor.activeEditLine ? (
        <LineEditorModal
          editor={lineEditor}
          activeEditLine={lineEditor.activeEditLine}
          taxCalculationMode={taxCalculationMode}
          chargeTax={chargeTax}
        />
      ) : null}

      {customerModalOpen ? (
        <CustomerPickerModal
          branchId={session.branchId}
          customers={customers.data ?? []}
          onSelect={(id) => {
            setCustomerId(id);
            setWalkInCustomerName("");
            setWalkInCustomerPhone("");
            setCustomerModalOpen(false);
          }}
          onClose={() => setCustomerModalOpen(false)}
        />
      ) : null}

      {leavePrompt ? <LeaveDialog totalItems={totalItems} total={total} onChoose={leavePrompt} /> : null}
    </section>
  );
}
