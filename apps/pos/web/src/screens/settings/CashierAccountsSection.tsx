import type { Dispatch, SetStateAction } from "react";
import { api } from "../../lib/api";
import { CashierPermissions } from "./CashierPermissions";
import type { CashierForm } from "./settingsForms";
import type { CashierMutations } from "./useCashierMutations";

type User = Extract<Awaited<ReturnType<typeof api.users.list>>, { status: 200 }>["body"][number];

/** Cashier logins at the selected branch: adding one, their password, what they may do and which branches they work at. */
export function CashierAccountsSection({
  availableBranches,
  selectedBranch,
  setSelectedBranchId,
  cashierForm,
  setCashierForm,
  cashiers,
  passwordByUserId,
  setPasswordByUserId,
  keepPasswordByUserId,
  setKeepPasswordByUserId,
  createCashier,
  updateUser,
  grantBranchAccess,
  revokeBranchAccess,
  userMessage,
  setUserMessage,
}: {
  availableBranches: Array<{ id: string; name: string; code: string }>;
  selectedBranch: { id: string; name: string; code: string };
  setSelectedBranchId: (id: string) => void;
  cashierForm: CashierForm;
  setCashierForm: Dispatch<SetStateAction<CashierForm>>;
  cashiers: User[];
  passwordByUserId: Record<string, string>;
  setPasswordByUserId: Dispatch<SetStateAction<Record<string, string>>>;
  keepPasswordByUserId: Record<string, boolean>;
  setKeepPasswordByUserId: Dispatch<SetStateAction<Record<string, boolean>>>;
  createCashier: CashierMutations["createCashier"];
  updateUser: CashierMutations["updateUser"];
  grantBranchAccess: CashierMutations["grantBranchAccess"];
  revokeBranchAccess: CashierMutations["revokeBranchAccess"];
  userMessage: string;
  setUserMessage: (message: string) => void;
}) {
  return (
    <div className="card p-5">
      <div className="flex flex-wrap items-center gap-3">
        <h2 className="text-lg font-semibold tracking-tight text-slate-900">Cashier Accounts</h2>
        <select
          className="field"
          value={selectedBranch.id}
          onChange={(e) => {
            setSelectedBranchId(e.target.value);
            setUserMessage("");
          }}
        >
          {availableBranches.map((branch) => (
            <option key={branch.id} value={branch.id}>
              {branch.name} ({branch.code})
            </option>
          ))}
        </select>
      </div>
      <p className="mt-1 text-sm text-slate-600">Create and manage cashier logins, branch access, and account status.</p>

      <div className="mt-4 grid gap-3 md:grid-cols-[1fr_1fr_auto]">
        <input
          className="field"
          placeholder="Username"
          value={cashierForm.username}
          onChange={(e) => setCashierForm((prev) => ({ ...prev, username: e.target.value }))}
        />
        <input
          className="field"
          placeholder="Password"
          type="password"
          value={cashierForm.password}
          onChange={(e) => setCashierForm((prev) => ({ ...prev, password: e.target.value }))}
        />
        <div className="rounded border border-slate-200 p-2 text-sm">
          <p className="text-xs font-semibold text-slate-600">Branch Access</p>
          <div className="mt-1 flex flex-wrap gap-2">
            {availableBranches.map((branch) => {
              const checked = cashierForm.branchIds.includes(branch.id);
              return (
                <label key={branch.id} className="inline-flex items-center gap-1 text-xs">
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={(e) => {
                      setCashierForm((prev) => ({
                        ...prev,
                        branchIds: e.target.checked
                          ? Array.from(new Set([...prev.branchIds, branch.id]))
                          : prev.branchIds.filter((id) => id !== branch.id)
                      }));
                    }}
                  />
                  {branch.code}
                </label>
              );
            })}
          </div>
        </div>
        <div className="md:col-span-3">
          <CashierPermissions
            value={cashierForm.permissions}
            onChange={(permissions) => setCashierForm((prev) => ({ ...prev, permissions }))}
          />
        </div>
        <button
          className="btn-primary"
          onClick={() => createCashier.mutate()}
          disabled={createCashier.isPending || !cashierForm.username.trim() || !cashierForm.password || cashierForm.branchIds.length === 0}
        >
          Add Cashier
        </button>
      </div>

      <div className="mt-5 space-y-3">
        {cashiers.map((user) => (
          <div key={user.id} className="rounded border border-slate-200 p-3">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="font-semibold text-slate-900">
                  {user.username}
                  {user.mustChangePassword ? (
                    <span className="ml-2 rounded bg-amber-100 px-1.5 py-0.5 text-[11px] font-semibold text-amber-800">
                      Chooses a new password at next sign-in
                    </span>
                  ) : null}
                </p>
                <p className="text-xs text-slate-500">
                  Status: {user.isActive ? "Active" : "Inactive"} • Created {new Date(user.createdAt).toLocaleDateString()}
                </p>
                <p className="mt-1 text-xs text-slate-500">
                  Branch access: {user.branchIds.map((id) => availableBranches.find((branch) => branch.id === id)?.code ?? id).join(", ")}
                </p>
              </div>
              <button
                className={`rounded px-3 py-1 text-xs font-semibold ${user.isActive ? "bg-rose-100 text-rose-700" : "bg-emerald-100 text-emerald-700"}`}
                onClick={() => updateUser.mutate({ id: user.id, isActive: !user.isActive })}
              >
                {user.isActive ? "Deactivate" : "Activate"}
              </button>
            </div>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <input
                className="field"
                placeholder="New password"
                type="password"
                value={passwordByUserId[user.id] ?? ""}
                onChange={(e) => setPasswordByUserId((prev) => ({ ...prev, [user.id]: e.target.value }))}
              />
              <button
                className="btn-secondary px-3 py-1 text-xs"
                onClick={() => {
                  const nextPassword = passwordByUserId[user.id];
                  if (!nextPassword?.trim()) {
                    setUserMessage("Enter a password to reset.");
                    return;
                  }
                  updateUser.mutate({ id: user.id, password: nextPassword, mustChangePassword: !keepPasswordByUserId[user.id] });
                  setPasswordByUserId((prev) => ({ ...prev, [user.id]: "" }));
                }}
              >
                Reset Password
              </button>
              <label className="inline-flex items-center gap-1.5 text-xs text-slate-600">
                <input
                  type="checkbox"
                  checked={!keepPasswordByUserId[user.id]}
                  onChange={(e) => setKeepPasswordByUserId((prev) => ({ ...prev, [user.id]: !e.target.checked }))}
                />
                Ask them to choose their own at next sign-in
              </label>
            </div>
            <div className="mt-3">
              <CashierPermissions
                value={user.permissions ?? []}
                disabled={updateUser.isPending}
                onChange={(permissions) => updateUser.mutate({ id: user.id, permissions })}
              />
            </div>
            <div className="mt-3 rounded border border-slate-200 p-2">
              <p className="text-xs font-semibold text-slate-600">Branch Access</p>
              <div className="mt-2 flex flex-wrap gap-3">
                {availableBranches.map((branch) => {
                  const hasAccess = user.branchIds.includes(branch.id);
                  const isPrimary = user.branchId === branch.id;
                  return (
                    <label key={`${user.id}-${branch.id}`} className="inline-flex items-center gap-1 text-xs">
                      <input
                        type="checkbox"
                        checked={hasAccess}
                        disabled={isPrimary}
                        onChange={(e) => {
                          if (e.target.checked) {
                            grantBranchAccess.mutate({ id: user.id, branchId: branch.id });
                          } else {
                            revokeBranchAccess.mutate({ id: user.id, branchId: branch.id });
                          }
                        }}
                      />
                      {branch.name} ({branch.code}){isPrimary ? " - Primary" : ""}
                    </label>
                  );
                })}
              </div>
            </div>
          </div>
        ))}
        {cashiers.length === 0 ? <p className="text-sm text-slate-500">No cashier accounts yet for this branch.</p> : null}
      </div>

      {userMessage ? <p className="mt-3 text-sm text-emerald-700">{userMessage}</p> : null}
    </div>
  );
}
