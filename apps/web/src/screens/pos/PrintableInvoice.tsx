import { ReceiptView } from "../../components/ReceiptView";
import type { RenderedReceipt } from "../../lib/receipt";

/** The receipt as printed, on the page after a sale. */
export function PrintableInvoice({
  logoSrc,
  receipt,
}: {
  logoSrc: string | null | undefined;
  receipt: RenderedReceipt | null;
}) {
  return (
    <div className="min-h-0 flex-1 overflow-auto p-6 print:overflow-visible print:p-0">
      <div className="mx-auto w-fit">
        <ReceiptView
          receipt={receipt}
          logoSrc={logoSrc}
          className="w-full rounded border border-slate-200 bg-white p-6 shadow-sm"
        />
      </div>
    </div>
  );
}
