import type { Dispatch, SetStateAction } from "react";
import { BRANCH_CODE_LENGTH } from "@pos/contracts";
import { GoOnlineDialog, OnlineOnlyBadge } from "../../components/OnlineOnly";
import type { CreateBranchForm } from "./settingsForms";

/** Adding a branch; an offline business is asked to go online first. */
export function CreateBranchCard({
  offline,
  createBranchForm,
  setCreateBranchForm,
  createBranch,
  branchMessage,
  goOnlinePrompt,
  setGoOnlinePrompt,
}: {
  offline: boolean;
  createBranchForm: CreateBranchForm;
  setCreateBranchForm: Dispatch<SetStateAction<CreateBranchForm>>;
  createBranch: { mutate: () => void; isPending: boolean };
  branchMessage: string;
  goOnlinePrompt: boolean;
  setGoOnlinePrompt: (open: boolean) => void;
}) {
  return (
    <>
      <div className="card p-5">
        <div className="flex items-center gap-2">
          <h2 className="text-lg font-semibold tracking-tight text-slate-900">Create New Branch</h2>
          {offline ? <OnlineOnlyBadge /> : null}
        </div>
        <p className="mt-1 text-sm text-slate-600">
          Create a new branch and manage its prefixes, templates, and logo from this page.
        </p>
        <div className="mt-4 grid gap-3 md:grid-cols-[1fr_1fr_auto]">
          <input
            className="field"
            placeholder="Branch name"
            value={createBranchForm.name}
            onChange={(e) => setCreateBranchForm((prev) => ({ ...prev, name: e.target.value }))}
          />
          <input
            className="field uppercase"
            placeholder="Branch code, 3 letters or digits (e.g. BLR)"
            maxLength={BRANCH_CODE_LENGTH}
            value={createBranchForm.code}
            onChange={(e) => setCreateBranchForm((prev) => ({ ...prev, code: e.target.value.toUpperCase() }))}
          />
          <button
            className="btn-primary"
            onClick={() => (offline ? setGoOnlinePrompt(true) : createBranch.mutate())}
            disabled={!offline && (createBranch.isPending || !createBranchForm.name.trim() || !createBranchForm.code.trim())}
          >
            Create Branch
          </button>
        </div>
        {branchMessage ? <p className="mt-3 text-sm text-emerald-700">{branchMessage}</p> : null}
      </div>
      {goOnlinePrompt ? (
        <GoOnlineDialog title="More branches" feature="more than one branch" onClose={() => setGoOnlinePrompt(false)} />
      ) : null}
    </>
  );
}
