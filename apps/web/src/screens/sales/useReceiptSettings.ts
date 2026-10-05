import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { sanitizeReceiptCss } from "@pos/contracts";
import { api, authHeaders, uploadSrc } from "../../lib/api";
import { usePrintTemplate } from "../../lib/printing";
import { branchReceiptTemplate } from "../../lib/receipt";

/** Branch and business settings, and the receipt branding the Sales screen derives from them. */
export function useReceiptSettings(branchId: string) {
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

  const receiptHeaderLines = useMemo(() => {
    const raw = branchSettings.data?.receiptHeader ?? "";
    return raw
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean);
  }, [branchSettings.data?.receiptHeader]);

  const receiptFooterLines = useMemo(() => {
    const raw = branchSettings.data?.receiptFooter ?? "";
    return raw
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean);
  }, [branchSettings.data?.receiptFooter]);

  const invoiceFooterLines = useMemo(() => {
    const raw = branchSettings.data?.invoiceFooter ?? "";
    return raw
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean);
  }, [branchSettings.data?.invoiceFooter]);

  const receiptLogoSrc = uploadSrc(branchSettings.data?.logoUrl ?? businessSettings.data?.logoUrl);

  const storeDisplayName = useMemo(() => {
    return (
      businessSettings.data?.name?.trim() ||
      branchSettings.data?.name?.trim() ||
      "Store"
    );
  }, [businessSettings.data?.name, branchSettings.data?.name]);

  // Branch CSS is admin-written; render only the sanitized, receipt-scoped rules.
  const customReceiptCss = useMemo(
    () => sanitizeReceiptCss(branchSettings.data?.receiptCss).css,
    [branchSettings.data?.receiptCss],
  );
  const branchTemplate = useMemo(() => branchReceiptTemplate(branchSettings.data), [branchSettings.data]);
  // On this computer's paper, when its printer takes other paper than the branch's.
  const receiptTemplate = usePrintTemplate(branchTemplate);

  return {
    branchSettings,
    businessSettings,
    receiptHeaderLines,
    receiptFooterLines,
    invoiceFooterLines,
    receiptLogoSrc,
    storeDisplayName,
    customReceiptCss,
    receiptTemplate,
  };
}

export type ReceiptSettings = ReturnType<typeof useReceiptSettings>;
