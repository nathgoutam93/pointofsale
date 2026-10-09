// How the Stock screen labels movements, shows dates and steps quantities.

export const MOVEMENT_LABELS: Record<string, string> = {
  OPENING: "Opening",
  ADJUSTMENT_PLUS: "Adjustment in",
  ADJUSTMENT_MINUS: "Adjustment out",
  SALE: "Sale",
  RETURN: "Return",
  SALE_CANCEL: "Sale cancelled",
  PURCHASE: "Purchase",
  TRANSFER_OUT: "Sent to branch",
  TRANSFER_IN: "Received from branch",
  TRANSFER_CANCEL: "Transfer cancelled",
  PURCHASE_RETURN: "Sent back to supplier",
};

export function formatDateTime(value: string) {
  return new Date(value).toLocaleString("en-IN", {
    year: "numeric",
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function normalizeLeastCount(value: number | string | null | undefined) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return 1;
  const rounded = Math.round(parsed * 1000) / 1000;
  return rounded >= 0.001 ? rounded : 1;
}

export function leastCountStepText(value: number) {
  return normalizeLeastCount(value)
    .toFixed(3)
    .replace(/0+$/, "")
    .replace(/\.$/, "");
}
