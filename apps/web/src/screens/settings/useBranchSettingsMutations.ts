import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { Dispatch, SetStateAction } from "react";
import { branchCodeProblem } from "@pos/contracts";
import { api, apiErrorMessage, apiFetch, authHeaders } from "../../lib/api";
import type { SettingsForm } from "./settingsForms";

/** Saving the selected branch's settings form, and uploading its logo. */
export function useBranchSettingsMutations({
  selectedBranchId,
  form,
  setForm,
  setMessage,
}: {
  selectedBranchId: string;
  form: SettingsForm;
  setForm: Dispatch<SetStateAction<SettingsForm>>;
  setMessage: (message: string) => void;
}) {
  const queryClient = useQueryClient();

  const saveSettings = useMutation({
    mutationFn: async () => {
      const emptyToNull = (value: string) => (value.trim() ? value : null);
      const trimmedCode = form.code.trim().toUpperCase();
      const codeProblem = branchCodeProblem(trimmedCode);
      if (codeProblem) {
        throw new Error(codeProblem);
      }
      if (!selectedBranchId) {
        throw new Error("Select a branch first.");
      }
      const res = await api.branches.update({
        params: { id: selectedBranchId },
        body: {
          name: form.name.trim(),
          code: trimmedCode,
          logoUrl: form.logoUrl,
          receiptPrefix: form.receiptPrefix.trim(),
          invoiceHeader: emptyToNull(form.invoiceHeader),
          invoiceFooter: emptyToNull(form.invoiceFooter),
          receiptHeader: emptyToNull(form.receiptHeader),
          receiptFooter: emptyToNull(form.receiptFooter),
          invoiceCss: emptyToNull(form.invoiceCss),
          receiptCss: emptyToNull(form.receiptCss),
          gstin: emptyToNull(form.gstin.trim().toUpperCase()),
          stateCode: emptyToNull(form.stateCode)
        },
        extraHeaders: authHeaders()
      });
      if (res.status !== 200) throw new Error(apiErrorMessage(res.body, "Failed to save branch settings"));
      return res.body;
    },
    onSuccess: (updated) => {
      queryClient.setQueryData(["branch-settings", selectedBranchId], updated);
      setMessage("Branch settings saved.");
      queryClient.invalidateQueries({ queryKey: ["accessible-branches"] });
    },
    onError: (error) => {
      setMessage((error as Error).message);
    }
  });

  const uploadLogo = async (file: File) => {
    if (!selectedBranchId) {
      throw new Error("Select a branch first.");
    }
    const body = new FormData();
    body.append("file", file);
    const res = await apiFetch(`/branches/${selectedBranchId}/logo`, { method: "POST", body });
    if (!res.ok) throw new Error("Failed to upload logo");
    return (await res.json()) as {
      name: string;
      code: string;
      logoUrl: string | null;
      receiptPrefix: string;
      invoiceHeader: string | null;
      invoiceFooter: string | null;
      receiptHeader: string | null;
      receiptFooter: string | null;
      invoiceCss: string | null;
      receiptCss: string | null;
    };
  };

  const uploadLogoMutation = useMutation({
    mutationFn: async (file: File) => uploadLogo(file),
    onSuccess: (updated) => {
      setForm((prev) => ({
        ...prev,
        name: updated.name ?? prev.name,
        code: updated.code ?? prev.code,
        logoUrl: updated.logoUrl ?? null,
        receiptPrefix: updated.receiptPrefix ?? prev.receiptPrefix,
        invoiceHeader: updated.invoiceHeader ?? "",
        invoiceFooter: updated.invoiceFooter ?? "",
        receiptHeader: updated.receiptHeader ?? "",
        receiptFooter: updated.receiptFooter ?? "",
        invoiceCss: updated.invoiceCss ?? "",
        receiptCss: updated.receiptCss ?? ""
      }));
      queryClient.invalidateQueries({ queryKey: ["branch-settings", selectedBranchId] });
      setMessage("Logo updated.");
      queryClient.invalidateQueries({ queryKey: ["accessible-branches"] });
    },
    onError: (error) => {
      setMessage((error as Error).message);
    }
  });

  return { saveSettings, uploadLogoMutation };
}

export type BranchSettingsMutations = ReturnType<typeof useBranchSettingsMutations>;
