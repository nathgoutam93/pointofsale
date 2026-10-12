import { a4InvoiceHtml } from "@pos/contracts";
import { barcodePath, receiptLineClass, type RenderedReceipt } from "../lib/receipt";

/**
 * A receipt as printed: the logo, then one line of text per receipt line (large lines at
 * double size, the bill number's barcode as an SVG). Styled by receiptBaseCss for its id.
 */
export function ReceiptView({
  receipt,
  logoSrc,
  id = "printable-invoice",
  className,
}: {
  receipt: RenderedReceipt | null;
  logoSrc: string | null | undefined;
  id?: string;
  className?: string;
}) {
  // On A4 paper: a full-page invoice (every value escaped by a4InvoiceHtml).
  if (receipt?.page) {
    return <div id={id} className={className} dangerouslySetInnerHTML={{ __html: a4InvoiceHtml(receipt.page.doc, receipt.page.sections, logoSrc) }} />;
  }
  return (
    <div id={id} className={className}>
      {receipt?.showLogo && logoSrc ? <img src={logoSrc} alt="Store logo" className="receipt-logo" /> : null}
      <div className="receipt-text">
        {(receipt?.lines ?? []).map((line, index) => {
          const text = (
            <div key={`text-${index}`} className={receiptLineClass(line)}>
              {line.text}
            </div>
          );
          if (!line.barcode) return text;
          const { d, width } = barcodePath(line.barcode);
          return [
            <svg
              key={`barcode-${index}`}
              className="receipt-barcode"
              viewBox={`0 0 ${width} 1`}
              preserveAspectRatio="none"
              role="img"
              aria-label={line.barcode}
            >
              <path d={d} fill="#000" />
            </svg>,
            text,
          ];
        })}
      </div>
    </div>
  );
}
