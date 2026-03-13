import { useMutation, useQuery } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { FormEvent, useEffect, useMemo, useState } from "react";
import { api, authHeaders } from "../lib/api";
import { getSession, updateSession } from "../lib/session";
import { money, requireSession } from "./route-helpers";

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
    <section className="w-full min-h-[calc(100vh-48px)] bg-slate-50">
      <div className="mx-auto w-full max-w-5xl p-6">
        <h1 className="text-2xl font-bold text-slate-900">Open Register</h1>
        <p className="mt-1 text-sm text-slate-600">
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
                  "rounded-xl border bg-white p-4 text-left shadow-sm transition",
                  "hover:border-teal-300 hover:shadow",
                  isSelected ? "border-teal-500 ring-2 ring-teal-200" : "border-slate-200",
                ].join(" ")}
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-xs uppercase tracking-wide text-slate-400">
                      Shop
                    </p>
                    <p className="text-lg font-semibold text-slate-900">
                      {branch.name}
                    </p>
                    <p className="text-xs text-slate-500">{branch.code}</p>
                  </div>
                  <span
                    className={[
                      "rounded-full px-2 py-1 text-xs font-semibold",
                      currentRegister
                        ? "bg-emerald-50 text-emerald-700"
                        : "bg-slate-100 text-slate-600",
                    ].join(" ")}
                  >
                    {currentRegister ? "Open" : "Closed"}
                  </span>
                </div>

                <div className="mt-3 grid gap-2 text-sm text-slate-600">
                  <div className="rounded-lg border border-slate-200 bg-slate-50 p-2">
                    <p className="text-[11px] uppercase tracking-wide text-slate-400">
                      Current Register
                    </p>
                    {currentRegister ? (
                      <div className="mt-1 grid gap-1 text-sm text-slate-700">
                        <p>Opened {formatDateTime(currentRegister.openedAt)}</p>
                        <p>
                          Opening Balance: ₹{money(currentRegister.openingBalance)}
                        </p>
                      </div>
                    ) : (
                      <p className="mt-1 text-sm text-slate-500">
                        No register open.
                      </p>
                    )}
                  </div>
                  <div className="rounded-lg border border-slate-200 bg-slate-50 p-2">
                    <p className="text-[11px] uppercase tracking-wide text-slate-400">
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
                          Opening: ₹{money(lastClosed.openingBalance)} · Closing: ₹
                          {money(lastClosed.closingBalance)}
                        </p>
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

        <form onSubmit={onSubmit} className="mt-6 grid gap-3 rounded-xl bg-white p-4 shadow-sm">
          <div className="grid gap-1 text-sm text-slate-700">
            <span className="text-xs uppercase tracking-wide text-slate-400">
              Selected Branch
            </span>
            <span className="text-base font-semibold text-slate-900">
              {selectedBranchLabel || "Select a branch"}
            </span>
          </div>
          <label className="grid gap-1 text-sm text-slate-700">
            Opening Balance (Cash)
            <input
              className="rounded-lg border border-slate-300 px-3 py-2"
              value={openingBalance}
              onChange={(e) => setOpeningBalance(e.target.value)}
              inputMode="decimal"
              placeholder="0.00"
            />
          </label>
          <button
            className="rounded-lg bg-teal-700 px-3 py-2 font-semibold text-white disabled:cursor-not-allowed disabled:bg-teal-300"
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
          <p className="mt-2 text-sm text-red-700">
            {(openRegister.error as Error).message}
          </p>
        ) : null}

        {registerSummaryQuery.error ? (
          <p className="mt-2 text-sm text-red-700">
            {(registerSummaryQuery.error as Error).message}
          </p>
        ) : null}
      </div>
    </section>
  );
}
