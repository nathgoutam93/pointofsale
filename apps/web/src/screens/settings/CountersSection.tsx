import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { FormEvent, useState } from "react";
import { documentNumber, documentSeries } from "@pos/contracts";
import { IconRegister } from "../../components/icons";
import { api, apiErrorMessage, authHeaders } from "../../lib/api";
import { useIsOffline } from "../../lib/mode";
import { GoOnlineDialog, OnlineOnlyBadge } from "../../components/OnlineOnly";
import { desktop } from "../../lib/desktop";
import { canBeFallbackCounter, fallbackBridge, useFallbackStatus } from "../../lib/fallback";

/**
 * A branch's counters (tills). Each counter runs its own register and cash drawer, so
 * several cashiers can sell in the branch at once, and numbers its own invoices and credit
 * notes ({branch code}/{counter number}/...). Counters are never deleted: one that's no
 * longer used is deactivated, which keeps the history of its registers and its number.
 */
export function CountersSection({
  branchId,
  branchName,
  branchCode,
  fiscalYear,
}: {
  branchId: string;
  branchName: string;
  branchCode: string;
  fiscalYear: number;
}) {
  const queryClient = useQueryClient();
  const [newName, setNewName] = useState("");
  const offline = useIsOffline();
  const [goOnlinePrompt, setGoOnlinePrompt] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [error, setError] = useState("");
  const fallbackStatus = useFallbackStatus();
  const thisDevice = desktop?.config.deviceId ?? null;
  const [fallbackBusy, setFallbackBusy] = useState(false);
  const changeFallback = async (action: () => Promise<unknown>) => {
    setFallbackBusy(true);
    setError("");
    try {
      await action();
      await queryClient.invalidateQueries({ queryKey: ["branch-counters", branchId] });
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure));
    } finally {
      setFallbackBusy(false);
    }
  };

  const counters = useQuery({
    queryKey: ["branch-counters", branchId],
    queryFn: async () => {
      const res = await api.counters.list({
        params: { branchId },
        query: { includeInactive: "true" },
        extraHeaders: authHeaders(),
      });
      if (res.status !== 200) throw new Error("Failed to load counters");
      return res.body;
    },
  });

  // Who has each counter open, so an open counter isn't deactivated by surprise.
  const summary = useQuery({
    queryKey: ["register-summaries"],
    queryFn: async () => {
      const res = await api.registers.summary({ extraHeaders: authHeaders() });
      if (res.status !== 200) throw new Error("Failed to load registers");
      return res.body;
    },
  });
  const openBy = new Map(
    (summary.data?.find((s) => s.branchId === branchId)?.counters ?? [])
      .filter((entry) => entry.current)
      .map((entry) => [entry.counter.id, entry.current!.openedBy]),
  );

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ["branch-counters", branchId] });
    void queryClient.invalidateQueries({ queryKey: ["register-summaries"] });
  };

  const create = useMutation({
    mutationFn: async (name: string) => {
      const res = await api.counters.create({ params: { branchId }, body: { name }, extraHeaders: authHeaders() });
      if (res.status !== 201) throw new Error(apiErrorMessage(res.body, "Failed to add counter"));
      return res.body;
    },
    onSuccess: () => {
      setNewName("");
      setError("");
      refresh();
    },
    onError: (e) => setError((e as Error).message),
  });

  const update = useMutation({
    mutationFn: async ({ id, body }: { id: string; body: { name?: string; isActive?: boolean } }) => {
      const res = await api.counters.update({ params: { id }, body, extraHeaders: authHeaders() });
      if (res.status !== 200) throw new Error(apiErrorMessage(res.body, "Failed to update counter"));
      return res.body;
    },
    onSuccess: () => {
      setEditingId(null);
      setError("");
      refresh();
    },
    onError: (e) => setError((e as Error).message),
  });

  const onAdd = (e: FormEvent) => {
    e.preventDefault();
    if (!newName.trim()) return;
    create.mutate(newName.trim());
  };

  const list = counters.data ?? [];
  const activeCount = list.filter((c) => c.isActive).length;

  return (
    <div className="card overflow-hidden">
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-200 p-5">
        <div>
          <h2 className="text-lg font-semibold tracking-tight text-slate-900">Counters</h2>
          <p className="mt-1 text-sm text-slate-500">
            Tills in {branchName}. Each counter has its own register and cash drawer, so cashiers can sell at several
            counters at once, and numbers its own invoices and credit notes. {activeCount} active.
          </p>
        </div>
        <form onSubmit={onAdd} className="flex gap-2">
          <input
            className="field w-48"
            placeholder="New counter name"
            value={newName}
            maxLength={40}
            onChange={(e) => setNewName(e.target.value)}
          />
          <button
            className="btn-primary"
            type={offline ? "button" : "submit"}
            onClick={offline ? () => setGoOnlinePrompt(true) : undefined}
            disabled={!offline && (create.isPending || !newName.trim())}
          >
            Add Counter
            {offline ? <OnlineOnlyBadge className="bg-white/90" /> : null}
          </button>
        </form>
        {goOnlinePrompt ? (
          <GoOnlineDialog title="More counters" feature="more than one counter" onClose={() => setGoOnlinePrompt(false)} />
        ) : null}
      </div>

      {error ? (
        <p className="mx-5 mt-4 rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700" role="alert">
          {error}
        </p>
      ) : null}

      {canBeFallbackCounter && fallbackStatus?.configured ? (
        <p className="mx-5 mt-4 rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600">
          This computer is the fallback counter for {fallbackStatus.counterName}: if the server can't be reached it keeps selling
          from an offline copy, {fallbackStatus.refreshedAt ? `last updated ${new Date(fallbackStatus.refreshedAt).toLocaleString()}` : "being made now"}.
          {fallbackStatus.error ? ` Last problem: ${fallbackStatus.error}` : ""}
        </p>
      ) : null}

      {counters.isLoading ? (
        <p className="p-5 text-sm text-slate-500">Loading counters…</p>
      ) : (
        <ul className="divide-y divide-slate-100">
          {list.map((counter) => {
            const openedBy = openBy.get(counter.id);
            const editing = editingId === counter.id;
            return (
              <li key={counter.id} className="flex flex-wrap items-center justify-between gap-3 px-5 py-3">
                <div className="flex min-w-0 items-center gap-3">
                  <div className={`grid h-8 w-8 shrink-0 place-items-center rounded-md ${counter.isActive ? "bg-brand-50 text-brand-600" : "bg-slate-100 text-slate-400"}`}>
                    <IconRegister width={16} height={16} />
                  </div>
                  {editing ? (
                    <form
                      className="flex gap-2"
                      onSubmit={(e) => {
                        e.preventDefault();
                        if (!editName.trim()) return;
                        update.mutate({ id: counter.id, body: { name: editName.trim() } });
                      }}
                    >
                      <input
                        className="field w-48 py-1.5"
                        value={editName}
                        maxLength={40}
                        autoFocus
                        onChange={(e) => setEditName(e.target.value)}
                      />
                      <button className="btn-primary py-1.5" type="submit" disabled={update.isPending || !editName.trim()}>
                        Save
                      </button>
                      <button className="btn-ghost py-1.5" type="button" onClick={() => setEditingId(null)}>
                        Cancel
                      </button>
                    </form>
                  ) : (
                    <div className="min-w-0">
                      <p className={`truncate text-sm font-semibold ${counter.isActive ? "text-slate-900" : "text-slate-500"}`}>
                        {counter.name}
                      </p>
                      <p className="text-xs text-slate-500">
                        {!counter.isActive ? "Inactive" : openedBy ? `Open · ${openedBy}` : "Closed"}
                        {counter.fallbackDeviceId
                          ? counter.fallbackDeviceId === thisDevice
                            ? " · Fallback counter (this computer)"
                            : " · Fallback counter (on its own computer)"
                          : ""}
                        {` · Invoices ${documentNumber(documentSeries(branchCode, counter.number, "INVOICE"), fiscalYear, 1)}`}
                        {` · Credit notes ${documentNumber(documentSeries(branchCode, counter.number, "RETURN"), fiscalYear, 1)}`}
                      </p>
                    </div>
                  )}
                </div>

                {!editing ? (
                  <div className="flex items-center gap-2">
                    {openedBy ? (
                      <span className="badge bg-emerald-50 text-emerald-700 ring-1 ring-emerald-600/20 ring-inset">In use</span>
                    ) : null}
                    {canBeFallbackCounter && counter.isActive ? (
                      counter.fallbackDeviceId === thisDevice ? (
                        <button
                          className="btn-ghost px-2.5 py-1 text-xs"
                          disabled={fallbackBusy}
                          onClick={() => {
                            if (window.confirm(`Stop ${counter.name} being the fallback counter? It then opens on any computer, and none can sell when the server is down.`)) {
                              void changeFallback(() => fallbackBridge!.remove());
                            }
                          }}
                        >
                          Stop fallback
                        </button>
                      ) : (
                        <button
                          className="btn-secondary px-2.5 py-1 text-xs"
                          disabled={fallbackBusy || Boolean(openedBy)}
                          title={openedBy ? "Close this counter's register first" : undefined}
                          onClick={() => {
                            if (
                              window.confirm(
                                `Make ${counter.name} the fallback counter on this computer?\n\nWhen the server can't be reached, this computer keeps selling on ${counter.name} (cash and card) and sends the sales once the server is back. ${counter.name} then opens only on this computer. A branch has one fallback counter.`,
                              )
                            ) {
                              void changeFallback(() => fallbackBridge!.setup(counter.id));
                            }
                          }}
                        >
                          {fallbackBusy ? "Setting up…" : "Use as fallback here"}
                        </button>
                      )
                    ) : null}
                    <button
                      className="btn-secondary px-2.5 py-1 text-xs"
                      onClick={() => {
                        setEditingId(counter.id);
                        setEditName(counter.name);
                        setError("");
                      }}
                    >
                      Rename
                    </button>
                    {counter.isActive ? (
                      <button
                        className="btn-danger px-2.5 py-1 text-xs"
                        disabled={update.isPending || Boolean(openedBy) || activeCount <= 1}
                        title={
                          openedBy
                            ? "Close this counter's register first"
                            : activeCount <= 1
                              ? "A branch needs at least one active counter"
                              : undefined
                        }
                        onClick={() => update.mutate({ id: counter.id, body: { isActive: false } })}
                      >
                        Deactivate
                      </button>
                    ) : (
                      <button
                        className="btn-secondary px-2.5 py-1 text-xs"
                        disabled={update.isPending}
                        onClick={() => update.mutate({ id: counter.id, body: { isActive: true } })}
                      >
                        Activate
                      </button>
                    )}
                  </div>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
