import { useQuery } from "@tanstack/react-query";
import { api, authHeaders } from "../../lib/api";

/** The selected bill in full (lines, discounts, payments) and the receipts taken against it. */
export function useInvoiceDetails(selectedInvoiceId: string) {
  const selectedInvoiceDetails = useQuery({
    queryKey: ["sales-by-id", selectedInvoiceId],
    enabled: !!selectedInvoiceId,
    queryFn: async () => {
      const res = await api.sales.getById({
        params: { id: selectedInvoiceId },
        extraHeaders: authHeaders(),
      });
      if (res.status !== 200) throw new Error("Failed to load invoice details");
      return res.body;
    },
  });

  const selectedReceipts = useQuery({
    queryKey: ["receipt-list-by-invoice-sales", selectedInvoiceId],
    enabled: !!selectedInvoiceId,
    queryFn: async () => {
      const res = await api.receipts.getByInvoice({
        params: { invoiceId: selectedInvoiceId },
        extraHeaders: authHeaders(),
      });
      if (res.status !== 200) return [];
      return res.body;
    },
  });

  return { selectedInvoiceDetails, selectedReceipts };
}

export type InvoiceDetailsQuery = ReturnType<typeof useInvoiceDetails>["selectedInvoiceDetails"];
/** A bill in full, as the server sends it. */
export type InvoiceDetails = NonNullable<InvoiceDetailsQuery["data"]>;
