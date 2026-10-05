import { useEffect, useMemo, useRef, useState } from "react";
import { computeSaleTotals } from "@pos/contracts";
import { receiptPrinterSettings, useReceiptPrinting } from "../lib/printing";
import { removeDrafts, upsertDraft } from "../lib/draftStore";
import { inr, requireOperationalSession } from "./route-helpers";
import { getCartLineKey, stepLineQty } from "./pos/cartMath";
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
import { useAddToCart } from "./pos/useAddToCart";
import { useCatalog } from "./pos/useCatalog";
import { itemDiscountsFor, useCheckout } from "./pos/useCheckout";
import { useLeaveGuard } from "./pos/useLeaveGuard";
import { useLineEditor } from "./pos/useLineEditor";
import { useLocalDrafts } from "./pos/useLocalDrafts";
import { useOrderDiscount } from "./pos/useOrderDiscount";
import { usePayment } from "./pos/usePayment";
import { usePosCustomer } from "./pos/usePosCustomer";
import { useStoreSettings } from "./pos/useStoreSettings";
import type { CartLine, LocalSaleDraft, PostPaymentSummary } from "./pos/types";

export function PosPage() {
  const session = requireOperationalSession();
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
  // A registered buyer's order or reference number, printed on their bill.
  const [reference, setReference] = useState("");
  const [message, setMessage] = useState("");
  const [postPayment, setPostPayment] = useState<PostPaymentSummary | null>(
    null,
  );
  const orderDiscount = useOrderDiscount();
  const orderDiscounts = orderDiscount.discounts;
  const draftStorageKey = useMemo(
    () => `pos_sale_drafts:${session.branchId}:${session.userId}`,
    [session.branchId, session.userId],
  );
  const { localDrafts, setLocalDrafts, activeDraftIdRef, setActiveDraft } = useLocalDrafts(draftStorageKey);
  const [isOrderOpen, setIsOrderOpen] = useState(false);

  const store = useStoreSettings(session.branchId);
  const { chargeTax, roundOffMode, invoiceLogoSrc, customReceiptCss, printTemplate } = store;
  const lineEditor = useLineEditor({ cart, setCart, chargeTax });

  const printableInvoice = useMemo(
    () => (postPayment ? buildInvoiceReceipt(postPayment, store, session.username ?? "") : null),
    // `store` is a new object every render; these are the parts the receipt is built from.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [postPayment, store.businessSettings.data, store.branchSettings.data, session.username],
  );

  const receiptPrinting = useReceiptPrinting();
  const receiptStyle = receiptStyleFor(printableInvoice ?? { columns: 48 }, printTemplate, customReceiptCss);
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
  }, [postPayment, receiptPrinting, receiptStyle]);

  const exportPrintableInvoice = () => {
    const htmlDocument = postPayment ? buildPrintableInvoiceDocument(postPayment, receiptStyle) : null;
    if (!htmlDocument) {
      setMessage("Printable invoice is not ready to download yet.");
      return;
    }
    downloadHtml(htmlDocument, `invoice-${postPayment?.invoiceNo ?? "receipt"}.html`);
    setMessage("Receipt downloaded. Share the file on WhatsApp or anywhere else.");
  };

  const { items, categories, allSaleItemChoices, saleItemChoices, onHandByItem } = useCatalog({
    branchId: session.branchId,
    search,
    activeCategory,
  });

  const customer = usePosCustomer({
    branchId: session.branchId,
    customerId,
    walkInCustomerName,
    walkInCustomerPhone,
  });
  const {
    customers,
    selectedCustomer,
    isWalkInSelected,
    normalizedWalkInCustomerName,
    normalizedWalkInCustomerPhone,
    displayCustomerName,
    displayCustomerPhone,
    walletBalance,
    account,
  } = customer;

  const computedCart = useMemo(() => {
    const totals = computeSaleTotals(
      cart.map((line) => ({ ...line, discounts: itemDiscountsFor(line) })),
      orderDiscounts,
      { chargeTax, roundOff: roundOffMode },
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
      roundOff: totals.roundOff,
      orderDiscountTotal: totals.orderDiscountTotal,
      orderDiscountBase: totals.orderDiscountBase,
    };
  }, [cart, orderDiscounts, chargeTax, roundOffMode]);
  const orderDiscountBase = computedCart.orderDiscountBase;
  const resolvedOrderDiscountAmount = computedCart.orderDiscountTotal;

  const { addItem, addScannedItem } = useAddToCart({
    setCart,
    setIsOrderOpen,
    scanCode,
    setScanCode,
    setMessage,
    allSaleItemChoices,
    itemsData: items.data,
    store,
  });

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
    setCustomerId("");
    setWalkInCustomerName("");
    setWalkInCustomerPhone("");
    setPlaceOfSupply(null);
    setReference("");
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
      reference: reference.trim() || null,
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
    setCustomerId(draft.customerId);
    setWalkInCustomerName(draft.walkInCustomerName ?? "");
    setWalkInCustomerPhone(draft.walkInCustomerPhone ?? "");
    setPlaceOfSupply(draft.placeOfSupplyStateCode ?? null);
    setReference(draft.reference ?? "");
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

  const { checkout } = useCheckout({
    branchId: session.branchId,
    cart,
    setCart,
    customerId,
    customer,
    placeOfSupplyChoice,
    reference,
    orderDiscounts,
    draftStorageKey,
    activeDraftIdRef,
    setLocalDrafts,
    setActiveDraft,
    payment,
    setPostPayment,
    setMessage,
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
            onDownload={exportPrintableInvoice}
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
              chargeTax={chargeTax}
              onOpen={lineEditor.open}
              onStep={stepCartLine}
              onRemove={removeCartLine}
            />

            <CartTotals
              totalTax={totalTax}
              orderDiscountAmount={resolvedOrderDiscountAmount}
              roundOff={computedCart.roundOff}
              total={total}
              onEditOrderDiscount={() => orderDiscount.setOpen(true)}
            />

            <CustomerSection
              selectedCustomer={selectedCustomer}
              isWalkInSelected={isWalkInSelected}
              walkInName={walkInCustomerName}
              walkInPhone={walkInCustomerPhone}
              walletBalance={walletBalance}
              account={account}
              branchStateCode={chargeTax ? branchStateCode : null}
              placeOfSupply={placeOfSupplyChoice}
              onPlaceOfSupplyChange={setPlaceOfSupply}
              reference={reference}
              onReferenceChange={setReference}
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
          account={account}
          isAdmin={session.role === "ADMIN"}
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
