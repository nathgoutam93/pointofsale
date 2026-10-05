import { useMutation, useQueryClient } from "@tanstack/react-query";
import { api, apiErrorMessage, authHeaders } from "../../lib/api";
import type { StockModalType } from "./types";

/** Posting the selected item's opening stock (or changing it) and stock adjustments at the branch. */
export function useStockMutations({
  branchId,
  selectedItemId,
  openingQty,
  setOpeningQty,
  openingCostPrice,
  openingReason,
  adjustmentQty,
  setAdjustmentQty,
  adjustmentCostPrice,
  adjustmentReason,
  adjustmentDirection,
  setModalType,
}: {
  branchId: string;
  selectedItemId: string | null;
  openingQty: string;
  setOpeningQty: (qty: string) => void;
  openingCostPrice: string;
  openingReason: string;
  adjustmentQty: string;
  setAdjustmentQty: (qty: string) => void;
  adjustmentCostPrice: string;
  adjustmentReason: string;
  adjustmentDirection: "IN" | "OUT";
  setModalType: (type: StockModalType) => void;
}) {
  const queryClient = useQueryClient();

  const opening = useMutation({
    mutationFn: async () => {
      if (!selectedItemId) throw new Error("Please select an item");
      const res = await api.stock.opening({
        body: {
          branchId: branchId,
          itemId: selectedItemId,
          qty: Number(openingQty),
          costPrice: Number(openingCostPrice),
          reason: openingReason,
        },
        extraHeaders: authHeaders(),
      });
      if (res.status !== 201) throw new Error("Failed to post opening");
      return res.body;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["stock-module", branchId],
      });
      queryClient.invalidateQueries({
        queryKey: ["stock-ledger", branchId, selectedItemId],
      });
      setOpeningQty("0");
      setModalType(null);
    },
  });

  const updateOpening = useMutation({
    mutationFn: async () => {
      if (!selectedItemId) throw new Error("Please select an item");
      const res = await api.stock.updateOpening({
        body: {
          branchId: branchId,
          itemId: selectedItemId,
          qty: Number(openingQty),
          costPrice: Number(openingCostPrice),
          reason: openingReason,
        },
        extraHeaders: authHeaders(),
      });
      if (res.status !== 200) throw new Error(apiErrorMessage(res.body, "Failed to update opening"));
      return res.body;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["stock-module", branchId],
      });
      queryClient.invalidateQueries({
        queryKey: ["stock-ledger", branchId, selectedItemId],
      });
      setModalType(null);
    },
  });

  const adjustment = useMutation({
    mutationFn: async () => {
      if (!selectedItemId) throw new Error("Please select an item");
      const res = await api.stock.adjustment({
        body: {
          branchId: branchId,
          itemId: selectedItemId,
          qty: Number(adjustmentQty),
          direction: adjustmentDirection,
          costPrice: Number(adjustmentCostPrice),
          reason: adjustmentReason,
        },
        extraHeaders: authHeaders(),
      });
      if (res.status !== 201) throw new Error("Failed to post adjustment");
      return res.body;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["stock-module", branchId],
      });
      queryClient.invalidateQueries({
        queryKey: ["stock-ledger", branchId, selectedItemId],
      });
      setAdjustmentQty("0");
      setModalType(null);
    },
  });

  return { opening, updateOpening, adjustment };
}

export type StockMutations = ReturnType<typeof useStockMutations>;
