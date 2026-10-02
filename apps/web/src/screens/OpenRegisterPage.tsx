import { useMutation, useQuery } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { FormEvent, useEffect, useMemo, useState } from "react";
import { api, authHeaders } from "../lib/api";
import { getSession, updateSession } from "../lib/session";
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

export function OpenRegisterPage() {
  const navigate = useNavigate();
  const session = requireSession();
  const [selectedBranchId, setSelectedBranchId] = useState(
    session.branchId ?? session.branches[0]?.id ?? "",
  );
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
        throw new Error("Failed to load register summaries");
      }
      return res.body;
    },
  });

  const registerSummaries = registerSummaryQuery.data ?? [];
  const registerSummaryByBranch = useMemo(
    () => new Map(registerSummaries.map((summary) => [summary.branchId, summary])),
    [registerSummaries],
  );

  const selectedBranchLabel = useMemo(
    () => branches.find((branch) => branch.id === selectedBranchId)?.name ?? "",
    [branches, selectedBranchId],
  );
  const selectedBranchSummary = selectedBranchId
    ? registerSummaryByBranch.get(selectedBranchId)
    : undefined;
  const selectedBranchHasOpenRegister = Boolean(selectedBranchSummary?.current);

  const openRegister = useMutation({
    mutationFn: async () => {
      const openingBalanceValue = Number(openingBalance);
      if (!selectedBranchId) {
        throw new Error("Select a branch");
      }
      if (selectedBranchHasOpenRegister) {
        throw new Error("This branch already has an open register");
      }
      if (!Number.isFinite(openingBalanceValue) || openingBalanceValue < 0) {
        throw new Error("Opening balance must be 0 or more");
      }

      const res = await api.registers.open({
        body: {
          branchId: selectedBranchId,
          openingBalance: openingBalanceValue,
        },
        extraHeaders: authHeaders(),
      });

      if (res.status !== 200) {
        throw new Error("Failed to open register");
      }

      return res.body;
    },
    onSuccess: (data) => {
      updateSession({
        token: data.token,
        branchId: data.register.branchId,
        registerId: data.register.id,
        branches,
      });
      navigate({ to: "/pos" });
    },
  });

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    openRegister.mutate();
  };

  return (
    <section className="w-full min-h-[calc(100vh-48px)]">
      <div className="mx-auto w-full max-w-5xl p-6">
        <h1 className="text-xl font-semibold tracking-tight text-slate-900">Open a register</h1>
        <p className="mt-1 text-sm text-slate-500">
          Choose a shop and review its register status before opening a new
          session.
        </p>

        <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {branches.map((branch) => {
            const summary = registerSummaryByBranch.get(branch.id);
            const isSelected = selectedBranchId === branch.id;
            const currentRegister = summary?.current ?? null;
            const lastClosed = summary?.lastClosed ?? null;

            return (
              <button
                key={branch.id}
                type="button"
                onClick={() => setSelectedBranchId(branch.id)}
                className={[
                  "rounded-lg border bg-white p-4 text-left shadow-xs transition",
                  "hover:border-brand-300 hover:shadow-sm",
                  isSelected ? "border-brand-500 ring-2 ring-brand-500/20" : "border-slate-200",
                ].join(" ")}
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="eyebrow">
                      Shop
                    </p>
                    <p className="text-base font-semibold text-slate-900">
                      {branch.name}
                    </p>
                    <p className="text-xs text-slate-500">{branch.code}</p>
                  </div>
                  <span
                    className={[
                      "badge ring-1 ring-inset",
                      currentRegister
                        ? "bg-emerald-50 text-emerald-700 ring-emerald-600/20"
                        : "bg-slate-100 text-slate-600 ring-slate-500/20",
                    ].join(" ")}
                  >
                    {currentRegister ? "Open" : "Closed"}
                  </span>
                </div>

                <div className="mt-3 grid gap-2 text-sm text-slate-600">
                  <div className="rounded-md border border-slate-200 bg-slate-50 p-2.5">
                    <p className="eyebrow">
                      Current Register
                    </p>
                    {currentRegister ? (
                      <div className="mt-1 grid gap-1 text-sm text-slate-700">
                        <p>Opened {formatDateTime(currentRegister.openedAt)}</p>
                        <p>
                          Opening Balance: {inr(currentRegister.openingBalance)}
                        </p>
                      </div>
                    ) : (
                      <p className="mt-1 text-sm text-slate-500">
                        No register open.
                      </p>
                    )}
                  </div>
                  <div className="rounded-md border border-slate-200 bg-slate-50 p-2.5">
                    <p className="eyebrow">
                      Last Closed Register
                    </p>
                    {lastClosed ? (
                      <div className="mt-1 grid gap-1 text-sm text-slate-700">
                        <p>
                          Closed{" "}
                          {lastClosed.closedAt
                            ? formatDateTime(lastClosed.closedAt)
                            : "—"}
                        </p>
                        <p>
                          Opening: {inr(lastClosed.openingBalance)} · Closing:{" "}
                          {inr(lastClosed.closingBalance)}
                        </p>
                        {lastClosed.expectedCash !== null && lastClosed.cashDifference !== null ? (
                          <p className={Math.abs(lastClosed.cashDifference) < 0.005 ? "text-emerald-700" : "text-rose-700"}>
                            Expected: {inr(lastClosed.expectedCash)} ·{" "}
                            {Math.abs(lastClosed.cashDifference) < 0.005
                              ? "Balanced"
                              : lastClosed.cashDifference > 0
                                ? `Over by ${inr(lastClosed.cashDifference)}`
                                : `Short by ${inr(-lastClosed.cashDifference)}`}
                          </p>
                        ) : null}
                      </div>
                    ) : (
                      <p className="mt-1 text-sm text-slate-500">
                        No previous register.
                      </p>
                    )}
                  </div>
                </div>

                {currentRegister ? (
                  <p className="mt-3 text-xs font-semibold text-amber-600">
                    Register already open for this branch.
                  </p>
                ) : null}
              </button>
            );
          })}
        </div>

        <form onSubmit={onSubmit} className="card mt-6 grid max-w-md gap-4 p-5">
          <div className="grid gap-1 text-sm text-slate-700">
            <span className="eyebrow">
              Selected Branch
            </span>
            <span className="text-base font-semibold text-slate-900">
              {selectedBranchLabel || "Select a branch"}
            </span>
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
          <button
            className="btn-primary"
            type="submit"
            disabled={openRegister.isPending || !selectedBranchId || selectedBranchHasOpenRegister}
          >
            Open{" "}
            {selectedBranchLabel ? `${selectedBranchLabel} Register` : "Register"}
          </button>
          {selectedBranchHasOpenRegister ? (
            <p className="text-xs text-amber-700">
              This branch already has an open register. Close it before opening a
              new session.
            </p>
          ) : null}
        </form>

        {openRegister.error ? (
          <p className="mt-3 max-w-md rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700" role="alert">
            {(openRegister.error as Error).message}
          </p>
        ) : null}

        {registerSummaryQuery.error ? (
          <p className="mt-3 max-w-md rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700" role="alert">
            {(registerSummaryQuery.error as Error).message}
          </p>
        ) : null}
      </div>
    </section>
  );
}
