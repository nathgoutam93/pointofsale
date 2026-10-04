import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { FormEvent, useEffect, useMemo, useState } from "react";
import { IconTrash } from "../components/icons";
import { api, apiErrorMessage, authHeaders } from "../lib/api";
import { BranchPicker } from "../components/BranchPicker";
import { useManagedBranch } from "../lib/branch";
import { can } from "../lib/session";
import { requireManagementSession } from "./route-helpers";
import { ItemPicker } from "./stock/ItemPicker";
import { GoOnlinePanel } from "../components/OnlineOnly";
import { useIsOffline } from "../lib/mode";

type DraftLine = { itemId: string; code: string; name: string; uom: string; qty: string };

function formatDate(value: string) {
  return new Date(value).toLocaleString("en-IN", { year: "numeric", month: "short", day: "2-digit", hour: "2-digit", minute: "2-digit" });
}

const STATUS_LABELS = { IN_TRANSIT: "In transit", RECEIVED: "Received", CANCELLED: "Cancelled" } as const;
const STATUS_TONES = {
  IN_TRANSIT: "bg-amber-50 text-amber-700 ring-amber-600/20",
  RECEIVED: "bg-emerald-50 text-emerald-700 ring-emerald-600/20",
  CANCELLED: "bg-slate-100 text-slate-600 ring-slate-500/20",
} as const;

/**
 * Stock sent between branches. Sending takes it out of this branch at once; the receiving
 * branch takes it in when the goods arrive, or the sender cancels it while in transit.
 */
export function TransfersPage() {
  if (useIsOffline()) {
    return <GoOnlinePanel title="Stock transfers" feature="stock transfers between branches" />;
  }
  return <Transfers />;
}

