import { useMutation, useQueryClient } from "@tanstack/react-query";
import { api, apiErrorMessage, authHeaders } from "../../lib/api";
import type { BatchEntry, StockModalType } from "./types";

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
  tracksBatches,
  batch,
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
  /** The item is kept by batch: `batch` goes with each change. */
  tracksBatches: boolean;
  batch: BatchEntry;
}) {
  const queryClient = useQueryClient();
  const batchBody = tracksBatches && batch.batchNo.trim() ? { batchNo: batch.batchNo.trim(), expiryDate: batch.expiryDate || undefined } : {};
  const refreshBatches = () => queryClient.invalidateQueries({ queryKey: ["stock-batches", branchId] });

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
          ...batchBody,
        },
        extraHeaders: authHeaders(),
      });
      if (res.status !== 201) throw new Error(apiErrorMessage(res.body, "Failed to post opening"));
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
      void refreshBatches();
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
          ...batchBody,
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
          ...batchBody,
        },
        extraHeaders: authHeaders(),
      });
      if (res.status !== 201) throw new Error(apiErrorMessage(res.body, "Failed to post adjustment"));
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
      void refreshBatches();
      setModalType(null);
    },
  });

  return { opening, updateOpening, adjustment };
}

export type StockMutations = ReturnType<typeof useStockMutations>;
