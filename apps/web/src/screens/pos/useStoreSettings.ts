import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { sanitizeReceiptCss } from "@pos/contracts";
import { API_BASE_URL, api, authHeaders } from "../../lib/api";
import { resolveReceiptWidth } from "../../lib/receiptFormat";

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

  const invoiceLogoSrc = useMemo(() => {
    const logoUrl =
      branchSettings.data?.logoUrl ?? businessSettings.data?.logoUrl;
    if (!logoUrl) return null;
    if (logoUrl.startsWith("http://") || logoUrl.startsWith("https://")) {
      return logoUrl;
    }
    return `${API_BASE_URL.replace(/\/$/, "")}${logoUrl.startsWith("/") ? "" : "/"}${logoUrl}`;
  }, [branchSettings.data?.logoUrl, businessSettings.data?.logoUrl]);

  const storeDisplayName = useMemo(() => {
    return (
      businessSettings.data?.name?.trim() ||
      branchSettings.data?.name?.trim() ||
      "Store"
    );
  }, [businessSettings.data?.name, branchSettings.data?.name]);

  const receiptCharWidth = resolveReceiptWidth(
    branchSettings.data?.invoiceCss,
    48,
  );
  // Branch CSS is admin-written; render only the sanitized, receipt-scoped rules.
  const customReceiptCss = useMemo(
    () => sanitizeReceiptCss(branchSettings.data?.invoiceCss).css,
    [branchSettings.data?.invoiceCss],
  );
  const receiptTemplateCss = `
    #printable-invoice {
      font-family: "Courier New", Courier, monospace;
      --receipt-ch: ${receiptCharWidth};
      width: calc(var(--receipt-ch) * 1ch);
      max-width: 100%;
      margin: 0 auto;
      color: #111827;
    }
    #printable-invoice .receipt-line {
      white-space: pre;
      font-size: 12px;
      line-height: 1.25;
    }
    #printable-invoice .receipt-strong {
      font-weight: 700;
    }
    #printable-invoice .receipt-logo {
      display: block;
      margin: 0 auto 6px;
      max-height: 64px;
      max-width: 100%;
      object-fit: contain;
    }
  `;

  const taxCalculationMode =
    businessSettings.data?.taxCalculationMode ?? "AFTER_DISCOUNT";

  return {
    branchSettings,
    businessSettings,
    taxCalculationMode,
    invoiceHeaderLines,
    invoiceFooterLines,
    receiptFooterLines,
    invoiceLogoSrc,
    storeDisplayName,
    receiptCharWidth,
    customReceiptCss,
    receiptTemplateCss,
  };
}

export type StoreSettings = ReturnType<typeof useStoreSettings>;
