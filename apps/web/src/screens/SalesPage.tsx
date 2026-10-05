import { useQuery } from "@tanstack/react-query";
import { useSearch } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import { invoiceDue } from "@pos/contracts";
import { api, authHeaders } from "../lib/api";
import { useReceiptPrinting } from "../lib/printing";
import { ReceiptView } from "../components/ReceiptView";
import { ReceiptPrintStyles } from "./pos/ReceiptPrintStyles";
import { EmailReceipt } from "../components/EmailReceipt";
import { useManagedBranch } from "../lib/branch";
import { can } from "../lib/session";
import { requireManagementSession } from "./route-helpers";
import { InvoiceDetailsCard } from "./sales/InvoiceDetailsCard";
import { InvoiceToolbar } from "./sales/InvoiceToolbar";
import { SalesFilters } from "./sales/SalesFilters";
import { SalesList } from "./sales/SalesList";
import { SettledPanel } from "./sales/SettledPanel";
import { SettleModal } from "./sales/SettleModal";
import { useFilteredSales } from "./sales/useFilteredSales";
import { useInvoiceActions } from "./sales/useInvoiceActions";
import { useInvoiceDetails } from "./sales/useInvoiceDetails";
import { useReceiptSettings } from "./sales/useReceiptSettings";
import { useSaleReceipt } from "./sales/useSaleReceipt";
import { useSalesList } from "./sales/useSalesList";
import { useSettlePayment, useSettlePaymentKeys } from "./sales/useSettlePayment";
import type { SettledSummary } from "./sales/types";

