import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { api, authHeaders } from "../../lib/api";

/** The bills matching what is typed, found on the server (the search waits for typing to pause). */
export function useBillSearch({
  branchId,
  invoiceSearch,
  createMode,
}: {
  branchId: string;
  /** What is typed in Search Invoice. */
  invoiceSearch: string;
  /** Bills are searched only while a new return is being made. */
  createMode: boolean;
}) {
  const [billSearch, setBillSearch] = useState("");
  useEffect(() => {
    const timer = setTimeout(() => setBillSearch(invoiceSearch.trim()), 250);
    return () => clearTimeout(timer);
  }, [invoiceSearch]);
  const sales = useQuery({
    queryKey: ["sales-module", branchId, "return-search", billSearch],
    enabled: createMode && billSearch.length > 0,
    queryFn: async () => {
      const res = await api.sales.list({
        query: { branchId: branchId, search: billSearch, limit: 20 },
        extraHeaders: authHeaders(),
      });
      if (res.status !== 200) throw new Error("Failed to load sales");
      return res.body;
    },
  });

  return { sales };
}

/** A bill found by the search. */
export type ReturnableInvoice = NonNullable<ReturnType<typeof useBillSearch>["sales"]["data"]>[number];
