import { useMutation, useQuery } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { FormEvent, useEffect, useMemo, useState } from "react";
import { IconRegister } from "../components/icons";
import { desktop } from "../lib/desktop";
import { api, apiErrorMessage, authHeaders } from "../lib/api";
import { updateSession } from "../lib/session";
import { inr, requireSession } from "./route-helpers";

function formatDateTime(value: string) {
  return new Date(value).toLocaleString("en-IN", {
    year: "numeric",
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function differenceText(difference: number) {
  if (Math.abs(difference) < 0.005) return "Balanced";
  return difference > 0 ? `Over by ${inr(difference)}` : `Short by ${inr(-difference)}`;
}

export function OpenRegisterPage() {
  const navigate = useNavigate();
  const session = requireSession();
  const [selectedBranchId, setSelectedBranchId] = useState(
    session.branchId ?? session.branches[0]?.id ?? "",
  );
  const [selectedCounterId, setSelectedCounterId] = useState("");
  const [openingBalance, setOpeningBalance] = useState("0");

  useEffect(() => {
    if (session.branchId && session.registerId) {
      navigate({ to: "/pos" });
    }
  }, [navigate, session.branchId, session.registerId]);

  const branchesQuery = useQuery({
    queryKey: ["session-branches"],
    queryFn: async () => {
      const res = await api.branches.list({ extraHeaders: authHeaders() });
      if (res.status !== 200) {
        throw new Error("Failed to load branches");
      }
      return res.body;
    },
    initialData: session.branches,
  });

  const branches = branchesQuery.data ?? [];

  useEffect(() => {
    if (!selectedBranchId && branches.length > 0) {
      setSelectedBranchId(branches[0].id);
    }
  }, [branches, selectedBranchId]);

  useEffect(() => {
    updateSession({ branches });
  }, [branches]);

  const registerSummaryQuery = useQuery({
    queryKey: ["register-summaries"],
    queryFn: async () => {
      const res = await api.registers.summary({ extraHeaders: authHeaders() });
      if (res.status !== 200) {
        throw new Error("Failed to load counters");
      }
      return res.body;
    },
  });

  const summaryByBranch = useMemo(
    () => new Map((registerSummaryQuery.data ?? []).map((summary) => [summary.branchId, summary])),
    [registerSummaryQuery.data],
  );
  const counters = summaryByBranch.get(selectedBranchId)?.counters ?? [];
  const selected = counters.find((entry) => entry.counter.id === selectedCounterId);
  const selectedBranch = branches.find((branch) => branch.id === selectedBranchId);
  // A cashier runs one counter per branch; if they already hold one here, say so.
  const myOpenCounter = counters.find((entry) => entry.current?.openedBy === session.username);

  // A branch's fallback counter opens only on its own computer.
  const elsewhere = (counter: { fallbackDeviceId?: string | null }) =>
    Boolean(counter.fallbackDeviceId && counter.fallbackDeviceId !== (desktop?.config.deviceId ?? null));

  // Pick the first free counter whenever the branch (or the counters' state) changes.
  useEffect(() => {
    if (selected && !selected.current && !elsewhere(selected.counter)) return;
    const firstFree = counters.find((entry) => !entry.current && !elsewhere(entry.counter));
    setSelectedCounterId(firstFree?.counter.id ?? "");
  }, [counters, selected]);

  const openRegister = useMutation({
    mutationFn: async () => {
      const openingBalanceValue = Number(openingBalance);
      if (!selectedBranchId || !selected) {
        throw new Error("Choose a counter");
      }
      if (!Number.isFinite(openingBalanceValue) || openingBalanceValue < 0) {
        throw new Error("Opening balance must be 0 or more");
      }

      const res = await api.registers.open({
        body: {
          branchId: selectedBranchId,
          counterId: selected.counter.id,
          openingBalance: openingBalanceValue,
        },
        extraHeaders: authHeaders(),
      });

      if (res.status !== 200) {
        throw new Error(apiErrorMessage(res.body, "Failed to open register"));
      }

      return res.body;
    },
    onSuccess: (data) => {
      updateSession({
        branchId: data.register.branchId,
        registerId: data.register.id,
        counterId: data.register.counterId,
        counterName: data.register.counterName,
        branches,
      });
      navigate({ to: "/pos" });
    },
    onError: () => {
      // Someone may have taken the counter meanwhile; show the latest state.
      void registerSummaryQuery.refetch();
    },
  });

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    openRegister.mutate();
  };

  const openCount = counters.filter((entry) => entry.current).length;

  return (
    <section className="w-full min-h-[calc(100vh-48px)]">
      <div className="mx-auto w-full max-w-6xl p-6">
        <h1 className="text-xl font-semibold tracking-tight text-slate-900">Open a register</h1>
        <p className="mt-1 text-sm text-slate-500">
          Choose a branch and a free counter, then count the cash in its drawer.
        </p>

        {branches.length > 1 ? (
          <div className="mt-5 border-b border-slate-200">
            <nav className="-mb-px flex gap-6 overflow-x-auto" aria-label="Branches">
              {branches.map((branch) => {
                const branchCounters = summaryByBranch.get(branch.id)?.counters ?? [];
                const open = branchCounters.filter((entry) => entry.current).length;
                const active = branch.id === selectedBranchId;
                return (
                  <button
                    key={branch.id}
                    type="button"
                    onClick={() => {
                      setSelectedBranchId(branch.id);
                      openRegister.reset();
                    }}
                    className={`flex items-center gap-2 border-b-2 px-1 py-3 text-sm font-semibold whitespace-nowrap transition-colors ${
                      active
                        ? "border-brand-600 text-brand-700"
                        : "border-transparent text-slate-500 hover:border-slate-300 hover:text-slate-800"
                    }`}
                  >
                    {branch.name}
                    <span className={`rounded-full px-1.5 py-0.5 text-[11px] font-semibold ${active ? "bg-brand-50 text-brand-700" : "bg-slate-100 text-slate-500"}`}>
                      {open}/{branchCounters.length}
                    </span>
                  </button>
                );
              })}
            </nav>
          </div>
        ) : null}

        <div className="mt-6 flex items-baseline justify-between gap-3">
          <h2 className="text-sm font-semibold text-slate-900">
            Counters{selectedBranch ? ` · ${selectedBranch.name}` : ""}
          </h2>
          <p className="text-xs text-slate-500">
            {openCount} of {counters.length} open
          </p>
        </div>

        {registerSummaryQuery.isLoading ? (
          <p className="mt-3 text-sm text-slate-500">Loading counters…</p>
        ) : counters.length === 0 ? (
          <div className="card mt-3 p-6 text-center text-sm text-slate-500">
            This branch has no active counters. An admin can add one in Settings → Branches.
          </div>
        ) : (
          <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {counters.map(({ counter, current, lastClosed }) => {
              const isSelected = counter.id === selectedCounterId;
              const fallbackElsewhere = !current && elsewhere(counter);
              const inUse = Boolean(current) || fallbackElsewhere;
              return (
                <button
                  key={counter.id}
                  type="button"
                  disabled={inUse}
                  onClick={() => {
                    setSelectedCounterId(counter.id);
                    openRegister.reset();
                  }}
                  className={[
                    "rounded-lg border bg-white p-4 text-left shadow-xs transition",
                    inUse
                      ? "cursor-not-allowed border-slate-200 bg-slate-50 disabled:opacity-100"
                      : "hover:border-brand-300 hover:shadow-sm",
                    isSelected ? "border-brand-500 ring-2 ring-brand-500/20" : "border-slate-200",
                  ].join(" ")}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex items-center gap-3">
                      <div className={`grid h-9 w-9 place-items-center rounded-md ${inUse ? "bg-slate-200 text-slate-500" : "bg-brand-50 text-brand-600"}`}>
                        <IconRegister />
                      </div>
                      <p className="text-base font-semibold text-slate-900">{counter.name}</p>
                    </div>
                    <span
                      className={`badge ring-1 ring-inset ${
                        inUse
                          ? "bg-amber-50 text-amber-700 ring-amber-600/20"
                          : "bg-emerald-50 text-emerald-700 ring-emerald-600/20"
                      }`}
                    >
                      {current ? "In use" : fallbackElsewhere ? "Its own computer" : "Available"}
                    </span>
                  </div>

                  <div className="mt-3 border-t border-slate-100 pt-3 text-xs text-slate-500">
                    {fallbackElsewhere ? (
                      <p>The branch's fallback counter: it opens only on its own computer.</p>
                    ) : current ? (
                      <p>
                        <span className="font-medium text-slate-700">{current.openedBy}</span> since{" "}
                        {formatDateTime(current.openedAt)} · float {inr(current.openingBalance)}
                      </p>
                    ) : lastClosed ? (
                      <p>
                        Last closed {lastClosed.closedAt ? formatDateTime(lastClosed.closedAt) : "—"} by {lastClosed.openedBy}
                        {lastClosed.cashDifference !== null ? (
                          <span className={Math.abs(lastClosed.cashDifference) < 0.005 ? "text-emerald-700" : "text-rose-700"}>
                            {" "}· {differenceText(lastClosed.cashDifference)}
                          </span>
                        ) : lastClosed.closingBalance === null && lastClosed.expectedCash !== null ? (
                          // Closed when the fallback counter's offline register took over: nobody counted it.
                          <span className="text-amber-700"> · cash not counted ({inr(lastClosed.expectedCash)} expected)</span>
                        ) : null}
                      </p>
                    ) : (
                      <p>Not used yet.</p>
                    )}
                  </div>
                </button>
              );
            })}
          </div>
        )}

        <form onSubmit={onSubmit} className="card mt-6 grid max-w-md gap-4 p-5">
          <div>
            <p className="eyebrow">Opening</p>
            <p className="mt-0.5 text-base font-semibold text-slate-900">
              {selected ? `${selected.counter.name}${selectedBranch ? ` · ${selectedBranch.name}` : ""}` : "Choose a free counter"}
            </p>
          </div>
          <label className="grid gap-1 text-xs font-medium text-slate-600">
            Opening cash balance
            <input
              className="field"
              value={openingBalance}
              onChange={(e) => setOpeningBalance(e.target.value)}
              inputMode="decimal"
              placeholder="0.00"
            />
          </label>
          {myOpenCounter ? (
            <p className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
              You already have {myOpenCounter.counter.name} open in this branch, from another sign-in. Close it there
              first, or sign out and back in to continue on it.
            </p>
          ) : null}
          <button
            className="btn-primary"
            type="submit"
            disabled={openRegister.isPending || !selected || Boolean(myOpenCounter)}
          >
            {openRegister.isPending ? "Opening…" : selected ? `Open ${selected.counter.name}` : "Open Register"}
          </button>
          {openRegister.error ? (
            <p className="rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700" role="alert">
              {(openRegister.error as Error).message}
            </p>
          ) : null}
        </form>

        {registerSummaryQuery.error ? (
          <p className="mt-3 max-w-md rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700" role="alert">
            {(registerSummaryQuery.error as Error).message}
          </p>
        ) : null}
      </div>
    </section>
  );
}
