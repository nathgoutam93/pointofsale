// Small formatting helpers for printed receipts. The layout itself is renderReceipt in
// @pos/contracts (see lib/receipt.ts).

// In this device's time zone.
export { formatReceiptDate, formatReceiptTime } from "@pos/contracts";

/** Escapes text for use inside HTML built as a string (e.g. the downloadable invoice). */
export const escapeHtml = (text: string) =>
  text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
