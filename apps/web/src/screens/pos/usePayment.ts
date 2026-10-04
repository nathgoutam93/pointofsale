import { useEffect, useMemo, useState } from "react";
import { inr, money } from "../route-helpers";
import type { PaymentMethod, PaymentMode } from "./types";

export type PaymentLine = { mode: PaymentMode; amount: number };

/**
 * The payment dialog's state: the method and amount being typed, the payment lines added
 * so far, and whether they can settle the sale. Walk-ins pay exactly the total in cash, card
 * or UPI; a customer can also pay from their wallet, part-pay (the rest goes on credit) or
 * overpay (the excess goes to their wallet).
 */
export function usePayment({
  total,
  isWalkInSelected,
  walletBalance,
}: {
  total: number;
  isWalkInSelected: boolean;
  walletBalance: number;
}) {
  const [open, setOpen] = useState(false);
  const [method, setMethod] = useState<PaymentMethod>("CASH");
  const [amount, setAmount] = useState("0");
  const [lines, setLines] = useState<PaymentLine[]>([]);
  const [error, setError] = useState("");

  const availableMethods = useMemo<Array<{ key: PaymentMethod; label: string }>>(() => {
    if (isWalkInSelected) {
      return [
        { key: "CASH", label: "Cash" },
        { key: "CARD", label: "Card" },
      { key: "UPI", label: "UPI" },
        { key: "UPI", label: "UPI" },
      ];
    }
    return [
      { key: "CASH", label: "Cash" },
      { key: "CARD", label: "Card" },
      { key: "UPI", label: "UPI" },
      { key: "WALLET", label: "Customer Wallet" },
      { key: "CREDIT", label: "Credit" },
    ];
  }, [isWalkInSelected]);

  useEffect(() => {
    if (isWalkInSelected) {
      setLines((prev) => prev.filter((line) => line.mode !== "WALLET"));
      if (method === "WALLET" || method === "CREDIT") {
        setMethod("CASH");
      }
    }
  }, [isWalkInSelected, method]);

  /** Opens the dialog with the whole total ready to add as cash. */
  const start = () => {
    setMethod("CASH");
    setAmount(money(total));
    setLines([]);
    setError("");
    setOpen(true);
  };

  const close = () => {
    setOpen(false);
    setError("");
  };

  const reset = () => {
    setAmount("0");
    setLines([]);
    setError("");
    setOpen(false);
  };

  const press = (key: string) => {
    const current = amount;
    if (key === "C") {
      setAmount("0");
      return;
    }
    if (key === "<") {
      setAmount(current.length <= 1 ? "0" : current.slice(0, -1));
      return;
    }
    if (key === "+/-") {
      if (current === "0") return;
      setAmount(current.startsWith("-") ? current.slice(1) : `-${current}`);
      return;
    }
    if (key === ".") {
      if (current.includes(".")) return;
      setAmount(`${current}.`);
      return;
    }
    if (key.startsWith("+")) {
      const increment = Number(key.slice(1));
      if (!Number.isFinite(increment)) return;
      setAmount(String((Number(current) || 0) + increment));
      return;
    }

    setAmount(current === "0" ? key : `${current}${key}`);
  };

  /** Adds the typed amount as a line for the selected method, replacing any line it had. */
  const applyLine = () => {
    if (method === "CREDIT") return;
    const mode = method;
    const value = Number(amount);
    if (!Number.isFinite(value) || value <= 0) return;
    if (mode === "WALLET" && value > walletBalance) {
      setError(`Wallet balance is insufficient. Available: ${inr(walletBalance)}`);
      return;
    }
    setError("");
    setLines((prev) => {
      const withoutCurrent = prev.filter((line) => line.mode !== mode);
      if (isWalkInSelected) {
        const paidWithoutCurrent = withoutCurrent.reduce((acc, line) => acc + line.amount, 0);
        const maxAllowedForCurrent = total - paidWithoutCurrent;
        if (value > maxAllowedForCurrent + 0.0001) {
          setError(`Amount exceeds remaining. You can add up to ${inr(maxAllowedForCurrent)}`);
          return prev;
        }
      }

      const next = [...withoutCurrent, { mode, amount: value }];
      const nextPaid = next.reduce((acc, line) => acc + line.amount, 0);
      setAmount(money(Math.max(0, total - nextPaid)));
      return next;
    });
  };

  const removeLine = (mode: PaymentMode) => {
    setLines((prev) => prev.filter((line) => line.mode !== mode));
  };

  const totalPaid = useMemo(() => lines.reduce((acc, line) => acc + line.amount, 0), [lines]);
  const remainingAmount = Math.max(0, total - totalPaid);
  const walletLineAmount = useMemo(
    () => lines.filter((line) => line.mode === "WALLET").reduce((acc, line) => acc + line.amount, 0),
    [lines],
  );
  const walletOverused = walletLineAmount > walletBalance;
  const matchesTotal = Math.abs(totalPaid - total) < 0.005;
  const excessAmount = Math.max(0, totalPaid - total);
  const canValidate = isWalkInSelected
    ? lines.length > 0 && matchesTotal
    : lines.length > 0 || method === "CREDIT";

  return {
    open,
    method,
    setMethod,
    amount,
    lines,
    error,
    availableMethods,
    start,
    close,
    reset,
    press,
    applyLine,
    removeLine,
    totalPaid,
    remainingAmount,
    walletOverused,
    matchesTotal,
    excessAmount,
    canValidate,
  };
}

export type Payment = ReturnType<typeof usePayment>;
