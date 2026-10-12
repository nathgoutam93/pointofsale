const INVOICE_STATUS: Record<string, { label: string; tone: string }> = {
  SETTLED: { label: "Settled", tone: "bg-emerald-50 text-emerald-700 ring-emerald-600/20" },
  PARTIALLY_SETTLED: { label: "Partial", tone: "bg-amber-50 text-amber-700 ring-amber-600/20" },
  DRAFT: { label: "Unpaid", tone: "bg-amber-50 text-amber-700 ring-amber-600/20" },
  CANCELLED: { label: "Cancelled", tone: "bg-slate-100 text-slate-600 ring-slate-500/20" },
};

/** An invoice's status as a coloured pill. */
export function StatusBadge({ status }: { status: string | undefined | null }) {
  const known = status ? INVOICE_STATUS[status] : undefined;
  const label = known?.label ?? (status ? status.replace(/_/g, " ").toLowerCase() : "—");
  const tone = known?.tone ?? "bg-slate-100 text-slate-600 ring-slate-500/20";
  return <span className={`badge ring-1 ring-inset ${tone}`}>{label}</span>;
}
