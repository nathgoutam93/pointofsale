import { useQuery } from "@tanstack/react-query";
import { useCallback, useMemo, useState } from "react";
import { desktop, type PrintingSettings } from "./desktop";
import type { ReceiptStyle, ReceiptTemplate } from "./receipt";

const printing = desktop?.printing ?? null;

/** True in the desktop app, where a receipt printer and cash drawer can be set up. */
export const canUseReceiptPrinter = !!printing;

export type { ReceiptStyle };

/** This computer's receipt printer settings; null in a browser, or if the app can't say. */
export async function receiptPrinterSettings(): Promise<PrintingSettings | null> {
  if (!printing) return null;
  try {
    return await printing.settings();
  } catch {
    return null;
  }
}

/** This computer's printing settings, shared by every screen; Settings → Printer updates them. */
export function useReceiptPrinterSettings() {
  return useQuery({
    queryKey: ["desktop-printing"],
    queryFn: () => printing!.settings(),
    enabled: !!printing,
    staleTime: Infinity,
  });
}

/**
 * The branch's receipt layout on the paper this computer's printer takes, when it is set to
 * other paper. What is shown is what prints, so every screen lays receipts out with this.
 */
export function usePrintTemplate(template: ReceiptTemplate) {
  const paper = useReceiptPrinterSettings().data?.paper ?? null;
  return useMemo(() => (paper && paper !== template.paper ? { ...template, paper } : template), [template, paper]);
}

/**
 * Prints a receipt: the one shown on the page (#printable-invoice) unless `markup` is given.
 * With a receipt printer set up in the desktop app it goes straight there, with no dialog;
 * otherwise the system print dialog opens. Throws when the receipt printer fails.
 */
export async function printReceipt(style: ReceiptStyle, markup?: string) {
  const settings = await receiptPrinterSettings();
  const html = markup ?? document.getElementById("printable-invoice")?.outerHTML;
  if (!printing || !settings?.printerName || !html) {
    window.print();
    return;
  }
  await printing.printReceipt({ markup: html, css: style.css, columns: style.columns, paperMm: style.paperMm });
}

/** Opens the cash drawer if this computer has one switched on; answers whether it did. */
export async function openCashDrawer() {
  return printing ? printing.openDrawer() : false;
}

const errorMessage = (error: unknown) => (error instanceof Error ? error.message : String(error));

/**
 * Printing and the cash drawer for a page, with the last problem to show. A failed print
 * the cashier asked for falls back to the system dialog, so the receipt still comes out.
 */
export function useReceiptPrinting() {
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const print = useCallback(async (style: ReceiptStyle, options: { dialogOnFailure?: boolean } = {}) => {
    const dialogOnFailure = options.dialogOnFailure ?? true;
    setError("");
    setBusy(true);
    try {
      await printReceipt(style);
    } catch (failure) {
      setError(
        dialogOnFailure
          ? `${errorMessage(failure)} Opening the print dialog instead.`
          : `${errorMessage(failure)} Press Print to try again.`,
      );
      if (dialogOnFailure) window.print();
    } finally {
      setBusy(false);
    }
  }, []);

  const openDrawer = useCallback(async () => {
    try {
      await openCashDrawer();
    } catch (failure) {
      setError(errorMessage(failure));
    }
  }, []);

  const clearError = useCallback(() => setError(""), []);

  return { print, openDrawer, busy, error, clearError };
}
