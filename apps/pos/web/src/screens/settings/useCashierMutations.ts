import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { Dispatch, SetStateAction } from "react";
import type { CashierPermission } from "@pos/contracts";
import { api, apiErrorMessage, authHeaders } from "../../lib/api";
import { emptyCashierForm, type CashierForm } from "./settingsForms";

/** Cashier accounts at the selected branch: adding one, changing one, and its branch access. */
export function useCashierMutations({
  selectedBranchId,
  cashierForm,
  setCashierForm,
  setUserMessage,
}: {
  selectedBranchId: string;
  cashierForm: CashierForm;
  setCashierForm: Dispatch<SetStateAction<CashierForm>>;
  setUserMessage: (message: string) => void;
}) {
  const queryClient = useQueryClient();

  const createCashier = useMutation({
    mutationFn: async () => {
      if (!selectedBranchId) {
        throw new Error("Select a branch first.");
      }
      const res = await api.users.create({
        body: {
          branchId: selectedBranchId,
          username: cashierForm.username.trim(),
          password: cashierForm.password,
          branchIds: cashierForm.branchIds,
          permissions: cashierForm.permissions
        },
        extraHeaders: authHeaders()
      });
      if (res.status !== 201) throw new Error("Failed to create cashier");
      return res.body;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["branch-users", selectedBranchId] });
      setCashierForm(emptyCashierForm(selectedBranchId));
      setUserMessage("Cashier account created.");
    },
    onError: (error) => {
      setUserMessage((error as Error).message);
    }
  });

  const updateUser = useMutation({
    mutationFn: async (payload: {
      id: string;
      username?: string;
      password?: string;
      mustChangePassword?: boolean;
      isActive?: boolean;
      permissions?: CashierPermission[];
    }) => {
      const res = await api.users.update({
        params: { id: payload.id },
        body: {
          username: payload.username,
          password: payload.password,
          mustChangePassword: payload.mustChangePassword,
          isActive: payload.isActive,
          permissions: payload.permissions
        },
        extraHeaders: authHeaders()
      });
      if (res.status !== 200) throw new Error(apiErrorMessage(res.body, "Failed to update user"));
      return res.body;
    },
    onSuccess: (updated, payload) => {
      queryClient.invalidateQueries({ queryKey: ["branch-users", selectedBranchId] });
      setUserMessage(
        payload.permissions !== undefined
          ? `What ${updated.username} may do is saved; it applies from their next action.`
          : payload.password === undefined
          ? "User updated."
          : updated.mustChangePassword
            ? `New password set. ${updated.username} is signed out everywhere and chooses their own password at next sign-in.`
            : `New password set. ${updated.username} is signed out everywhere.`
      );
    },
    onError: (error) => {
      setUserMessage((error as Error).message);
    }
  });

  const grantBranchAccess = useMutation({
    mutationFn: async (payload: { id: string; branchId: string }) => {
      const res = await api.users.grantBranchAccess({
        params: { id: payload.id, branchId: payload.branchId },
        extraHeaders: authHeaders()
      });
      if (res.status !== 204) throw new Error("Failed to add branch access");
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["branch-users", selectedBranchId] });
    },
    onError: (error) => {
      setUserMessage((error as Error).message);
    }
  });

  const revokeBranchAccess = useMutation({
    mutationFn: async (payload: { id: string; branchId: string }) => {
      const res = await api.users.revokeBranchAccess({
        params: { id: payload.id, branchId: payload.branchId },
        extraHeaders: authHeaders()
      });
      if (res.status !== 204) throw new Error("Failed to remove branch access");
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["branch-users", selectedBranchId] });
    },
    onError: (error) => {
      setUserMessage((error as Error).message);
    }
  });

  return { createCashier, updateUser, grantBranchAccess, revokeBranchAccess };
}

export type CashierMutations = ReturnType<typeof useCashierMutations>;
