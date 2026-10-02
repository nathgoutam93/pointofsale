/** The receipt as printed: the logo, then one line of text per receipt line. */
export function PrintableInvoice({
  logoSrc,
  lines,
}: {
  logoSrc: string | null | undefined;
  lines: Array<{ text: string; strong?: boolean }>;
}) {
  return (
    <div className="grid min-h-full place-items-center">
      <div className="mx-auto">
        <div
          id="printable-invoice"
          className="w-full rounded border border-slate-200 bg-white p-6 shadow-sm"
        >
          {logoSrc ? (
            <img
              src={logoSrc}
              alt="Branch logo"
              className="receipt-logo"
            />
          ) : null}
          <div className="receipt-text text-center">
            {lines.map((line, idx) => (
              <div
                key={`${line.text}-${idx}`}
                className={`receipt-line ${line.strong ? "receipt-strong" : ""}`}
              >
                {line.text}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
