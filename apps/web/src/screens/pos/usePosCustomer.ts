import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { api, authHeaders } from "../../lib/api";

/**
 * Who the sale is for: the branch's customers and its walk-in customer, the one picked (or
 * the walk-in, with the name and phone typed for them), and a registered customer's wallet
 * and what they owe already.
 */
export function usePosCustomer({
  branchId,
  customerId,
  walkInCustomerName,
  walkInCustomerPhone,
}: {
  branchId: string;
  /** The customer picked; "" for the walk-in. */
  customerId: string;
  walkInCustomerName: string;
  walkInCustomerPhone: string;
}) {
  const customers = useQuery({
    queryKey: ["customers-pos", branchId],
    queryFn: async () => {
      const res = await api.customers.list({
        query: { branchId: branchId },
        extraHeaders: authHeaders(),
      });
      if (res.status !== 200) throw new Error("Failed to load customers");
      return res.body;
    },
  });

  const walkIn = useQuery({
    queryKey: ["walk-in", branchId],
    queryFn: async () => {
      const res = await api.customers.getWalkIn({
        params: { branchId: branchId },
        extraHeaders: authHeaders(),
      });
      if (res.status !== 200)
        throw new Error("Failed to load walk-in customer");
      return res.body;
    },
  });

  const selectedCustomer = useMemo(() => {
    if (!customerId) return walkIn.data;
    return (
      (customers.data ?? []).find((c) => c.id === customerId) ?? walkIn.data
    );
  }, [customerId, customers.data, walkIn.data]);

  const isWalkInSelected = !customerId || !!selectedCustomer?.isWalkIn;
  const normalizedWalkInCustomerName = walkInCustomerName.trim();
  const normalizedWalkInCustomerPhone = walkInCustomerPhone.trim();
  const displayCustomerName =
    isWalkInSelected && normalizedWalkInCustomerName
      ? normalizedWalkInCustomerName
      : (selectedCustomer?.name ?? "Walk In");
  const displayCustomerPhone =
    isWalkInSelected && normalizedWalkInCustomerPhone
      ? normalizedWalkInCustomerPhone
      : (selectedCustomer?.phone ?? null);

  const customerWallet = useQuery({
    queryKey: ["customer-wallet", customerId],
    // Walk-in customers have no wallet.
    enabled: !!customerId && !selectedCustomer?.isWalkIn,
    queryFn: async () => {
      const res = await api.customers.getWallet({
        params: { id: customerId },
        extraHeaders: authHeaders(),
      });
      if (res.status !== 200) throw new Error("Failed to load customer wallet");
      return res.body;
    },
  });
  const walletBalance = Number(customerWallet.data?.balance ?? 0);
  // What they owe already, against their credit limit.
  const customerAccount = useQuery({
    queryKey: ["customer-account", customerId],
    enabled: !!customerId && !selectedCustomer?.isWalkIn,
    queryFn: async () => {
      const res = await api.customers.account({
        params: { id: customerId },
        extraHeaders: authHeaders(),
      });
      if (res.status !== 200) throw new Error("Failed to load what the customer owes");
      return res.body;
    },
  });
  const account = !isWalkInSelected ? customerAccount.data ?? null : null;

  return {
    customers,
    walkIn,
    selectedCustomer,
    isWalkInSelected,
    normalizedWalkInCustomerName,
    normalizedWalkInCustomerPhone,
    displayCustomerName,
    displayCustomerPhone,
    walletBalance,
    account,
  };
}

export type PosCustomer = ReturnType<typeof usePosCustomer>;
