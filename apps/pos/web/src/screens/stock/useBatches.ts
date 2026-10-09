import { useQuery } from "@tanstack/react-query";
import { api, authHeaders } from "../../lib/api";

/** Batches with stock at the branch: of one item, or those expiring within `expiringWithinDays` days. */
export function useBatches(branchId: string, filter: { itemId?: string; expiringWithinDays?: number }, enabled = true) {
  return useQuery({
    queryKey: ["stock-batches", branchId, filter.itemId ?? null, filter.expiringWithinDays ?? null],
    enabled: enabled && !!branchId,
    queryFn: async () => {
      const res = await api.stock.batches({
        query: { branchId, itemId: filter.itemId, expiringWithinDays: filter.expiringWithinDays },
        extraHeaders: authHeaders(),
      });
      if (res.status !== 200) throw new Error("Failed to load batches");
      return res.body;
    },
  });
}
