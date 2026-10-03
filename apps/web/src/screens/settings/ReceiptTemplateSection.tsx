import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import {
  presetTemplate,
  RECEIPT_PAPER_IDS,
  RECEIPT_PAPERS,
  RECEIPT_SECTION_LABELS,
  RECEIPT_SECTIONS,
  RECEIPT_STYLE_LABELS,
  RECEIPT_STYLES,
  type ReceiptPaper,
  type ReceiptSection,
  type ReceiptStyle,
  type ReceiptTemplate,
} from "@pos/contracts";
import { api, apiErrorMessage, authHeaders } from "../../lib/api";
import { receiptBaseCss, renderReceipt, sampleReceiptDocument } from "../../lib/receipt";
import { ReceiptView } from "../../components/ReceiptView";
import { useStoreSettings } from "../pos/useStoreSettings";

const PREVIEW_ID = "receipt-preview";

const sameTemplate = (a: ReceiptTemplate, b: ReceiptTemplate) =>
  a.style === b.style && a.paper === b.paper && RECEIPT_SECTIONS.every((section) => a.sections[section] === b.sections[section]);

/**
 * A branch's receipt layout: the paper its printers take, how items are laid out and which
 * parts print, with a preview of a sample sale. Every till in the branch prints with it.
 */
export function ReceiptTemplateSection({
  branches,
  branchId,
  onBranchChange,
}: {
  branches: Array<{ id: string; name: string; code: string }>;
  branchId: string;
  onBranchChange: (id: string) => void;
}) {
  const queryClient = useQueryClient();
  const store = useStoreSettings(branchId);
  const saved = store.receiptTemplate;
  const [draft, setDraft] = useState<ReceiptTemplate>(saved);
  const [message, setMessage] = useState("");

  // A different branch, or the saved template loaded or changed: start from what is saved.
  useEffect(() => {
    setDraft(saved);
  }, [saved]);

  const save = useMutation({
    mutationFn: async (template: ReceiptTemplate | null) => {
      const res = await api.branches.update({
        params: { id: branchId },
        body: { receiptTemplate: template },
        extraHeaders: authHeaders(),
      });
      if (res.status !== 200) throw new Error(apiErrorMessage(res.body, "Couldn't save the receipt layout"));
      return res.body;
    },
    onSuccess: (updated, template) => {
      queryClient.setQueryData(["branch-settings", branchId], updated);
      setMessage(template ? "Receipt layout saved. Every till in this branch prints with it now." : "Back to the classic layout.");
    },
  });

  const branding = useMemo(
    () => ({
      storeName: store.storeDisplayName,
      headerLines: store.invoiceHeaderLines,
      footerLines: store.invoiceFooterLines.length > 0 ? store.invoiceFooterLines : store.receiptFooterLines,
    }),
    [store.storeDisplayName, store.invoiceHeaderLines, store.invoiceFooterLines, store.receiptFooterLines],
  );
  const gstin = store.branchSettings.data?.gstin ?? store.businessSettings.data?.gstNumber ?? null;
  const preview = useMemo(
    () =>
      renderReceipt(
        sampleReceiptDocument(branding, { title: store.chargeTax ? "TAX INVOICE" : "BILL OF SUPPLY", gstin }),
        draft,
      ),
    [branding, draft, gstin, store.chargeTax],
  );

  const changed = !sameTemplate(draft, saved);
  const update = (next: ReceiptTemplate) => {
    setMessage("");
    setDraft(next);
  };
  const chooseStyle = (style: ReceiptStyle) => update(presetTemplate(style, draft.paper));
  const choosePaper = (paper: ReceiptPaper) => update({ ...draft, paper });
  const toggle = (section: ReceiptSection, on: boolean) => update({ ...draft, sections: { ...draft.sections, [section]: on } });

  const loading = store.branchSettings.isLoading;
  const error = (store.branchSettings.error ?? save.error) as Error | null;

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_auto]">
      <div className="card grid content-start gap-5 p-5">
        <div className="flex flex-wrap items-center gap-3">
          <h2 className="text-lg font-semibold tracking-tight text-slate-900">Receipt layout</h2>
          {branches.length > 1 ? (
            <select
              className="field w-auto"
              value={branchId}
              onChange={(e) => {
                setMessage("");
                onBranchChange(e.target.value);
              }}
              aria-label="Branch"
            >
              {branches.map((branch) => (
                <option key={branch.id} value={branch.id}>
                  {branch.name} ({branch.code})
                </option>
              ))}
            </select>
          ) : null}
        </div>
        <p className="-mt-3 text-sm text-slate-600">
          How receipts from this branch look, on every till. The GSTIN, bill number, date, tax amounts and anything else a
          GST bill needs always print.
        </p>

        <div>
          <label className="field-label" htmlFor="receipt-paper">
            Paper
          </label>
          <select
            id="receipt-paper"
            className="field w-auto"
            value={draft.paper}
            onChange={(e) => choosePaper(e.target.value as ReceiptPaper)}
            disabled={loading}
          >
            {RECEIPT_PAPER_IDS.map((paper) => (
              <option key={paper} value={paper}>
                {RECEIPT_PAPERS[paper].label} · {RECEIPT_PAPERS[paper].columns} characters a line
              </option>
            ))}
          </select>
          <p className="mt-1 text-xs text-slate-500">
            The roll your receipt printers take. Small text fits more on a line, if your printer prints it clearly.
          </p>
        </div>

        <fieldset>
          <legend className="field-label">Layout</legend>
          <div className="mt-1 grid gap-2 sm:grid-cols-2">
            {RECEIPT_STYLES.map((style) => (
              <label
                key={style}
                className={`flex cursor-pointer items-start gap-2 rounded-lg border p-3 text-sm ${
                  draft.style === style ? "border-brand-600 bg-brand-50" : "border-slate-200 hover:border-slate-300"
                }`}
              >
                <input
                  type="radio"
                  name="receipt-style"
                  className="mt-0.5"
                  checked={draft.style === style}
                  onChange={() => chooseStyle(style)}
                  disabled={loading}
                />
                <span>
                  <span className="font-semibold text-slate-900">{RECEIPT_STYLE_LABELS[style].label}</span>
                  <span className="block text-xs text-slate-600">{RECEIPT_STYLE_LABELS[style].description}</span>
                </span>
              </label>
            ))}
          </div>
          <p className="mt-1 text-xs text-slate-500">Choosing a layout switches on what it usually shows; change that below.</p>
        </fieldset>

        <fieldset>
          <legend className="field-label">Print</legend>
          <div className="mt-1 grid gap-x-4 gap-y-2 sm:grid-cols-2">
            {RECEIPT_SECTIONS.map((section) => (
              <label key={section} className="flex items-start gap-2 text-sm text-slate-700">
                <input
                  type="checkbox"
                  className="mt-0.5"
                  checked={draft.sections[section]}
                  onChange={(e) => toggle(section, e.target.checked)}
                  disabled={loading}
                />
                <span>{RECEIPT_SECTION_LABELS[section]}</span>
              </label>
            ))}
          </div>
        </fieldset>

        <div className="flex flex-wrap items-center gap-3">
          <button className="btn-primary" onClick={() => save.mutate(draft)} disabled={loading || save.isPending || !changed}>
            {save.isPending ? "Saving…" : "Save layout"}
          </button>
          <button className="btn-ghost" onClick={() => update(saved)} disabled={!changed || save.isPending}>
            Undo changes
          </button>
          <button
            className="btn-ghost"
            onClick={() => {
              if (window.confirm("Go back to the classic layout for this branch?")) save.mutate(null);
            }}
            disabled={loading || save.isPending || store.branchSettings.data?.receiptTemplate == null}
          >
            Use the classic layout
          </button>
          {changed && !save.isPending ? <span className="text-xs text-amber-700">Not saved yet</span> : null}
        </div>
        {message && !error ? (
          <p className="text-sm text-emerald-700" role="status">
            {message}
          </p>
        ) : null}
        {error ? (
          <p className="rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700" role="alert">
            {error.message}
          </p>
        ) : null}
      </div>

      <div className="card content-start p-5">
        <p className="eyebrow">Preview</p>
        <p className="mt-1 text-xs text-slate-500">A sample sale, {RECEIPT_PAPERS[draft.paper].label} paper.</p>
        <style>{receiptBaseCss(preview.columns, PREVIEW_ID)}</style>
        <div className="mt-3 overflow-x-auto">
          <ReceiptView
            id={PREVIEW_ID}
            receipt={preview}
            logoSrc={store.invoiceLogoSrc}
            className="rounded border border-slate-200 bg-white p-4 shadow-sm"
          />
        </div>
      </div>
    </div>
  );
}
