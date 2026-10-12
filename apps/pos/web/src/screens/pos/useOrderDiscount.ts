import { useMemo, useState } from "react";
import type { DiscountInput } from "@pos/contracts";

export type DiscountMode = "AMOUNT" | "PERCENT";

/**
 * The discount on the whole order, as typed on its keypad: a value and whether it is an
 * amount or a percentage, plus whether its dialog is open.
 */
export function useOrderDiscount() {
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<DiscountMode>("AMOUNT");
  const [value, setValue] = useState("0");

  const discounts = useMemo<DiscountInput[]>(
    () =>
      Number(value) > 0
        ? [{ type: mode === "PERCENT" ? "PERCENTAGE" : "FIXED", value: Number(value) }]
        : [],
    [mode, value],
  );

  const press = (key: string) => {
    if (key === "C") {
      setValue("0");
      return;
    }
    if (key === "<") {
      setValue((current) => (current.length <= 1 ? "0" : current.slice(0, -1)));
      return;
    }
    if (key === "+/-") {
      setValue((current) => {
        if (current === "0") return current;
        return current.startsWith("-") ? current.slice(1) : `-${current}`;
      });
      return;
    }
    if (key === ".") {
      setValue((current) => (current.includes(".") ? current : `${current}.`));
      return;
    }
    if (key === "%") {
      setMode((current) => (current === "AMOUNT" ? "PERCENT" : "AMOUNT"));
      return;
    }
    if (!/^\d$/.test(key)) return;
    setValue((current) => (current === "0" ? key : `${current}${key}`));
  };

  /** Sets the discount (e.g. from a resumed draft) and closes the dialog. */
  const restore = (nextValue: string, nextMode: DiscountMode) => {
    setValue(nextValue);
    setMode(nextMode);
    setOpen(false);
  };

  return {
    open,
    setOpen,
    mode,
    value,
    discounts,
    press,
    restore,
    reset: () => restore("0", "AMOUNT"),
  };
}