export function SalesPage() {
  const session = requireManagementSession();
  const [managedBranch, setManagedBranch] = useManagedBranch();
  const branchId = managedBranch ?? "";
  // Payments are taken at a register: only at the branch where this user's register is open.
  const canTakePayment = Boolean(session.registerId) && session.branchId === branchId;
  const salesSearch = useSearch({ from: "/sales" });
  const formatSaleCreator = useCallback(
    (createdBy: string, createdByName?: string) => {
      const name = createdByName?.trim() || "Unknown User";
      if (createdBy === session.userId) {
        return session.username?.trim() || name;
      }
      return name;
    },
    [session.userId, session.username],
  );

  const [selectedInvoiceId, setSelectedInvoiceId] = useState("");
  const [message, setMessage] = useState("");
  const receiptPrinting = useReceiptPrinting();
  const [selectedReceiptId, setSelectedReceiptId] = useState("");
  const [asA4, setAsA4] = useState(false);
  const [settledSummary, setSettledSummary] = useState<SettledSummary | null>(
    null,
  );
  const {
    searchQuery,
    setSearchQuery,
    statusFilter,
    setStatusFilter,
    paymentFilter,
    setPaymentFilter,
    linkedCustomerId,
    salesPages,
    sales,
  } = useSalesList({ branchId, salesSearch });

  const store = useReceiptSettings(branchId);
  const { businessSettings, receiptLogoSrc } = store;

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
    queryKey: ["customers-sales", branchId],
    queryFn: async () => {
      const res = await api.customers.list({
        query: { branchId: branchId },
        extraHeaders: authHeaders(),
      });
      if (res.status !== 200) throw new Error("Failed to load customers");
      return res.body;
    },
  });

  const { selectedInvoiceDetails, selectedReceipts } = useInvoiceDetails(selectedInvoiceId);

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
        (invoice) => invoiceDue(invoice) > 0,
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
      invoiceDue(currentInvoice);
    return Math.max(0, pending);
  }, [currentInvoice]);

  const payment = useSettlePayment({
    branchId,
    selectedCustomer,
    isRegisteredCustomer,
    currentInvoice,
    pendingAmount,
    setMessage,
  });

  // An unpaid draft (one left by a failed checkout, or a credit sale nothing is paid on) can be
  // cancelled on the day it was made, by admins and cashiers allowed to; its stock goes back.
  // Later, the way out is a return.
  const shopDay = (date: Date | string) =>
    new Intl.DateTimeFormat("en-CA", { timeZone: businessSettings.data?.timezone }).format(new Date(date));
  const canCancelInvoice =
    can(session, "CANCEL_SALES") &&
    currentInvoice?.status === "DRAFT" &&
    Number(currentInvoice?.paidTotal ?? 0) === 0 &&
    Number(currentInvoice?.creditedTotal ?? 0) === 0 &&
    shopDay(currentInvoice.createdAt) === shopDay(new Date());

  const { cancelInvoice, settleInvoice } = useInvoiceActions({
    branchId,
    itemUomById,
    receiptPrinting,
    payment,
    setSettledSummary,
    setSelectedInvoiceId,
    setSelectedReceiptId,
    setMessage,
  });

  useSettlePaymentKeys({ payment, settleInvoice, currentInvoice });

  const { filteredSales, filteredPendingInvoices } = useFilteredSales({
    sales,
    linkedCustomerId,
    paymentFilter,
    statusFilter,
    searchQuery,
    session,
    selectedInvoiceId,
    setSelectedInvoiceId,
  });

  const {
    saleLines,
    paymentBreakdown,
    invoiceSubTotal,
    invoiceTaxTotal,
    invoiceGrandTotal,
    printableReceipt,
    receiptStyle,
  } = useSaleReceipt({
    settledSummary,
    selectedInvoiceDetails,
    currentInvoice,
    previewReceipt,
    currentSaleCreatorId,
    currentSaleCreatorName,
    formatSaleCreator,
    itemUomById,
    store,
    asA4,
  });

  return (
    <section className="grid grid-cols-1 xl:h-[calc(100vh-48px)] xl:grid-cols-[360px_1fr]">
      <ReceiptPrintStyles css={receiptStyle.css} />

      <aside className="flex h-full max-h-[75vh] flex-col overflow-hidden border-r border-slate-200 bg-white xl:max-h-none">
        {settledSummary ? (
          <SettledPanel
            settledSummary={settledSummary}
            defaultEmail={selectedCustomer?.email}
            onBack={() => setSettledSummary(null)}
          />
        ) : (
          <>
            <SalesFilters
              pendingCount={filteredPendingInvoices.length}
              invoiceCount={filteredSales.length}
              branchId={branchId}
              onBranchChange={(next) => {
                setManagedBranch(next);
                setSelectedInvoiceId("");
                setSettledSummary(null);
              }}
              searchQuery={searchQuery}
              setSearchQuery={setSearchQuery}
              statusFilter={statusFilter}
              setStatusFilter={setStatusFilter}
              paymentFilter={paymentFilter}
              setPaymentFilter={setPaymentFilter}
              linkedCustomerId={linkedCustomerId}
              linkedCustomer={linkedCustomer}
              hasNextPage={salesPages.hasNextPage}
            />

            <SalesList
              filteredSales={filteredSales}
              selectedInvoiceId={selectedInvoiceId}
              onSelect={(invoiceId) => {
                setSelectedInvoiceId(invoiceId);
                setMessage("");
              }}
              formatSaleCreator={formatSaleCreator}
              timeZone={businessSettings.data?.timezone}
              salesPages={salesPages}
            />
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
        <InvoiceToolbar
          title={settledSummary?.invoiceNo ?? currentInvoice?.invoiceNo ?? "No invoice selected"}
          currentInvoice={currentInvoice}
          canCancelInvoice={canCancelInvoice}
          cancelInvoice={cancelInvoice}
          setMessage={setMessage}
          printing={receiptPrinting.busy}
          onPrint={() =>
            void receiptPrinting.print(receiptStyle)
          }
          asA4={asA4}
          onToggleA4={() => setAsA4((current) => !current)}
          onSettle={payment.openSettleModal}
          canTakePayment={canTakePayment}
          pendingAmount={pendingAmount}
          settlePending={settleInvoice.isPending}
        />

        <div className="min-h-0 flex-1 overflow-y-auto p-6 print:overflow-visible print:p-0">
        <div className="mx-auto grid w-full max-w-6xl items-start gap-6 lg:grid-cols-[minmax(0,1fr)_380px]">
          <InvoiceDetailsCard
            currentInvoice={currentInvoice}
            currentCustomerName={currentCustomerName}
            currentSaleCreatorId={currentSaleCreatorId}
            currentSaleCreatorName={currentSaleCreatorName}
            formatSaleCreator={formatSaleCreator}
            invoiceGrandTotal={invoiceGrandTotal}
            pendingAmount={pendingAmount}
            timeZone={businessSettings.data?.timezone}
            saleLines={saleLines}
            itemUomById={itemUomById}
            invoiceSubTotal={invoiceSubTotal}
            invoiceTaxTotal={invoiceTaxTotal}
            paymentBreakdown={paymentBreakdown}
            receiptsForInvoice={receiptsForInvoice}
            previewReceipt={previewReceipt}
            onSelectReceipt={setSelectedReceiptId}
          />

          <div className="grid content-start gap-4">
            <ReceiptView receipt={printableReceipt} logoSrc={receiptLogoSrc} className="card w-full p-5" />
            {currentInvoice ? (
              <div className="card p-4 print:hidden">
                <EmailReceipt key={currentInvoice.id} invoiceId={currentInvoice.id} defaultEmail={selectedCustomer?.email} />
              </div>
            ) : null}
          </div>
        </div>
        </div>
      </div>

      {payment.paymentModalOpen ? (
        <SettleModal
          payment={payment}
          isRegisteredCustomer={isRegisteredCustomer}
          pendingAmount={pendingAmount}
          currentInvoice={currentInvoice}
          settleInvoice={settleInvoice}
        />
      ) : null}
    </section>
  );
}
