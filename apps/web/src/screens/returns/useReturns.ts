import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { api, authHeaders } from "../../lib/api";

/** The branch's returns, newest first, and the one selected in full. */
export function useReturns({
  branchId,
  selectedReturnId,
  createMode,
}: {
  branchId: string;
  selectedReturnId: string;
  /** While a new return is being made, the selected one is not shown. */
  createMode: boolean;
}) {
  // Returns a page at a time, newest first.
  const RETURNS_PAGE = 100;
  const returnPages = useInfiniteQuery({
    queryKey: ["returns-list", branchId],
    initialPageParam: null as { before: string; beforeId: string } | null,
    queryFn: async ({ pageParam }) => {
      const res = await api.returns.list({ query: { limit: RETURNS_PAGE, ...(pageParam ?? {}) }, extraHeaders: authHeaders() });
      if (res.status !== 200) throw new Error("Failed to load returns");
      return res.body;
    },
    getNextPageParam: (lastPage) => {
      const last = lastPage[lastPage.length - 1];
      return lastPage.length === RETURNS_PAGE && last ? { before: last.createdAt, beforeId: last.id } : undefined;
    },
  });
  const returnsList = useMemo(
    () => ({ data: returnPages.data?.pages.flat(), isLoading: returnPages.isLoading }),
    [returnPages.data, returnPages.isLoading],
  );

  const returnDetail = useQuery({
    queryKey: ["return-detail", selectedReturnId],
    enabled: !!selectedReturnId && !createMode,
    queryFn: async () => {
      const res = await api.returns.getById({
        params: { id: selectedReturnId },
        extraHeaders: authHeaders(),
      });
      if (res.status !== 200) throw new Error("Failed to load return details");
      return res.body;
    },
  });

  return { returnPages, returnsList, returnDetail };
}

export type Returns = ReturnType<typeof useReturns>;
