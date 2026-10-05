import { useEffect, useMemo } from "react";
import { invoiceDue } from "@pos/contracts";
import type { Session } from "../../lib/session";
import type { PaymentFilter } from "./types";
import type { SaleListInvoice } from "./useSalesList";

/**
 * The loaded bills that match the filters and search, and those with money still owed.
 * Keeps a bill selected: the first match when the selected one is filtered out.
 */
export function useFilteredSales({
  sales,
  linkedCustomerId,
  paymentFilter,
  statusFilter,
  searchQuery,
  session,
  selectedInvoiceId,
  setSelectedInvoiceId,
}: {
  sales: { data: SaleListInvoice[] | undefined };
  linkedCustomerId: string;
  paymentFilter: PaymentFilter;
  statusFilter: string;
  searchQuery: string;
  session: Pick<Session, "userId" | "username">;
  selectedInvoiceId: string;
  setSelectedInvoiceId: (id: string) => void;
}) {
  const filteredSales = useMemo(() => {
    let list = sales.data ?? [];
    if (linkedCustomerId) {
      list = list.filter((invoice) => invoice.customerId === linkedCustomerId);
    }
    if (paymentFilter !== "ALL") {
      list = list.filter((invoice) => {
        const pending =
          invoiceDue(invoice) > 0;
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
        (invoice) => invoiceDue(invoice) > 0,
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
  }, [filteredSales, selectedInvoiceId, setSelectedInvoiceId]);

  return { filteredSales, filteredPendingInvoices };
}
