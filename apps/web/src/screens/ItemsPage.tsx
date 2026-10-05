import { useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { api, authHeaders } from "../lib/api";
import { mrpProblem } from "@pos/contracts";
import { can } from "../lib/session";
import { requireSession } from "./route-helpers";
import { CreateItemForm } from "./items/CreateItemForm";
import { EditItemForm } from "./items/EditItemForm";
import { ItemDetails } from "./items/ItemDetails";
import { initialForm, type SaleUomFormState } from "./items/itemForm";
import { ItemList } from "./items/ItemList";
import { useItemMutations } from "./items/useItemMutations";

export function ItemsPage() {
  const session = requireSession();
  // Adding, editing and deleting items: admins, and cashiers allowed to.
  const canManageItems = can(session, "MANAGE_ITEMS");
  const [form, setForm] = useState(initialForm);
  const [saleUomRows, setSaleUomRows] = useState<SaleUomFormState[]>([]);
  // Barcodes scanned for the item besides its code; a unit when one sells a box.
  const [barcodeRows, setBarcodeRows] = useState<Array<{ barcode: string; saleUom: string }>>([]);
  const barcodeBody = () =>
    barcodeRows
      .filter((row) => row.barcode.trim())
      .map((row) => ({ barcode: row.barcode.trim(), saleUom: row.saleUom || null }));
  const [selectedItemId, setSelectedItemId] = useState<string | null>(null);
  const [panelMode, setPanelMode] = useState<"view" | "create" | "edit">(
    "view",
  );
  const [removeImageOnEdit, setRemoveImageOnEdit] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [imagePreviewUrl, setImagePreviewUrl] = useState<string | null>(null);

  const items = useQuery({
    queryKey: ["items-module"],
    queryFn: async () => {
      const res = await api.items.list({ query: { activeOnly: true }, extraHeaders: authHeaders() });
      if (res.status !== 200) throw new Error("Failed to fetch items");
      return res.body;
    },
  });
  const businessSettings = useQuery({
    queryKey: ["business-settings"],
    queryFn: async () => {
      const res = await api.business.get({ extraHeaders: authHeaders() });
      if (res.status !== 200) throw new Error("Failed to load business settings");
      return res.body;
    },
  });
  const hsnMinDigits = businessSettings.data?.hsnMinDigits ?? 4;
  // Prices may never be above the MRP, which includes GST (while the business charges it).
  const chargeTax = businessSettings.data?.taxpayerType !== "COMPOSITION";
  const formMrpProblem = mrpProblem(Number(form.sellPrice) || 0, Number(form.mrp) || 0, form.taxMode, Number(form.taxRate) || 0, chargeTax);
  const itemAboveMrp = (item: {
    sellPrice: number | string;
    mrp?: number | string;
    taxMode: "INCLUSIVE" | "EXCLUSIVE";
    taxRate: number | string;
    saleUoms?: Array<{ sellPrice: number | string; mrp: number | string; isDefault?: boolean }>;
  }) =>
    [{ sellPrice: item.sellPrice, mrp: item.mrp ?? 0 }, ...(item.saleUoms ?? []).filter((unit) => !unit.isDefault)].some(
      (unit) => !!mrpProblem(Number(unit.sellPrice), Number(unit.mrp), item.taxMode, Number(item.taxRate), chargeTax),
    );

  const selectedItem = useMemo(
    () => items.data?.find((item) => item.id === selectedItemId) ?? null,
    [items.data, selectedItemId],
  );
  // The units the selected item is sold in, base unit first, for its branch prices.
  const selectedItemUnits = useMemo(() => {
    if (!selectedItem) return null;
    const saleUnits = selectedItem.saleUoms ?? [];
    return saleUnits.some((unit) => unit.isDefault)
      ? saleUnits
      : [{ uom: selectedItem.uom, sellPrice: selectedItem.sellPrice, mrp: selectedItem.mrp }, ...saleUnits];
  }, [selectedItem]);

  const filteredItems = useMemo(() => {
    if (!items.data) return [];
    const query = searchQuery.trim().toLowerCase();
    if (!query) return items.data;
    return items.data.filter((item) => {
      const haystack = [
        item.name,
        item.code,
        item.category ?? "",
        item.uom,
        ...(item.saleUoms ?? []).map((variant) => variant.uom),
      ]
        .join(" ")
        .toLowerCase();
      return haystack.includes(query);
    });
  }, [items.data, searchQuery]);

  useEffect(() => {
    if (!filteredItems.length) {
      setSelectedItemId(null);
      return;
    }

    if (
      !selectedItemId ||
      !filteredItems.some((item) => item.id === selectedItemId)
    ) {
      setSelectedItemId(filteredItems[0].id);
    }
  }, [filteredItems, selectedItemId]);

  useEffect(() => {
    if (!form.imageFile) {
      setImagePreviewUrl(null);
      return;
    }

    const previewUrl = URL.createObjectURL(form.imageFile);
    setImagePreviewUrl(previewUrl);
    return () => URL.revokeObjectURL(previewUrl);
  }, [form.imageFile]);

  const { createItem, updateItem, deleteItem, hasMutationError, resetMutationErrors, mutationErrorMessage } =
    useItemMutations({
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
    });

  return (
    <section className="grid grid-cols-1 xl:h-[calc(100vh-48px)] xl:grid-cols-[390px_1fr]">
      <ItemList
        canManageItems={canManageItems}
        items={items}
        filteredItems={filteredItems}
        searchQuery={searchQuery}
        setSearchQuery={setSearchQuery}
        selectedItemId={selectedItemId}
        setSelectedItemId={setSelectedItemId}
        panelMode={panelMode}
        setPanelMode={setPanelMode}
        setForm={setForm}
        setSaleUomRows={setSaleUomRows}
        setBarcodeRows={setBarcodeRows}
        setRemoveImageOnEdit={setRemoveImageOnEdit}
        resetMutationErrors={resetMutationErrors}
        itemAboveMrp={itemAboveMrp}
      />

      <div className="overflow-y-auto bg-slate-100 p-6">
      <div className="card mx-auto max-w-5xl p-5">
        {panelMode === "create" ? (
          <CreateItemForm
            form={form}
            setForm={setForm}
            saleUomRows={saleUomRows}
            setSaleUomRows={setSaleUomRows}
            barcodeRows={barcodeRows}
            setBarcodeRows={setBarcodeRows}
            setPanelMode={setPanelMode}
            formMrpProblem={formMrpProblem}
            hsnMinDigits={hsnMinDigits}
            createItem={createItem}
            resetMutationErrors={resetMutationErrors}
          />
        ) : panelMode === "edit" && selectedItem ? (
          <EditItemForm
            selectedItem={selectedItem}
            form={form}
            setForm={setForm}
            saleUomRows={saleUomRows}
            setSaleUomRows={setSaleUomRows}
            barcodeRows={barcodeRows}
            setBarcodeRows={setBarcodeRows}
            setPanelMode={setPanelMode}
            removeImageOnEdit={removeImageOnEdit}
            setRemoveImageOnEdit={setRemoveImageOnEdit}
            imagePreviewUrl={imagePreviewUrl}
            formMrpProblem={formMrpProblem}
            hsnMinDigits={hsnMinDigits}
            updateItem={updateItem}
            resetMutationErrors={resetMutationErrors}
          />
        ) : selectedItem ? (
          <ItemDetails
            session={session}
            canManageItems={canManageItems}
            selectedItem={selectedItem}
            selectedItemUnits={selectedItemUnits}
            setForm={setForm}
            setSaleUomRows={setSaleUomRows}
            setBarcodeRows={setBarcodeRows}
            setPanelMode={setPanelMode}
            setRemoveImageOnEdit={setRemoveImageOnEdit}
            deleteItem={deleteItem}
            resetMutationErrors={resetMutationErrors}
          />
        ) : (
          <div className="py-12 text-center">
            <p className="text-sm font-medium text-slate-600">No item selected</p>
            <p className="mt-1 text-xs text-slate-500">Select an item from the left to view details.</p>
          </div>
        )}

        {hasMutationError && (
          <p className="mt-4 rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700" role="alert">
            {mutationErrorMessage}
          </p>
        )}
      </div>
      </div>
    </section>
  );
}
