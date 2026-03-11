import { useMutation, useQuery } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { FormEvent, useEffect, useMemo, useState } from "react";
import { api, authHeaders } from "../lib/api";
import { getSession, updateSession } from "../lib/session";
import { requireSession } from "./route-helpers";

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
    updateSession({ branches });
  }, [branches, selectedBranchId]);

  const selectedBranchLabel = useMemo(
    () => branches.find((branch) => branch.id === selectedBranchId)?.name ?? "",
    [branches, selectedBranchId],
  );

  const openRegister = useMutation({
    mutationFn: async () => {
      const openingBalanceValue = Number(openingBalance);
      if (!selectedBranchId) {
        throw new Error("Select a branch");
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
    <section className="w-full h-[calc(100vh-48px)]">
      <div className="w-full h-full flex justify-center items-center">
        <div className="rounded-md w-full h-min max-w-sm bg-white p-2">
          <h1 className="text-2xl font-bold text-slate-900">Open Register</h1>
          <p className="mt-1 text-sm text-slate-600">
            Select a branch and set opening cash balance.
          </p>
          <form onSubmit={onSubmit} className="mt-4 grid gap-3">
            <label className="grid gap-1 text-sm text-slate-700">
              Branch
              <select
                className="rounded-lg border border-slate-300 px-3 py-2"
                value={selectedBranchId}
                onChange={(e) => setSelectedBranchId(e.target.value)}
              >
                {branches.map((branch) => (
                  <option key={branch.id} value={branch.id}>
                    {branch.name} ({branch.code})
                  </option>
                ))}
              </select>
            </label>
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
              className="rounded-lg bg-teal-700 px-3 py-2 font-semibold text-white"
              type="submit"
              disabled={openRegister.isPending}
            >
              Open{" "}
              {selectedBranchLabel
                ? `${selectedBranchLabel} Register`
                : "Register"}
            </button>
          </form>
          {openRegister.error ? (
            <p className="mt-2 text-sm text-red-700">
              {(openRegister.error as Error).message}
            </p>
          ) : null}
        </div>
      </div>
    </section>
  );
}
