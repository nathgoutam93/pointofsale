import { useInfiniteQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { api, authHeaders } from "../../lib/api";
import type { PaymentFilter } from "./types";

/**
 * The bills list: its search and filters (seeded from, and kept in step with, the page's URL)
 * and the bills matching them, loaded from the server a page at a time.
 */
export function useSalesList({
  branchId,
  salesSearch,
}: {
  branchId: string;
  /** The /sales route's search params. */
  salesSearch: { paymentFilter?: "PENDING" | "SETTLED"; customerId?: string; q?: string; status?: string };
}) {
  const [searchQuery, setSearchQuery] = useState(salesSearch.q ?? "");
  const [statusFilter, setStatusFilter] = useState(salesSearch.status ?? "ALL");
  const [paymentFilter, setPaymentFilter] = useState<PaymentFilter>(
    salesSearch.paymentFilter ?? "ALL",
  );
  const linkedCustomerId = salesSearch.customerId ?? "";

  useEffect(() => {
    setSearchQuery(salesSearch.q ?? "");
    setStatusFilter(salesSearch.status ?? "ALL");
    setPaymentFilter(salesSearch.paymentFilter ?? "ALL");
  }, [salesSearch.paymentFilter, salesSearch.q, salesSearch.status]);

  // Bills a page at a time (newest first), filtered on the server, so a branch with years of
  // bills opens as fast as a new one. The search waits for typing to pause.
  const [serverSearch, setServerSearch] = useState(searchQuery.trim());
  useEffect(() => {
    const timer = setTimeout(() => setServerSearch(searchQuery.trim()), 300);
    return () => clearTimeout(timer);
  }, [searchQuery]);
  const SALES_PAGE = 100;
  const salesPages = useInfiniteQuery({
    queryKey: ["sales-module", branchId, serverSearch, statusFilter, paymentFilter, linkedCustomerId],
    initialPageParam: null as { before: string; beforeId: string } | null,
    queryFn: async ({ pageParam }) => {
      const res = await api.sales.list({
        query: {
          branchId,
          limit: SALES_PAGE,
          ...(serverSearch ? { search: serverSearch } : {}),
          ...(statusFilter !== "ALL" ? { status: statusFilter as "DRAFT" | "SETTLED" | "PARTIALLY_SETTLED" | "CANCELLED" } : {}),
          ...(paymentFilter !== "ALL" ? { owed: paymentFilter === "PENDING" ? "true" : "false" } : {}),
          ...(linkedCustomerId ? { customerId: linkedCustomerId } : {}),
          ...(pageParam ?? {}),
        },
        extraHeaders: authHeaders(),
      });
      if (res.status !== 200) throw new Error("Failed to load sales");
      return res.body;
    },
    getNextPageParam: (lastPage) => {
      const last = lastPage[lastPage.length - 1];
      return lastPage.length === SALES_PAGE && last ? { before: last.createdAt, beforeId: last.id } : undefined;
    },
  });
  const sales = useMemo(
    () => ({ data: salesPages.data?.pages.flat(), error: salesPages.error }),
    [salesPages.data, salesPages.error],
  );

  return {
    searchQuery,
    setSearchQuery,
    statusFilter,
    setStatusFilter,
    paymentFilter,
    setPaymentFilter,
    linkedCustomerId,
    salesPages,
    sales,
  };
}

export type SalesList = ReturnType<typeof useSalesList>;
/** A bill as the list has it. */
export type SaleListInvoice = NonNullable<SalesList["sales"]["data"]>[number];
