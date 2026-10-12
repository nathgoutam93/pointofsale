import type { Dispatch, SetStateAction } from "react";
import { parseScaleBarcode, sameScaleItemCode, scaleBarcodeSchema } from "@pos/contracts";
import { getCartLineKey, normalizeLeastCount, round3, snapQtyToLeastCount } from "./cartMath";
import type { CartLine } from "./types";
import type { Catalog } from "./useCatalog";
import type { StoreSettings } from "./useStoreSettings";

/** Adding to the cart: an item tapped in the grid, or what was scanned or typed as a code. */
export function useAddToCart({
  setCart,
  setIsOrderOpen,
  scanCode,
  setScanCode,
  setMessage,
  allSaleItemChoices,
  itemsData,
  store,
}: {
  setCart: Dispatch<SetStateAction<CartLine[]>>;
  setIsOrderOpen: (open: boolean) => void;
  scanCode: string;
  setScanCode: (code: string) => void;
  setMessage: (message: string) => void;
  /** Every item, once per unit it is sold in. */
  allSaleItemChoices: Catalog["allSaleItemChoices"];
  /** The items as loaded, with their barcodes. */
  itemsData: Catalog["items"]["data"];
  store: Pick<StoreSettings, "businessSettings">;
}) {
  const addItem = (item: {
    id: string;
    name: string;
    uom?: string;
    sellPrice: number | string;
    taxRate: number | string;
    taxMode?: "INCLUSIVE" | "EXCLUSIVE";
    leastCount?: number | string;
    imageUrl?: string | null;
    saleUom?: string;
    saleUomQty?: number;
    saleUomConversionQty?: number;
  }, options: { qty?: number } = {}) => {
    setIsOrderOpen(true);
    const rate = Number(item.sellPrice) || 0;
    const taxRate = Number(item.taxRate) || 0;
    const taxMode = item.taxMode ?? "EXCLUSIVE";
    const leastCount = normalizeLeastCount(item.leastCount);
    const displayUom = item.saleUom ?? item.uom;
    const saleUom = item.saleUom;
    const saleUomQty = item.saleUomQty ?? 1;
    const saleUomConversionQty = normalizeLeastCount(item.saleUomConversionQty ?? leastCount);
    // A weighed item's label says how much (options.qty, in the base unit).
    const qty = item.saleUom
      ? snapQtyToLeastCount(saleUomQty * saleUomConversionQty, leastCount)
      : options.qty !== undefined
        ? snapQtyToLeastCount(options.qty, leastCount)
        : leastCount;
    const cartKey = `${item.id}:${displayUom ?? "BASE"}`;
    setCart((prev) => {
      const idx = prev.findIndex((l) => getCartLineKey(l) === cartKey);
      if (idx === -1) {
        return [
          ...prev,
          {
            cartKey,
            itemId: item.id,
            name: item.name,
            qty,
            leastCount,
            rate,
            baseUom: item.uom,
            saleUom,
            saleUomQty: item.saleUom ? saleUomQty : undefined,
            saleUomConversionQty: item.saleUom ? saleUomConversionQty : undefined,
            discountAmount: 0,
            taxRate,
            taxMode,
            imageUrl: item.imageUrl,
          },
        ];
      }
      const next = [...prev];
      next[idx] = {
        ...next[idx],
        qty: round3(next[idx].qty + qty),
        saleUomQty: next[idx].saleUomQty === undefined ? undefined : round3(next[idx].saleUomQty + saleUomQty),
      };
      return next;
    });
  };

  /**
   * Adds what was scanned or typed: an item by its code, or by one of its barcodes (a box's
   * barcode adds the box), or a weighing scale's label (the item with the weight, or the
   * weight its price buys).
   */
  const addScannedItem = () => {
    const scanned = scanCode.trim();
    const normalizedCode = scanned.toLowerCase();
    if (!normalizedCode) return;

    const codeMatches = allSaleItemChoices.filter(
      (item) => item.code.trim().toLowerCase() === normalizedCode,
    );
    const barcodeOwner = (itemsData ?? [])
      .flatMap((item) => (item.barcodes ?? []).map((entry) => ({ item, entry })))
      .find(({ entry }) => entry.barcode.toLowerCase() === normalizedCode);
    const match =
      codeMatches.find((item) => !item.saleUom) ??
      codeMatches[0] ??
      (barcodeOwner
        ? allSaleItemChoices.find(
            (choice) =>
              choice.id === barcodeOwner.item.id &&
              (barcodeOwner.entry.saleUom
                ? choice.saleUom?.toLowerCase() === barcodeOwner.entry.saleUom.toLowerCase()
                : !choice.saleUom),
          )
        : undefined) ??
      allSaleItemChoices.find(
        (item) => item.choiceKey.toLowerCase() === normalizedCode,
      );

    if (match) {
      addItem(match);
      setScanCode("");
      setMessage(`Added ${match.name} (${match.displayUom})`);
      return;
    }

    const scaleConfig = scaleBarcodeSchema.safeParse(store.businessSettings.data?.scaleBarcode);
    const label = scaleConfig.success ? parseScaleBarcode(scanned, scaleConfig.data) : null;
    const weighed = label ? allSaleItemChoices.find((choice) => !choice.saleUom && sameScaleItemCode(label.itemCode, choice.code)) : undefined;
    if (label && weighed) {
      const rate = Number(weighed.sellPrice) || 0;
      const qty = label.qty ?? (rate > 0 ? round3((label.price ?? 0) / rate) : 0);
      if (qty <= 0) {
        setMessage(`The label for ${weighed.name} has no quantity`);
        return;
      }
      addItem(weighed, { qty });
      setScanCode("");
      setMessage(`Added ${qty} ${weighed.displayUom} of ${weighed.name}`);
      return;
    }

    setMessage(`No item found for code ${scanned}`);
  };

  return { addItem, addScannedItem };
}
