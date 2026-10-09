import { useEffect, useMemo, useState } from "react";
import { round2 } from "@pos/contracts";
import { inr, money } from "../route-helpers";
import type { PaymentMethod, PaymentMode } from "./types";

/** `tendered`: cash handed over when more than `amount`; the rest is given back as change. */
export type PaymentLine = { mode: PaymentMode; amount: number; tendered?: number };

/** Where cash handed over beyond what is due goes: back as change, or (registered customers) into their wallet. */
export type CashExcessTo = "CHANGE" | "WALLET";

/**
 * The payment dialog's state: the method and amount being typed, the payment lines added
 * so far, and whether they can settle the sale. Walk-ins pay exactly the total in cash, card
 * or UPI; a customer can also pay from their wallet or part-pay (the rest goes on credit).
 * Cash handed over beyond what is due is given back as change; a registered customer may
 * have it go to their wallet instead.
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
  const [cashExcessTo, setCashExcessTo] = useState<CashExcessTo>("CHANGE");

  const availableMethods = useMemo<Array<{ key: PaymentMethod; label: string }>>(() => {
    if (isWalkInSelected) {
      return [
        { key: "CASH", label: "Cash" },
        { key: "CARD", label: "Card" },
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
      setCashExcessTo("CHANGE");
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
    setCashExcessTo("CHANGE");
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
    setCashExcessTo("CHANGE");
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

  /**
   * Adds the typed amount as a line for the selected method, replacing any line it had. Cash
   * beyond what is still due is handed back as change (the line records what was tendered),
   * unless a registered customer's extra goes to their wallet.
   */
  const applyLine = () => {
    if (method === "CREDIT") return;
    const mode = method;
    const value = round2(Number(amount));
    if (!Number.isFinite(value) || value <= 0) return;
    if (mode === "WALLET" && value > walletBalance) {
      setError(`Wallet balance is insufficient. Available: ${inr(walletBalance)}`);
      return;
    }
    setError("");
    setLines((prev) => {
      const withoutCurrent = prev.filter((line) => line.mode !== mode);
      const paidWithoutCurrent = withoutCurrent.reduce((acc, line) => acc + line.amount, 0);
      const due = round2(Math.max(0, total - paidWithoutCurrent));
      let line: PaymentLine = { mode, amount: value };
      if (value > due + 0.0001) {
        if (mode === "CASH" && (isWalkInSelected || cashExcessTo === "CHANGE")) {
          if (due <= 0) {
            setError("Nothing is left to pay.");
            return prev;
          }
          line = { mode, amount: due, tendered: value };
        } else if (isWalkInSelected) {
          setError(`Amount exceeds remaining. You can add up to ${inr(due)}`);
          return prev;
        }
      }

      const next = [...withoutCurrent, line];
      const nextPaid = next.reduce((acc, entry) => acc + entry.amount, 0);
      setAmount(money(Math.max(0, total - nextPaid)));
      return next;
    });
  };

  const removeLine = (mode: PaymentMode) => {
    setLines((prev) => prev.filter((line) => line.mode !== mode));
  };

  const totalPaid = useMemo(() => round2(lines.reduce((acc, line) => acc + line.amount, 0)), [lines]);
  const remainingAmount = Math.max(0, round2(total - totalPaid));
  const walletLineAmount = useMemo(
    () => lines.filter((line) => line.mode === "WALLET").reduce((acc, line) => acc + line.amount, 0),
    [lines],
  );
  const walletOverused = walletLineAmount > walletBalance;
  const matchesTotal = Math.abs(totalPaid - total) < 0.005;
  const excessAmount = Math.max(0, round2(totalPaid - total));
  /** Cash to hand back: what was tendered beyond the cash payment. */
  const changeAmount = useMemo(
    () => round2(lines.reduce((acc, line) => acc + (line.tendered !== undefined ? line.tendered - line.amount : 0), 0)),
    [lines],
  );
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
    changeAmount,
    cashExcessTo,
    setCashExcessTo,
    canValidate,
  };
}

export type Payment = ReturnType<typeof usePayment>;
