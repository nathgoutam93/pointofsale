import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { chargesGst, sanitizeReceiptCss } from "@pos/contracts";
import { api, authHeaders, uploadSrc } from "../../lib/api";
import { branchReceiptTemplate } from "../../lib/receipt";
import { usePrintTemplate } from "../../lib/printing";

/** Branch and business settings, and the receipt branding the POS derives from them. */
export function useStoreSettings(branchId: string) {
  const branchSettings = useQuery({
    queryKey: ["branch-settings", branchId],
    queryFn: async () => {
      const res = await api.branches.get({
        params: { id: branchId },
        extraHeaders: authHeaders(),
      });
      if (res.status !== 200) throw new Error("Failed to load branch settings");
      return res.body;
    },
  });
  const businessSettings = useQuery({
    queryKey: ["business-settings"],
    queryFn: async () => {
      const res = await api.business.get({
        extraHeaders: authHeaders(),
      });
      if (res.status !== 200)
        throw new Error("Failed to load business settings");
      return res.body;
    },
  });

  const invoiceHeaderLines = useMemo(() => {
    const raw = branchSettings.data?.invoiceHeader ?? "";
    return raw
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean);
  }, [branchSettings.data?.invoiceHeader]);

  const invoiceFooterLines = useMemo(() => {
    const raw = branchSettings.data?.invoiceFooter ?? "";
    return raw
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean);
  }, [branchSettings.data?.invoiceFooter]);

  const receiptFooterLines = useMemo(() => {
    const raw = branchSettings.data?.receiptFooter ?? "";
    return raw
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean);
  }, [branchSettings.data?.receiptFooter]);

  const invoiceLogoSrc = uploadSrc(branchSettings.data?.logoUrl ?? businessSettings.data?.logoUrl);

  const storeDisplayName = useMemo(() => {
    return (
      businessSettings.data?.name?.trim() ||
      branchSettings.data?.name?.trim() ||
      "Store"
    );
  }, [businessSettings.data?.name, branchSettings.data?.name]);

  // Branch CSS is admin-written; render only the sanitized, receipt-scoped rules.
  const customReceiptCss = useMemo(
    () => sanitizeReceiptCss(branchSettings.data?.invoiceCss).css,
    [branchSettings.data?.invoiceCss],
  );
  /** How this branch lays its receipts out (paper, layout, what they show). */
  const receiptTemplate = useMemo(() => branchReceiptTemplate(branchSettings.data), [branchSettings.data]);
  /** The same, on this computer's paper when its printer takes other paper: what receipts print with. */
  const printTemplate = usePrintTemplate(receiptTemplate);

  const taxCalculationMode =
    businessSettings.data?.taxCalculationMode ?? "AFTER_DISCOUNT";
  // A composition taxpayer can't charge GST, so the cart is priced without tax. The server
  // decides at checkout; this only keeps the totals shown the same as what it will charge.
  const chargeTax = chargesGst(businessSettings.data?.taxpayerType ?? "REGULAR");
  // How the bill's total is rounded, the same as the server will.
  const roundOffMode = businessSettings.data?.roundOffMode ?? "NONE";

  return {
    branchSettings,
    businessSettings,
    taxCalculationMode,
    chargeTax,
    roundOffMode,
    invoiceHeaderLines,
    invoiceFooterLines,
    receiptFooterLines,
    invoiceLogoSrc,
    storeDisplayName,
    customReceiptCss,
    receiptTemplate,
    printTemplate,
  };
}

export type StoreSettings = ReturnType<typeof useStoreSettings>;
