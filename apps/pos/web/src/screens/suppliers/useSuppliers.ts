import { useQuery } from "@tanstack/react-query";
import { api, authHeaders } from "../../lib/api";

/** The business's suppliers with what is owed to each (active ones, or all). */
export function useSuppliers(includeInactive = false) {
  return useQuery({
    queryKey: ["suppliers", includeInactive],
    queryFn: async () => {
      const res = await api.suppliers.list({ query: { includeInactive: includeInactive ? "true" : "false" }, extraHeaders: authHeaders() });
      if (res.status !== 200) throw new Error("Failed to load suppliers");
      return res.body;
    },
  });
}

export type Supplier = NonNullable<ReturnType<typeof useSuppliers>["data"]>[number];

/** How a supplier was paid, as shown. */
export const PAYMENT_MODE_LABELS = { CASH: "Cash", UPI: "UPI", BANK_TRANSFER: "Bank transfer", CHEQUE: "Cheque" } as const;