function Transfers() {
  const session = requireManagementSession();
  const [managedBranch, setManagedBranch] = useManagedBranch();
  const branchId = managedBranch ?? "";
  // Anyone at a branch receives what arrives there; sending and calling back need the permission.
  const canSend = can(session, "SEND_TRANSFERS");
  const queryClient = useQueryClient();
  // Stock can go to any branch of the business, not only the ones this person works at.
  const destinations = useQuery({
    queryKey: ["transfer-destinations"],
    queryFn: async () => {
      const res = await api.transfers.destinations({ extraHeaders: authHeaders() });
      if (res.status !== 200) throw new Error("Failed to load the branches");
      return res.body;
    },
    enabled: canSend,
  });
  const otherBranches = (destinations.data ?? session.branches).filter((branch) => branch.id !== branchId);
  const [toBranchId, setToBranchId] = useState(otherBranches[0]?.id ?? "");
  useEffect(() => {
    if (!otherBranches.some((branch) => branch.id === toBranchId)) setToBranchId(otherBranches[0]?.id ?? "");
  }, [branchId, destinations.data]); // eslint-disable-line react-hooks/exhaustive-deps
  const [note, setNote] = useState("");
  const [lines, setLines] = useState<DraftLine[]>([]);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  const items = useQuery({
    queryKey: ["items-stock-list"],
    queryFn: async () => {
      const res = await api.items.list({ query: { activeOnly: true }, extraHeaders: authHeaders() });
      if (res.status !== 200) throw new Error("Failed to fetch items");
      return res.body;
    },
  });

  const onHand = useQuery({
    queryKey: ["stock-module", branchId],
    queryFn: async () => {
      const res = await api.stock.onHand({ query: { branchId: branchId }, extraHeaders: authHeaders() });
      if (res.status !== 200) throw new Error("Failed to fetch stock");
      return res.body;
    },
  });
  const onHandByItem = useMemo(() => new Map((onHand.data ?? []).map((row) => [row.itemId, row.onHand])), [onHand.data]);

  const transfers = useQuery({
    queryKey: ["transfers", branchId],
    queryFn: async () => {
      const res = await api.transfers.list({ query: { branchId: branchId }, extraHeaders: authHeaders() });
      if (res.status !== 200) throw new Error("Failed to load transfers");
      return res.body;
    },
  });

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ["transfers"] });
    void queryClient.invalidateQueries({ queryKey: ["stock-module"] });
    void queryClient.invalidateQueries({ queryKey: ["stock-ledger"] });
  };

  const send = useMutation({
    mutationFn: async () => {
      const res = await api.transfers.create({
        body: {
          fromBranchId: branchId,
          toBranchId,
          note: note.trim() || undefined,
          lines: lines.map((line) => ({ itemId: line.itemId, qty: Number(line.qty) })),
        },
        extraHeaders: authHeaders(),
      });
      if (res.status !== 201) throw new Error(apiErrorMessage(res.body, "Failed to send stock"));
      return res.body;
    },
    onSuccess: (transfer) => {
      setLines([]);
      setNote("");
      setError("");
      setMessage(`${transfer.transferNo} sent to ${transfer.toBranch.name}.`);
      refresh();
    },
    onError: (e) => {
      setMessage("");
      setError((e as Error).message);
    },
  });

  const close = useMutation({
    mutationFn: async ({ id, action }: { id: string; action: "receive" | "cancel" }) => {
      const res =
        action === "receive"
          ? await api.transfers.receive({ params: { id }, extraHeaders: authHeaders() })
          : await api.transfers.cancel({ params: { id }, extraHeaders: authHeaders() });
      if (res.status !== 200) throw new Error(apiErrorMessage(res.body, `Failed to ${action} transfer`));
      return res.body;
    },
    onSuccess: (transfer) => {
      setError("");
      setMessage(`${transfer.transferNo} ${transfer.status === "RECEIVED" ? "received" : "cancelled"}.`);
      refresh();
    },
    onError: (e) => {
      setMessage("");
      setError((e as Error).message);
    },
  });

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (!toBranchId) return setError("Choose a branch to send to");
    if (lines.length === 0) return setError("Add at least one item");
    const bad = lines.find((line) => !(Number(line.qty) > 0));
    if (bad) return setError(`Enter a quantity for ${bad.name}`);
    const short = lines.find((line) => Number(line.qty) > (onHandByItem.get(line.itemId) ?? 0));
    if (short) return setError(`Only ${onHandByItem.get(short.itemId) ?? 0} ${short.uom} of ${short.name} on hand`);
    send.mutate();
  };

  const lineIds = useMemo(() => new Set(lines.map((line) => line.itemId)), [lines]);
  const all = transfers.data ?? [];
  const incoming = all.filter((t) => t.status === "IN_TRANSIT" && t.toBranchId === branchId);
  const outgoing = all.filter((t) => t.status === "IN_TRANSIT" && t.fromBranchId === branchId);
  const history = all.filter((t) => t.status !== "IN_TRANSIT");

  const renderTransfer = (transfer: (typeof all)[number], action?: "receive" | "cancel") => {
    const outbound = transfer.fromBranchId === branchId;
    return (
      <li key={transfer.id} className="flex flex-wrap items-start justify-between gap-3 px-5 py-3">
        <div className="min-w-0">
          <p className="text-sm font-semibold text-slate-900">
            {transfer.transferNo} · {outbound ? `to ${transfer.toBranch.name}` : `from ${transfer.fromBranch.name}`}
          </p>
          <p className="text-xs text-slate-500">
            Sent {formatDate(transfer.createdAt)} by {transfer.createdByName}
            {transfer.closedAt ? ` · ${STATUS_LABELS[transfer.status]} ${formatDate(transfer.closedAt)} by ${transfer.closedByName}` : ""}
          </p>
          <p className="mt-1 text-sm text-slate-700">
            {transfer.lines.map((line) => `${line.item.name} × ${Number(line.qty)} ${line.item.uom}`).join(", ")}
          </p>
          {transfer.note ? <p className="mt-1 text-xs text-slate-500">{transfer.note}</p> : null}
        </div>
        <div className="flex items-center gap-2">
          <span className={`badge ring-1 ring-inset ${STATUS_TONES[transfer.status]}`}>{STATUS_LABELS[transfer.status]}</span>
          {action === "receive" && (
            <button
              type="button"
              className="btn-success py-1.5"
              disabled={close.isPending}
              onClick={() => close.mutate({ id: transfer.id, action: "receive" })}
            >
              Receive
            </button>
          )}
          {action === "cancel" && canSend && (
            <button
              type="button"
              className="btn-secondary py-1.5"
              disabled={close.isPending}
              onClick={() => {
                if (!window.confirm(`Cancel ${transfer.transferNo}? The stock comes back to this branch.`)) return;
                close.mutate({ id: transfer.id, action: "cancel" });
              }}
            >
              Cancel Transfer
            </button>
          )}
        </div>
      </li>
    );
  };

  return (
    <section className="space-y-6 p-6">
      <BranchPicker
        value={branchId}
        onChange={(next) => {
          setManagedBranch(next);
          setLines([]);
          setMessage("");
          setError("");
        }}
      />
      {(message || error) && (
        <p
          className={`rounded-md border px-3 py-2 text-sm ${error ? "border-rose-200 bg-rose-50 text-rose-700" : "border-emerald-200 bg-emerald-50 text-emerald-700"}`}
          role={error ? "alert" : "status"}
        >
          {error || message}
        </p>
      )}

      {incoming.length > 0 && (
        <div className="card overflow-hidden">
          <div className="border-b border-slate-200 p-5">
            <h3 className="text-sm font-semibold text-slate-900">Arriving here</h3>
            <p className="mt-1 text-xs text-slate-500">Receive a transfer once the goods arrive; the stock is added to this branch.</p>
          </div>
          <ul className="divide-y divide-slate-100">{incoming.map((transfer) => renderTransfer(transfer, "receive"))}</ul>
        </div>
      )}

      {canSend ? (
      <form onSubmit={onSubmit} className="card overflow-visible">
        <div className="border-b border-slate-200 p-5">
          <h2 className="page-title">Send Stock</h2>
          <p className="mt-1 text-sm text-slate-500">
            Stock leaves this branch now and is added at the other branch when it is received there. Quantities are in each
            item's base unit.
          </p>
        </div>
        {otherBranches.length === 0 ? (
          <p className="p-5 text-sm text-slate-500">You have access to no other branch to send stock to.</p>
        ) : (
          <div className="space-y-3 p-5">
            <label className="block max-w-sm text-sm text-slate-600">
              Send to
              <select className="field mt-1" value={toBranchId} onChange={(e) => setToBranchId(e.target.value)}>
                {otherBranches.map((branch) => (
                  <option key={branch.id} value={branch.id}>
                    {branch.name} ({branch.code})
                  </option>
                ))}
              </select>
            </label>
            <ItemPicker
              items={items.data ?? []}
              excludeIds={lineIds}
              onPick={(item) => setLines((current) => [...current, { itemId: item.id, code: item.code, name: item.name, uom: item.uom, qty: "" }])}
            />
            {lines.length > 0 && (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="eyebrow border-b border-slate-200 text-left">
                      <th className="py-2">Item</th>
                      <th className="py-2">On hand</th>
                      <th className="py-2">Qty to send</th>
                      <th className="py-2" />
                    </tr>
                  </thead>
                  <tbody>
                    {lines.map((line) => (
                      <tr key={line.itemId} className="border-b border-slate-100">
                        <td className="py-2 pr-3">
                          <p className="font-medium text-slate-900">{line.name}</p>
                          <p className="text-xs text-slate-500">{line.code}</p>
                        </td>
                        <td className="py-2 pr-3 tabular-nums">
                          {onHandByItem.get(line.itemId) ?? 0} {line.uom}
                        </td>
                        <td className="py-2 pr-3">
                          <input
                            className="field w-24 py-1"
                            type="number"
                            min="0"
                            step="any"
                            value={line.qty}
                            autoFocus={line.qty === ""}
                            onChange={(e) =>
                              setLines((current) => current.map((entry) => (entry.itemId === line.itemId ? { ...entry, qty: e.target.value } : entry)))
                            }
                          />
                        </td>
                        <td className="py-2 pl-2 text-right">
                          <button
                            type="button"
                            className="btn-ghost px-2 py-1"
                            aria-label={`Remove ${line.name}`}
                            onClick={() => setLines((current) => current.filter((entry) => entry.itemId !== line.itemId))}
                          >
                            <IconTrash width={16} height={16} />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <label className="block text-sm text-slate-600">
              Note <span className="text-slate-400">(optional)</span>
              <input className="field mt-1" value={note} maxLength={500} onChange={(e) => setNote(e.target.value)} />
            </label>
            <p className="text-xs text-amber-700">
              Sending to a branch with a different GSTIN (another state) is a taxable supply under GST and needs a tax invoice;
              this transfer note is not one.
            </p>
            <button className="btn-primary" type="submit" disabled={send.isPending}>
              {send.isPending ? "Sending..." : "Send Stock"}
            </button>
          </div>
        )}
      </form>
      ) : null}

      {outgoing.length > 0 && (
        <div className="card overflow-hidden">
          <div className="border-b border-slate-200 p-5">
            <h3 className="text-sm font-semibold text-slate-900">Sent, in transit</h3>
          </div>
          <ul className="divide-y divide-slate-100">{outgoing.map((transfer) => renderTransfer(transfer, "cancel"))}</ul>
        </div>
      )}

      <div className="card overflow-hidden">
        <div className="border-b border-slate-200 p-5">
          <h3 className="text-sm font-semibold text-slate-900">History</h3>
        </div>
        {transfers.isLoading ? (
          <p className="p-5 text-sm text-slate-500">Loading transfers...</p>
        ) : history.length === 0 ? (
          <p className="p-5 text-sm text-slate-500">No completed transfers yet.</p>
        ) : (
          <ul className="divide-y divide-slate-100">{history.map((transfer) => renderTransfer(transfer))}</ul>
        )}
      </div>
    </section>
  );
}
