import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import type { DesktopPrinting, PrintingSettings } from "../../lib/desktop";
import { RECEIPT_PAPERS } from "@pos/contracts";
import { printReceipt } from "../../lib/printing";
import { receiptMarkup, receiptStyleFor, renderReceipt, sampleReceiptDocument } from "../../lib/receipt";
import { getSession } from "../../lib/session";
import { useStoreSettings } from "../pos/useStoreSettings";

/**
 * Desktop app: the receipt printer and cash drawer on this computer. Printers belong to the
 * computer, not the branch, so each till is set up on its own.
 */
export function PrinterSection({ printing, branchId }: { printing: DesktopPrinting; branchId: string }) {
  const queryClient = useQueryClient();
  const token = getSession()?.token ?? "";
  const store = useStoreSettings(branchId);
  const [message, setMessage] = useState("");

  const settings = useQuery({ queryKey: ["desktop-printing"], queryFn: () => printing.settings() });
  const printers = useQuery({ queryKey: ["desktop-printers"], queryFn: () => printing.printers() });

  const save = useMutation({
    mutationFn: (next: PrintingSettings) => printing.save(token, next),
    onSuccess: (saved) => {
      setMessage("Saved for this computer.");
      queryClient.setQueryData(["desktop-printing"], saved);
    },
  });
  const testPrint = useMutation({
    mutationFn: () => {
      const receipt = renderReceipt(
        sampleReceiptDocument(
          {
            storeName: store.storeDisplayName,
            headerLines: store.invoiceHeaderLines,
            footerLines: ["If the dashes above fit on one line each, the paper is set right."],
          },
          { title: "TEST PRINT" },
        ),
        store.receiptTemplate,
      );
      return printReceipt(
        receiptStyleFor(receipt, store.receiptTemplate, store.customReceiptCss),
        receiptMarkup(receipt, store.invoiceLogoSrc),
      );
    },
    onSuccess: () => setMessage("Test receipt sent to the printer."),
  });
  const testDrawer = useMutation({
    mutationFn: () => printing.testDrawer(token),
    onSuccess: () => setMessage("Drawer opened."),
  });

  const current = save.isPending ? save.variables : settings.data;
  const update = (patch: Partial<PrintingSettings>) => {
    if (!current) return;
    setMessage("");
    save.mutate({ ...current, ...patch });
  };

  const error = (settings.error ?? printers.error ?? save.error ?? testPrint.error ?? testDrawer.error) as Error | null;
  const hasPrinter = !!current?.printerName;
  // A saved printer that has since been removed still shows, so it can be changed.
  const printerOptions = [...(printers.data ?? [])];
  if (current?.printerName && !printerOptions.some((printer) => printer.name === current.printerName)) {
    printerOptions.unshift({ name: current.printerName, displayName: `${current.printerName} (not found)` });
  }
  const paper = RECEIPT_PAPERS[store.receiptTemplate.paper];

  return (
    <div className="grid gap-4">
      <div className="card p-5">
        <div className="max-w-2xl">
          <h2 className="text-lg font-semibold tracking-tight text-slate-900">Receipt printer</h2>
          <p className="mt-1 text-sm text-slate-600">
            Receipts go straight to this printer in one click, with no print dialog. This is set on each computer
            separately. Receipts are laid out for {paper.label} paper ({paper.columns} characters a line), as chosen
            under Settings → Receipts.
          </p>
        </div>

        <div className="mt-4 flex flex-wrap items-end gap-3">
          <div className="min-w-64">
            <label className="field-label" htmlFor="receipt-printer">
              Printer
            </label>
            <select
              id="receipt-printer"
              className="field"
              value={current?.printerName ?? ""}
              disabled={!current || save.isPending}
              onChange={(e) => {
                const printerName = e.target.value || null;
                update(printerName ? { printerName } : { printerName, autoPrint: false, openDrawer: false });
              }}
            >
              <option value="">None: choose a printer each time (print dialog)</option>
              {printerOptions.map((printer) => (
                <option key={printer.name} value={printer.name}>
                  {printer.displayName}
                </option>
              ))}
            </select>
          </div>
          <button className="btn-secondary" onClick={() => void printers.refetch()} disabled={printers.isFetching}>
            {printers.isFetching ? "Looking…" : "Refresh list"}
          </button>
          <button
            className="btn-secondary"
            onClick={() => {
              setMessage("");
              testPrint.mutate();
            }}
            disabled={!hasPrinter || testPrint.isPending || save.isPending}
          >
            {testPrint.isPending ? "Printing…" : "Print a test receipt"}
          </button>
        </div>
        {printers.data && printers.data.length === 0 ? (
          <p className="mt-2 text-xs text-slate-500">
            No printers are installed. Install the printer's driver (or add it in the system's printer settings), then
            press Refresh list.
          </p>
        ) : null}

        <label className="mt-4 flex items-start gap-2 text-sm text-slate-700">
          <input
            type="checkbox"
            className="mt-0.5"
            checked={!!current?.autoPrint}
            disabled={!hasPrinter || save.isPending}
            onChange={(e) => update({ autoPrint: e.target.checked })}
          />
          <span>
            Print the receipt as soon as a sale is paid
            <span className="block text-xs text-slate-500">Otherwise press Print Full Receipt after the sale.</span>
          </span>
        </label>
      </div>

      <div className="card p-5">
        <div className="max-w-2xl">
          <h3 className="text-sm font-semibold text-slate-900">Cash drawer</h3>
          <p className="mt-1 text-sm text-slate-600">
            For a drawer plugged into the receipt printer's drawer port (the phone-style socket). It opens when cash is
            taken at the POS or when settling a sale, and when a return is refunded in cash.
          </p>
        </div>

        <label className="mt-4 flex items-start gap-2 text-sm text-slate-700">
          <input
            type="checkbox"
            className="mt-0.5"
            checked={!!current?.openDrawer}
            disabled={!hasPrinter || save.isPending}
            onChange={(e) => update({ openDrawer: e.target.checked })}
          />
          <span>Open the cash drawer for cash payments and cash refunds</span>
        </label>

        <div className="mt-4 flex flex-wrap items-end gap-3">
          <div>
            <label className="field-label" htmlFor="drawer-pin">
              Drawer port pin
            </label>
            <select
              id="drawer-pin"
              className="field w-auto"
              value={current?.drawerPin ?? 2}
              disabled={!hasPrinter || save.isPending}
              onChange={(e) => update({ drawerPin: Number(e.target.value) === 5 ? 5 : 2 })}
            >
              <option value={2}>Pin 2 (most drawers)</option>
              <option value={5}>Pin 5 (second drawer)</option>
            </select>
          </div>
          <button
            className="btn-secondary"
            onClick={() => {
              setMessage("");
              testDrawer.mutate();
            }}
            disabled={!hasPrinter || testDrawer.isPending || save.isPending}
          >
            {testDrawer.isPending ? "Opening…" : "Open drawer now"}
          </button>
        </div>
        <p className="mt-2 text-xs text-slate-500">
          The drawer is opened with the standard ESC/POS command, which Epson, TVS, Xprinter, Rugtek and most other
          thermal printers understand. If yours doesn't open, try the other pin.
        </p>
      </div>

      {message && !error ? (
        <p className="text-sm text-emerald-700" role="status">
          {message}
        </p>
      ) : null}
      {error ? (
        <p className="rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700" role="alert">
          {error.message}
        </p>
      ) : null}
    </div>
  );
}
