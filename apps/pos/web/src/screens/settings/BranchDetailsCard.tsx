import type { Dispatch, SetStateAction } from "react";
import { BRANCH_CODE_LENGTH, GST_STATES, gstinProblem, gstStateLabel, isGstStateCode } from "@pos/contracts";
import { uploadSrc } from "../../lib/api";
import type { SettingsForm } from "./settingsForms";
import type { BranchSettingsMutations } from "./useBranchSettingsMutations";

/** The selected branch's own settings: name, code, GSTIN and state, logo, receipt prefix and printable templates. */
export function BranchDetailsCard({
  availableBranches,
  selectedBranch,
  setSelectedBranchId,
  form,
  setForm,
  branchSettings,
  saveSettings,
  uploadLogoMutation,
  message,
  setMessage,
}: {
  availableBranches: Array<{ id: string; name: string; code: string }>;
  selectedBranch: { id: string; name: string; code: string };
  setSelectedBranchId: (id: string) => void;
  form: SettingsForm;
  setForm: Dispatch<SetStateAction<SettingsForm>>;
  branchSettings: { isLoading: boolean };
  saveSettings: BranchSettingsMutations["saveSettings"];
  uploadLogoMutation: BranchSettingsMutations["uploadLogoMutation"];
  message: string;
  setMessage: (message: string) => void;
}) {
  const logoSrc = uploadSrc(form.logoUrl);

  return (
    <div className="card p-5">
      <div className="flex flex-wrap items-center gap-3">
        <h2 className="text-lg font-semibold tracking-tight text-slate-900">Branch Settings</h2>
        <select
          className="field w-auto"
          value={selectedBranch.id}
          onChange={(e) => {
            setSelectedBranchId(e.target.value);
            setMessage("");
          }}
        >
          {availableBranches.map((branch) => (
            <option key={branch.id} value={branch.id}>
              {branch.name} ({branch.code})
            </option>
          ))}
        </select>
      </div>

      <p className="mt-1 text-sm text-slate-600">
        Update branch identity, numbering prefixes, and printable template styling.
      </p>

      <div className="mt-5 grid gap-5 lg:grid-cols-[1.2fr_1fr]">
        <div className="space-y-4">
          <div>
            <label className="text-sm text-slate-600">Branch name</label>
            <input
              className="field mt-1"
              value={form.name}
              onChange={(e) => setForm((prev) => ({ ...prev, name: e.target.value }))}
            />
          </div>
          <div>
            <label className="text-sm text-slate-600">Branch code</label>
            <input
              className="field mt-1 uppercase"
              maxLength={BRANCH_CODE_LENGTH}
              value={form.code}
              onChange={(e) => setForm((prev) => ({ ...prev, code: e.target.value.toUpperCase() }))}
            />
            <p className="mt-1 text-xs text-slate-500">
              {BRANCH_CODE_LENGTH} letters or digits. Starts every invoice and credit note number (see Counters below);
              changing it starts new series for future documents only.
            </p>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label className="text-sm text-slate-600">GSTIN</label>
              <input
                className="field mt-1 uppercase"
                value={form.gstin}
                placeholder="Leave empty to use the business GSTIN"
                onChange={(e) => {
                  const gstin = e.target.value.toUpperCase();
                  const state = gstin.trim().slice(0, 2);
                  setForm((prev) => ({ ...prev, gstin, stateCode: isGstStateCode(state) ? state : prev.stateCode }));
                }}
              />
              {form.gstin.trim() && gstinProblem(form.gstin.trim().toUpperCase()) ? (
                <p className="mt-1 text-xs text-rose-700">{gstinProblem(form.gstin.trim().toUpperCase())}</p>
              ) : null}
            </div>
            <div>
              <label className="text-sm text-slate-600">State</label>
              <select
                className="field mt-1"
                value={form.stateCode}
                onChange={(e) => setForm((prev) => ({ ...prev, stateCode: e.target.value }))}
              >
                <option value="">Not set</option>
                {GST_STATES.map((state) => (
                  <option key={state.code} value={state.code}>
                    {gstStateLabel(state.code)}
                  </option>
                ))}
              </select>
            </div>
            <p className="text-xs text-slate-500 sm:col-span-2">
              Each state the business sells from has its own GSTIN. A branch without one uses the business GSTIN when that
              is for the branch's state. The state is the place of supply of counter sales.
            </p>
          </div>

          <div>
            <label className="text-sm text-slate-600">Logo</label>
            <div className="mt-2 flex items-center gap-4">
              <div className="h-16 w-16 overflow-hidden rounded border border-slate-200 bg-slate-50">
                {logoSrc ? <img src={logoSrc} alt="Branch logo" className="h-full w-full object-contain" /> : null}
              </div>
              <div className="grid gap-2">
                <input
                  type="file"
                  accept="image/png,image/jpeg,image/webp"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) uploadLogoMutation.mutate(file);
                  }}
                />
                <button
                  className="btn-secondary px-2 py-1 text-xs"
                  onClick={() => setForm((prev) => ({ ...prev, logoUrl: null }))}
                >
                  Remove logo
                </button>
              </div>
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-3">
            <div>
              <label className="text-sm text-slate-600">Receipt prefix</label>
              <input
                className="field mt-1"
                value={form.receiptPrefix}
                onChange={(e) => setForm((prev) => ({ ...prev, receiptPrefix: e.target.value }))}
              />
            </div>
            <p className="text-xs text-slate-500 sm:col-span-2 sm:self-end">
              Invoice and credit note numbers come from the branch code and each counter's number; see Counters below.
            </p>
          </div>
        </div>

        <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
          <p className="text-sm font-semibold text-slate-800">Printable templates</p>
          <p className="mt-1 text-xs text-slate-500">
            Header and footer text for receipts and invoices. Paper, layout and what prints are set under Receipts; optional CSS restyles them.
          </p>
          <div className="mt-4 grid gap-3">
            <div>
              <label className="text-xs text-slate-600">Invoice header</label>
              <textarea
                className="field mt-1"
                rows={2}
                value={form.invoiceHeader}
                onChange={(e) => setForm((prev) => ({ ...prev, invoiceHeader: e.target.value }))}
              />
            </div>
            <div>
              <label className="text-xs text-slate-600">Invoice footer</label>
              <textarea
                className="field mt-1"
                rows={2}
                value={form.invoiceFooter}
                onChange={(e) => setForm((prev) => ({ ...prev, invoiceFooter: e.target.value }))}
              />
            </div>
            <div>
              <label className="text-xs text-slate-600">Invoice CSS</label>
              <textarea
                className="field mt-1 text-xs font-mono"
                rows={4}
                value={form.invoiceCss}
                onChange={(e) => setForm((prev) => ({ ...prev, invoiceCss: e.target.value }))}
              />
            </div>
            <div>
              <label className="text-xs text-slate-600">Receipt header</label>
              <textarea
                className="field mt-1"
                rows={2}
                value={form.receiptHeader}
                onChange={(e) => setForm((prev) => ({ ...prev, receiptHeader: e.target.value }))}
              />
            </div>
            <div>
              <label className="text-xs text-slate-600">Receipt footer</label>
              <textarea
                className="field mt-1"
                rows={2}
                value={form.receiptFooter}
                onChange={(e) => setForm((prev) => ({ ...prev, receiptFooter: e.target.value }))}
              />
            </div>
            <div>
              <label className="text-xs text-slate-600">Receipt CSS</label>
              <textarea
                className="field mt-1 text-xs font-mono"
                rows={4}
                value={form.receiptCss}
                onChange={(e) => setForm((prev) => ({ ...prev, receiptCss: e.target.value }))}
              />
            </div>
          </div>
        </div>
      </div>

      <div className="mt-4 flex items-center gap-3">
        <button
          className="btn-primary"
          onClick={() => saveSettings.mutate()}
          disabled={saveSettings.isPending || branchSettings.isLoading}
        >
          Save Branch Settings
        </button>
        {message ? <p className="text-sm text-emerald-700">{message}</p> : null}
      </div>
    </div>
  );
}
