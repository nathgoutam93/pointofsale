import { useMemo, useState } from "react";
import type { Dispatch, SetStateAction } from "react";
import {
  formatPercentValue,
  formatQty,
  getBaseExclusive,
  getCartLineKey,
  getDiscountPercent,
  snapQtyToLeastCount,
} from "./cartMath";
import type { CartLine } from "./types";
import type { DiscountMode } from "./useOrderDiscount";

export type EditField = "QTY" | "DISCOUNT" | "PRICE";

/** The line with `value` typed into `field`, kept within the line's limits. */
function buildEditedLine(line: CartLine, field: EditField, value: string, mode: DiscountMode) {
  const input = Number(value);
  if (!Number.isFinite(input)) return line;
  let qty = line.qty;
  let saleUomQty = line.saleUomQty;
  let rate = line.rate;
  let discountAmount = line.discountAmount;
  if (field === "QTY") {
    if (line.saleUomConversionQty) {
      saleUomQty = Math.max(1, Math.round(input));
      qty = snapQtyToLeastCount(saleUomQty * line.saleUomConversionQty, line.leastCount);
    } else {
      qty = snapQtyToLeastCount(input, line.leastCount);
    }
  }
  if (field === "PRICE") {
    rate = Math.max(0, input);
  }
  if (field === "DISCOUNT") {
    if (mode === "PERCENT") {
      const baseExclusive = getBaseExclusive({ ...line, qty, saleUomQty, rate });
      discountAmount = Math.max(0, (baseExclusive * input) / 100);
    } else {
      discountAmount = Math.max(0, input);
    }
  }
  const baseExclusive = getBaseExclusive({ ...line, qty, saleUomQty, rate });
  if (discountAmount > baseExclusive) discountAmount = baseExclusive;
  return { ...line, qty, saleUomQty, rate, discountAmount };
}

/**
 * Editing one cart line on a keypad: which field is being typed (quantity, discount or
 * price), the typed value, and a draft copy of the line that is written back to the cart
 * only on Apply.
 */
export function useLineEditor({
  cart,
  setCart,
}: {
  cart: CartLine[];
  setCart: Dispatch<SetStateAction<CartLine[]>>;
}) {
  const [editLineId, setEditLineId] = useState<string | null>(null);
  const [editField, setEditField] = useState<EditField>("QTY");
  const [editValue, setEditValue] = useState("1");
  const [discountMode, setDiscountMode] = useState<DiscountMode>("AMOUNT");
  const [draftLine, setDraftLine] = useState<CartLine | null>(null);

  const activeEditLine = useMemo(
    () => cart.find((line) => getCartLineKey(line) === editLineId) ?? null,
    [cart, editLineId],
  );
  const displayEditLine = draftLine ?? activeEditLine;

  const selectField = (field: EditField, line: CartLine, mode: DiscountMode = discountMode) => {
    setEditField(field);
    if (field === "QTY") {
      setEditValue(String(line.saleUomQty ?? formatQty(line.qty, line.leastCount)));
      return;
    }
    if (field === "PRICE") {
      setEditValue(String(line.rate));
      return;
    }
    if (mode === "PERCENT") {
      setEditValue(formatPercentValue(getDiscountPercent(line)));
      return;
    }
    setEditValue(String(line.discountAmount));
  };

  const open = (line: CartLine) => {
    setEditLineId(getCartLineKey(line));
    setDiscountMode("AMOUNT");
    selectField("QTY", line, "AMOUNT");
    setDraftLine({ ...line });
  };

  const close = () => {
    setEditLineId(null);
    setEditValue("1");
    setEditField("QTY");
    setDiscountMode("AMOUNT");
    setDraftLine(null);
  };

  /** Shows `next` as the typed value and recomputes the draft line from it. */
  const typeValue = (update: (current: string) => string) => {
    setEditValue((current) => {
      const next = update(current);
      if (draftLine) {
        setDraftLine(buildEditedLine(draftLine, editField, next, discountMode));
      }
      return next;
    });
  };

  const press = (key: string) => {
    if (key === "C") {
      typeValue(() => "0");
      return;
    }
    if (key === "<") {
      typeValue((current) => (current.length <= 1 ? "0" : current.slice(0, -1)));
      return;
    }
    if (key === "+/-") {
      typeValue((current) => {
        if (current === "0") return current;
        return current.startsWith("-") ? current.slice(1) : `-${current}`;
      });
      return;
    }
    if (key === ".") {
      typeValue((current) => (current.includes(".") ? current : `${current}.`));
      return;
    }
    if (key === "QTY" || key === "PRICE" || key === "DISCOUNT") {
      if (draftLine) {
        selectField(key, draftLine);
      }
      return;
    }
    if (key === "%") {
      if (editField !== "DISCOUNT") {
        if (draftLine) {
          selectField("DISCOUNT", draftLine);
        }
        return;
      }
      const nextMode = discountMode === "AMOUNT" ? "PERCENT" : "AMOUNT";
      setDiscountMode(nextMode);
      if (draftLine) {
        selectField("DISCOUNT", draftLine, nextMode);
      }
      return;
    }

    if (!/^\d$/.test(key)) return;
    typeValue((current) => (current === "0" ? key : `${current}${key}`));
  };

  const apply = () => {
    if (!activeEditLine) return;
    const key = getCartLineKey(activeEditLine);
    setCart((prev) => prev.map((line) => (getCartLineKey(line) === key ? draftLine ?? line : line)));
    close();
  };

  const remove = () => {
    if (!activeEditLine) return;
    const key = getCartLineKey(activeEditLine);
    setCart((prev) => prev.filter((line) => getCartLineKey(line) !== key));
    close();
  };

  return {
    editLineId,
    activeEditLine,
    displayEditLine,
    editField,
    editValue,
    discountMode,
    open,
    close,
    selectField,
    press,
    apply,
    remove,
  };
}

export type LineEditor = ReturnType<typeof useLineEditor>;
