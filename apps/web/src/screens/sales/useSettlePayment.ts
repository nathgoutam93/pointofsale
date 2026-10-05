import { useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { api, authHeaders } from "../../lib/api";
import { inr, money } from "../route-helpers";
import { keypadKeyFromEvent, shouldIgnoreDialogKey } from "./keyboard";
import type { CurrentInvoice, PaymentMode } from "./types";

/**
 * The settle dialog's state: the method and amount being typed, the payment lines added so
 * far, and whether they can settle what is still owed on the bill. A registered customer can
 * also pay from their wallet.
 */
export function useSettlePayment({
  branchId,
  selectedCustomer,
  isRegisteredCustomer,
  currentInvoice,
  pendingAmount,
  setMessage,
}: {
  branchId: string;
  selectedCustomer: { id: string } | null;
  isRegisteredCustomer: boolean;
  currentInvoice: CurrentInvoice | null;
  /** What is still owed on the bill. */
  pendingAmount: number;
  setMessage: (message: string) => void;
}) {
  const [paymentModalOpen, setPaymentModalOpen] = useState(false);
  const [paymentMethod, setPaymentMethod] = useState<PaymentMode>("CASH");
  const [paymentAmount, setPaymentAmount] = useState("0");
  const [paymentLines, setPaymentLines] = useState<
    Array<{ mode: PaymentMode; amount: number }>
  >([]);
  const [paymentModalError, setPaymentModalError] = useState("");

  const customerWallet = useQuery({
    queryKey: ["customer-wallet-sales", selectedCustomer?.id],
    enabled: paymentModalOpen && isRegisteredCustomer && !!selectedCustomer?.id,
    queryFn: async () => {
      if (!selectedCustomer?.id) {
        throw new Error("No customer selected");
      }
      const res = await api.customers.getWallet({
        params: { id: selectedCustomer.id },
        query: { branchId },
        extraHeaders: authHeaders(),
      });
      if (res.status !== 200) throw new Error("Failed to load customer wallet");
      return res.body;
    },
  });

  const availablePaymentMethods = useMemo<
    Array<{ key: PaymentMode; label: string }>
  >(() => {
    if (!isRegisteredCustomer) {
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
    ];
  }, [isRegisteredCustomer]);

  useEffect(() => {
    if (isRegisteredCustomer) return;
    setPaymentLines((prev) => prev.filter((line) => line.mode !== "WALLET"));
    if (paymentMethod === "WALLET") {
      setPaymentMethod("CASH");
    }
  }, [isRegisteredCustomer, paymentMethod]);

  const totalPaid = useMemo(
    () => paymentLines.reduce((acc, line) => acc + line.amount, 0),
    [paymentLines],
  );
  const remainingAmount = useMemo(
    () => Math.max(0, pendingAmount - totalPaid),
    [pendingAmount, totalPaid],
  );
  const paymentCanSubmit =
    totalPaid > 0 &&
    totalPaid <= pendingAmount + 0.005 &&
    Math.abs(pendingAmount) >= 0.005;
  const walletBalance = Number(customerWallet.data?.balance ?? 0);
  const walletLineAmount = useMemo(
    () =>
      paymentLines
        .filter((line) => line.mode === "WALLET")
        .reduce((acc, line) => acc + line.amount, 0),
    [paymentLines],
  );
  const walletOverused = walletLineAmount > walletBalance;

  const paymentKeypadPress = (key: string) => {
    const current = paymentAmount;
    if (key === "C") {
      setPaymentAmount("0");
      return;
    }
    if (key === "<") {
      const next = current.length <= 1 ? "0" : current.slice(0, -1);
      setPaymentAmount(next);
      return;
    }
    if (key === "+/-") {
      if (current === "0") return;
      setPaymentAmount(
        current.startsWith("-") ? current.slice(1) : `-${current}`,
      );
      return;
    }
    if (key === ".") {
      if (current.includes(".")) return;
      setPaymentAmount(`${current}.`);
      return;
    }
    if (key.startsWith("+")) {
      const increment = Number(key.slice(1));
      if (!Number.isFinite(increment)) return;
      const next = (Number(current) || 0) + increment;
      setPaymentAmount(String(next));
      return;
    }

    const next = current === "0" ? key : `${current}${key}`;
    setPaymentAmount(next);
  };

  const applyPaymentLine = () => {
    const amount = Number(paymentAmount);
    if (!Number.isFinite(amount) || amount <= 0) return;
    if (paymentMethod === "WALLET") {
      if (!isRegisteredCustomer) {
        setPaymentModalError(
          "Wallet payment is allowed only for registered customers.",
        );
        return;
      }
      if (customerWallet.isLoading) {
        setPaymentModalError("Loading wallet balance. Try again.");
        return;
      }
      if (customerWallet.isError) {
        setPaymentModalError("Failed to fetch wallet balance. Try again.");
        return;
      }
      if (amount > walletBalance + 0.0001) {
        setPaymentModalError(
          `Wallet balance is insufficient. Available: ${inr(walletBalance)}`,
        );
        return;
      }
    }

    setPaymentModalError("");
    setPaymentLines((prev) => {
      const withoutCurrent = prev.filter((line) => line.mode !== paymentMethod);
      const paidWithoutCurrent = withoutCurrent.reduce(
        (acc, line) => acc + line.amount,
        0,
      );
      const maxAllowedForCurrent = pendingAmount - paidWithoutCurrent;
      if (amount > maxAllowedForCurrent + 0.0001) {
        setPaymentModalError(
          `Amount exceeds remaining. You can add up to ${inr(maxAllowedForCurrent)}`,
        );
        return prev;
      }
      if (paymentMethod === "WALLET" && amount > walletBalance + 0.0001) {
        setPaymentModalError(
          `Wallet balance is insufficient. Available: ${inr(walletBalance)}`,
        );
        return prev;
      }

      const next = [...withoutCurrent, { mode: paymentMethod, amount }];
      const nextPaid = next.reduce((acc, line) => acc + line.amount, 0);
      const nextRemaining = Math.max(0, pendingAmount - nextPaid);
      setPaymentAmount(money(nextRemaining));
      return next;
    });
  };

  const removePaymentLine = (mode: PaymentMode) => {
    setPaymentLines((prev) => prev.filter((line) => line.mode !== mode));
  };

  const openSettleModal = () => {
    if (!currentInvoice || pendingAmount <= 0) {
      setMessage("This invoice is already fully settled.");
      return;
    }
    setPaymentMethod("CASH");
    setPaymentAmount(money(pendingAmount));
    setPaymentLines([]);
    setPaymentModalError("");
    setPaymentModalOpen(true);
    setMessage("");
  };

  return {
    paymentModalOpen,
    setPaymentModalOpen,
    paymentMethod,
    setPaymentMethod,
    paymentAmount,
    setPaymentAmount,
    paymentLines,
    setPaymentLines,
    paymentModalError,
    setPaymentModalError,
    customerWallet,
    availablePaymentMethods,
    totalPaid,
    remainingAmount,
    paymentCanSubmit,
    walletBalance,
    walletOverused,
    paymentKeypadPress,
    applyPaymentLine,
    removePaymentLine,
    openSettleModal,
  };
}

export type SettlePayment = ReturnType<typeof useSettlePayment>;

/**
 * The settle dialog's keyboard: Enter adds the typed amount, Ctrl/Cmd+Enter settles, Escape
 * goes back and typed digits go to the keypad.
 */
export function useSettlePaymentKeys({
  payment,
  settleInvoice,
  currentInvoice,
}: {
  payment: SettlePayment;
  settleInvoice: {
    isPending: boolean;
    mutate: (payload: { invoiceId: string; payments: Array<{ mode: PaymentMode; amount: number }> }) => void;
  };
  currentInvoice: CurrentInvoice | null;
}) {
  const {
    paymentModalOpen,
    walletOverused,
    paymentLines,
    paymentCanSubmit,
    applyPaymentLine,
    setPaymentModalOpen,
    setPaymentModalError,
    paymentKeypadPress,
  } = payment;

  useEffect(() => {
    if (!paymentModalOpen) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (shouldIgnoreDialogKey(event)) return;

      if (event.key === "Enter") {
        event.preventDefault();
        if (event.ctrlKey || event.metaKey) {
          if (
            !settleInvoice.isPending &&
            !walletOverused &&
            currentInvoice &&
            paymentLines.length > 0 &&
            paymentCanSubmit
          ) {
            settleInvoice.mutate({
              invoiceId: currentInvoice.id,
              payments: paymentLines,
            });
          }
          return;
        }
        applyPaymentLine();
        return;
      }
      if (event.key === "Escape") {
        event.preventDefault();
        setPaymentModalOpen(false);
        setPaymentModalError("");
        return;
      }

      const keypadKey = keypadKeyFromEvent(event);
      if (!keypadKey) return;
      event.preventDefault();
      paymentKeypadPress(keypadKey);
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
    // No dependency list: the handler reads the latest payment state, so it is attached
    // again after every render.
  });
}
