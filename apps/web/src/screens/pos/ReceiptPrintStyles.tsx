/** Prints only the receipt, styled with the store's receipt template and custom CSS. */
export function ReceiptPrintStyles({ templateCss, customCss }: { templateCss: string; customCss: string }) {
  return (
    <style>{`
      @media print {
        body * {
          visibility: hidden !important;
        }

        #printable-invoice,
        #printable-invoice * {
          visibility: visible !important;
        }

        #printable-invoice {
          position: absolute;
          inset: 0;
          margin: 0;
          width: 100%;
          max-width: none;
          border: none;
          border-radius: 0;
          box-shadow: none;
          padding: 16px;
          -webkit-print-color-adjust: exact;
          print-color-adjust: exact;
        }
      }
      ${templateCss}
      ${customCss}
    `}</style>
  );
}
