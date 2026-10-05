import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { Dispatch, SetStateAction } from "react";
import { api, apiErrorMessage, apiFetch, authHeaders } from "../../lib/api";
import { canSeeCosts, getSession } from "../../lib/session";
import { effectiveSupplyType, effectiveUqc } from "./GstItemFields";
import { initialForm, normalizeSaleUomRows, type Item, type ItemFormState, type SaleUomFormState } from "./itemForm";

/** Creating, updating and deleting an item from the form, and the error the last attempt left. */
export function useItemMutations({
  form,
  setForm,
  saleUomRows,
  setSaleUomRows,
  setBarcodeRows,
  barcodeBody,
  selectedItem,
  setSelectedItemId,
  setPanelMode,
  removeImageOnEdit,
  setRemoveImageOnEdit,
}: {
  form: ItemFormState;
  setForm: Dispatch<SetStateAction<ItemFormState>>;
  saleUomRows: SaleUomFormState[];
  setSaleUomRows: Dispatch<SetStateAction<SaleUomFormState[]>>;
  setBarcodeRows: Dispatch<SetStateAction<Array<{ barcode: string; saleUom: string }>>>;
  barcodeBody: () => Array<{ barcode: string; saleUom: string | null }>;
  selectedItem: Item | null;
  setSelectedItemId: (id: string | null) => void;
  setPanelMode: (mode: "view" | "create" | "edit") => void;
  removeImageOnEdit: boolean;
  setRemoveImageOnEdit: (remove: boolean) => void;
}) {
  const queryClient = useQueryClient();

  const uploadImage = async (file: File) => {
    const body = new FormData();
    body.append("file", file);
    const uploadRes = await apiFetch("/items/upload-image", { method: "POST", body });
    if (!uploadRes.ok) throw new Error("Failed to upload image");
    const uploadBody = (await uploadRes.json()) as { path?: string };
    if (!uploadBody.path) throw new Error("Invalid image upload response");
    // Kept as /uploads/…, shown through uploadSrc: the API's address differs by computer.
    return uploadBody.path.startsWith("/") ? uploadBody.path : `/${uploadBody.path}`;
  };

  const createItem = useMutation({
    mutationFn: async () => {
      let imageUrl: string | undefined;
      if (form.imageFile) imageUrl = await uploadImage(form.imageFile);

      const res = await api.items.create({
        body: {
          code: form.code,
          name: form.name,
          category: form.category || undefined,
          uom: form.uom,
          leastCount: Number(form.leastCount),
          // Only someone who may see costs sets one (the API ignores it from others).
          ...(canSeeCosts(getSession()) ? { costPrice: Number(form.costPrice) } : {}),
          sellPrice: Number(form.sellPrice),
          mrp: Number(form.mrp),
          saleUoms: normalizeSaleUomRows(saleUomRows, form.uom),
          barcodes: barcodeBody(),
          taxMode: form.taxMode,
          taxRate: Number(form.taxRate),
          hsnCode: form.gst.hsnCode.trim() || null,
          uqc: effectiveUqc(form.gst, form.uom),
          supplyType: effectiveSupplyType(form.gst, Number(form.taxRate)),
          tracksBatches: form.tracksBatches,
          imageUrl,
        } as Parameters<typeof api.items.create>[0]["body"],
        extraHeaders: authHeaders(),
      });
      if (res.status !== 201) {
        throw new Error(apiErrorMessage(res.body, "Failed to create item"));
      }
      return res.body;
    },
    onSuccess: (createdItem) => {
      // Put the new item in the list before selecting it; otherwise the list (not yet
      // refetched) doesn't have it and the selection falls back to another item.
      queryClient.setQueryData<typeof createdItem[]>(["items-module"], (current) => [
        createdItem,
        ...(current ?? []).filter((item) => item.id !== createdItem.id),
      ]);
      queryClient.invalidateQueries({ queryKey: ["items-module"] });
      setForm(initialForm);
      setSaleUomRows([]);
      setBarcodeRows([]);
      setPanelMode("view");
      setSelectedItemId(createdItem.id);
    },
  });

  const updateItem = useMutation({
    mutationFn: async () => {
      if (!selectedItem) throw new Error("No item selected");
      let imageUrl: string | null | undefined;
      if (removeImageOnEdit) {
        imageUrl = null;
      } else if (form.imageFile) {
        imageUrl = await uploadImage(form.imageFile);
      }

      const res = await api.items.update({
        params: { id: selectedItem.id },
        body: {
          name: form.name,
          category: form.category || null,
          uom: form.uom,
          leastCount: Number(form.leastCount),
          // Only someone who may see costs sets one (the API ignores it from others).
          ...(canSeeCosts(getSession()) ? { costPrice: Number(form.costPrice) } : {}),
          sellPrice: Number(form.sellPrice),
          mrp: Number(form.mrp),
          saleUoms: normalizeSaleUomRows(saleUomRows, form.uom),
          barcodes: barcodeBody(),
          taxMode: form.taxMode,
          taxRate: Number(form.taxRate),
          hsnCode: form.gst.hsnCode.trim() || null,
          uqc: effectiveUqc(form.gst, form.uom),
          supplyType: effectiveSupplyType(form.gst, Number(form.taxRate)),
          tracksBatches: form.tracksBatches,
          imageUrl,
        } as Parameters<typeof api.items.update>[0]["body"],
        extraHeaders: authHeaders(),
      });
      if (res.status !== 200) {
        throw new Error(apiErrorMessage(res.body, "Failed to update item"));
      }
      return res.body;
    },
    onSuccess: (updatedItem) => {
      queryClient.invalidateQueries({ queryKey: ["items-module"] });
      setPanelMode("view");
      setRemoveImageOnEdit(false);
      setForm(initialForm);
      setSaleUomRows([]);
      setBarcodeRows([]);
      setSelectedItemId(updatedItem.id);
    },
  });

  const deleteItem = useMutation({
    mutationFn: async () => {
      if (!selectedItem) throw new Error("No item selected");
      const res = await api.items.delete({
        params: { id: selectedItem.id },
        extraHeaders: authHeaders(),
      });
      if (res.status !== 200) {
        throw new Error(apiErrorMessage(res.body, "Failed to delete item"));
      }
      return res.body;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["items-module"] });
      setPanelMode("view");
      setSelectedItemId(null);
    },
  });

  const hasMutationError =
    createItem.isError || updateItem.isError || deleteItem.isError;

  const resetMutationErrors = () => {
    createItem.reset();
    updateItem.reset();
    deleteItem.reset();
  };

  const mutationErrorMessage =
    createItem.error instanceof Error
      ? createItem.error.message
      : updateItem.error instanceof Error
        ? updateItem.error.message
        : deleteItem.error instanceof Error
          ? deleteItem.error.message
          : "Action failed.";

  return { createItem, updateItem, deleteItem, hasMutationError, resetMutationErrors, mutationErrorMessage };
}

export type ItemMutations = ReturnType<typeof useItemMutations>;
