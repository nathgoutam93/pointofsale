import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { Dispatch, SetStateAction } from "react";
import { api, apiErrorMessage, apiFetch, authHeaders } from "../../lib/api";
import type { BusinessSettingsForm } from "./settingsForms";

/** Saving the business settings form, and uploading the business logo. */
export function useBusinessSettingsMutations({
  businessForm,
  setBusinessForm,
  setBusinessMessage,
}: {
  businessForm: BusinessSettingsForm;
  setBusinessForm: Dispatch<SetStateAction<BusinessSettingsForm>>;
  setBusinessMessage: (message: string) => void;
}) {
  const queryClient = useQueryClient();

  const saveBusinessSettings = useMutation({
    mutationFn: async () => {
      const emptyToNull = (value: string) => (value.trim() ? value.trim() : null);
      const trimmedName = businessForm.name.trim();
      if (!trimmedName) {
        throw new Error("Business name is required.");
      }
      const cashierMaxDiscountPercent = Number(businessForm.cashierMaxDiscountPercent);
      if (
        businessForm.cashierMaxDiscountPercent.trim() === "" ||
        !Number.isFinite(cashierMaxDiscountPercent) ||
        cashierMaxDiscountPercent < 0 ||
        cashierMaxDiscountPercent > 100
      ) {
        throw new Error("Cashier discount limit must be between 0 and 100.");
      }
      const returnWindowText = businessForm.returnWindowDays.trim();
      const returnWindowDays = returnWindowText === "" ? null : Number(returnWindowText);
      if (returnWindowDays !== null && (!Number.isInteger(returnWindowDays) || returnWindowDays < 0 || returnWindowDays > 3650)) {
        throw new Error("Return window must be a whole number of days, or empty for no limit.");
      }
      const res = await api.business.update({
        body: {
          name: trimmedName,
          logoUrl: businessForm.logoUrl,
          gstNumber: emptyToNull(businessForm.gstNumber),
          cashierMaxDiscountPercent,
          customerScope: businessForm.customerScope,
          timezone: businessForm.timezone,
          hsnMinDigits: businessForm.hsnMinDigits,
          returnWindowDays,
          roundOffMode: businessForm.roundOffMode,
          allowNegativeStock: businessForm.allowNegativeStock,
          scaleBarcode: businessForm.scaleEnabled
            ? {
                prefix: businessForm.scalePrefix.trim(),
                itemDigits: Number(businessForm.scaleItemDigits),
                valueType: businessForm.scaleValueType,
                valueDigits: Number(businessForm.scaleValueDigits),
                valueDecimals: Number(businessForm.scaleValueDecimals)
              }
            : null
        },
        extraHeaders: authHeaders()
      });
      if (res.status !== 200) throw new Error(apiErrorMessage(res.body, "Failed to save business settings"));
      return res.body;
    },
    onSuccess: (updated) => {
      queryClient.setQueryData(["business-settings"], updated);
      setBusinessMessage("Business settings saved.");
    },
    onError: (error) => {
      setBusinessMessage((error as Error).message);
    }
  });

  const uploadBusinessLogo = async (file: File) => {
    const body = new FormData();
    body.append("file", file);
    const res = await apiFetch("/business/logo", { method: "POST", body });
    if (!res.ok) throw new Error("Failed to upload business logo");
    return (await res.json()) as {
      id: string;
      name: string;
      logoUrl: string | null;
      gstNumber: string | null;
    };
  };

  const uploadBusinessLogoMutation = useMutation({
    mutationFn: async (file: File) => uploadBusinessLogo(file),
    onSuccess: (updated) => {
      setBusinessForm((prev) => ({
        ...prev,
        name: updated.name ?? prev.name,
        logoUrl: updated.logoUrl ?? null,
        gstNumber: updated.gstNumber ?? ""
      }));
      queryClient.invalidateQueries({ queryKey: ["business-settings"] });
      setBusinessMessage("Business logo updated.");
    },
    onError: (error) => {
      setBusinessMessage((error as Error).message);
    }
  });

  return { saveBusinessSettings, uploadBusinessLogoMutation };
}

export type BusinessSettingsMutations = ReturnType<typeof useBusinessSettingsMutations>;
