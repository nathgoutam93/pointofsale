import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useRef } from "react";
import type { Dispatch, MutableRefObject, SetStateAction } from "react";
import { batchLabel, type DiscountInput } from "@pos/contracts";
import { api, apiErrorMessage, authHeaders } from "../../lib/api";
import { newUuid } from "../../lib/id";
import { removeDrafts } from "../../lib/draftStore";
import { invoiceGstOf } from "../../lib/gstReceipt";
import { getCartLineKey } from "./cartMath";
import type { CartLine, LocalSaleDraft, PaymentMode, PostPaymentSummary } from "./types";
import type { Payment } from "./usePayment";
import type { PosCustomer } from "./usePosCustomer";

// The discounts exactly as checkout sends them, so the totals shown here are the
// totals the server computes (same request, same computeSaleTotals).
export const itemDiscountsFor = (line: Pick<CartLine, "discountAmount">): DiscountInput[] =>
  line.discountAmount > 0 ? [{ type: "FIXED", value: line.discountAmount }] : [];

/**
 * Checkout: makes and pays the sale in one request, then shows its result, clears the cart
 * and removes the cart's saved draft.
 */
export function useCheckout({
  branchId,
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
}: {
  branchId: string;
  cart: CartLine[];
  setCart: Dispatch<SetStateAction<CartLine[]>>;
  /** The customer picked; "" for the walk-in. */
  customerId: string;
  customer: Pick<
    PosCustomer,
    "walkIn" | "selectedCustomer" | "isWalkInSelected" | "normalizedWalkInCustomerName" | "normalizedWalkInCustomerPhone"
  >;
  /** The state the goods are shipped to, when that counts; null for the branch's own. */
  placeOfSupplyChoice: string | null;
  reference: string;
  orderDiscounts: DiscountInput[];
  draftStorageKey: string;
  activeDraftIdRef: MutableRefObject<string | null>;
  setLocalDrafts: (drafts: LocalSaleDraft[]) => void;
  setActiveDraft: (id: string | null) => void;
  payment: Pick<Payment, "reset">;
  setPostPayment: (summary: PostPaymentSummary | null) => void;
  setMessage: (message: string) => void;
}) {
  const queryClient = useQueryClient();
  const { walkIn, selectedCustomer, isWalkInSelected, normalizedWalkInCustomerName, normalizedWalkInCustomerPhone } =
    customer;

  // One idempotency key per checkout attempt. A retry of exactly the same request (e.g.
  // after a network error) reuses it, so the server returns the invoice it already made
  // instead of billing twice; any change to the cart or payments gets a new key.
  const checkoutKeyRef = useRef<{ key: string; fingerprint: string } | null>(null);

  const buildSaleBody = () => {
    if (cart.length === 0) throw new Error("Cart is empty");

    const selected = customerId || walkIn.data?.id;
    if (!selected) throw new Error("Customer not resolved");

    return {
      branchId: branchId,
      customerId: selected,
      walkInCustomerName: isWalkInSelected ? normalizedWalkInCustomerName || null : null,
      walkInCustomerPhone: isWalkInSelected ? normalizedWalkInCustomerPhone || null : null,
      // Only a shipped regular sale names one; otherwise the server uses the branch's state.
      placeOfSupplyStateCode: placeOfSupplyChoice ?? undefined,
      reference: !isWalkInSelected && reference.trim() ? reference.trim() : undefined,
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
      payments: Array<{ mode: PaymentMode; amount: number; tendered?: number }>;
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
        invoiceId: result.invoice.id,
        invoiceNo: result.invoice.invoiceNo,
        receiptNo: result.receipt?.receiptNo ?? null,
        createdAt: result.receipt?.createdAt ?? result.invoice.createdAt,
        customerName: result.invoice.customerName,
        customerPhone: result.invoice.customerPhone ?? "",
        customerEmail: selectedCustomer && !selectedCustomer.isWalkIn ? selectedCustomer.email : null,
        subTotal: Number(result.invoice.subTotal),
        orderDiscountAmount: Number(result.invoice.orderDiscountAmount ?? 0),
        taxTotal: Number(result.invoice.taxTotal),
        grandTotal: Number(result.invoice.grandTotal),
        roundOff: Number(result.invoice.roundOff ?? 0),
        paidTotal: Number(result.invoice.paidTotal ?? 0),
        gst: invoiceGstOf(result.invoice),
        paymentLines: result.invoice.payments.map((line) => ({
          mode: line.mode,
          amount: Number(line.amount),
          tendered: line.tendered === null || line.tendered === undefined ? null : Number(line.tendered),
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
            batches: batchLabel(line.batches),
          };
        }),
      });
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
        queryKey: ["sales-module", branchId],
      });
      queryClient.invalidateQueries({
        queryKey: ["stock-module", branchId],
      });
      queryClient.invalidateQueries({ queryKey: ["customer-account"] });
    },
  });

  return { checkout };
}
