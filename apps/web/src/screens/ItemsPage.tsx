import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { API_BASE_URL, api, authHeaders } from "../lib/api";
import { requireSession } from "./route-helpers";

type ItemFormState = {
  code: string;
  name: string;
  category: string;
  uom: string;
  costPrice: string;
  sellPrice: string;
  taxMode: "INCLUSIVE" | "EXCLUSIVE";
  taxRate: string;
  imageFile: File | null;
};

const initialForm: ItemFormState = {
  code: "",
  name: "",
  category: "",
  uom: "PCS",
  costPrice: "0",
  sellPrice: "0",
  taxMode: "EXCLUSIVE",
  taxRate: "0",
  imageFile: null,
};

function money(value: number | string) {
  const num = Number(value) || 0;
  return new Intl.NumberFormat("en-IN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(num);
}

export function ItemsPage() {
  requireSession();
  const queryClient = useQueryClient();
  const normalizedApiBaseUrl = API_BASE_URL.replace(/\/$/, "");
  const [form, setForm] = useState(initialForm);
  const [selectedItemId, setSelectedItemId] = useState<string | null>(null);
  const [panelMode, setPanelMode] = useState<"view" | "create" | "edit">(
    "view",
  );
  const [removeImageOnEdit, setRemoveImageOnEdit] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");

  const items = useQuery({
    queryKey: ["items-module"],
    queryFn: async () => {
      const res = await api.items.list({ query: { activeOnly: true } });
      if (res.status !== 200) throw new Error("Failed to fetch items");
      return res.body;
    },
  });

  const selectedItem = useMemo(
    () => items.data?.find((item) => item.id === selectedItemId) ?? null,
    [items.data, selectedItemId],
  );

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

  const uploadImage = async (file: File) => {
    const body = new FormData();
    body.append("file", file);
    const uploadRes = await fetch(
      `${normalizedApiBaseUrl}/items/upload-image`,
      {
        method: "POST",
        headers: authHeaders(),
        body,
      },
    );
    if (!uploadRes.ok) throw new Error("Failed to upload image");
    const uploadBody = (await uploadRes.json()) as { path?: string };
    if (!uploadBody.path) throw new Error("Invalid image upload response");
    return `${normalizedApiBaseUrl}${uploadBody.path.startsWith("/") ? "" : "/"}${uploadBody.path}`;
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
          costPrice: Number(form.costPrice),
          sellPrice: Number(form.sellPrice),
          taxMode: form.taxMode,
          taxRate: Number(form.taxRate),
          imageUrl,
        },
        extraHeaders: authHeaders(),
      });
      if (res.status !== 201) throw new Error("Failed to create item");
      return res.body;
    },
    onSuccess: (createdItem) => {
      queryClient.invalidateQueries({ queryKey: ["items-module"] });
      setForm(initialForm);
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
          costPrice: Number(form.costPrice),
          sellPrice: Number(form.sellPrice),
          taxMode: form.taxMode,
          taxRate: Number(form.taxRate),
          imageUrl,
        },
        extraHeaders: authHeaders(),
      });
      if (res.status !== 200) throw new Error("Failed to update item");
      return res.body;
    },
    onSuccess: (updatedItem) => {
      queryClient.invalidateQueries({ queryKey: ["items-module"] });
      setPanelMode("view");
      setRemoveImageOnEdit(false);
      setForm(initialForm);
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
        throw new Error("Failed to delete item");
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

  return (
    <section className="grid h-[calc(100vh-48px)] grid-cols-1 xl:grid-cols-[390px_1fr]">
      <aside className="flex flex-col border-r border-slate-200 bg-white p-3">
        <div className="mb-3 flex items-center justify-between gap-2">
          <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-600">
            Items List
          </h3>
          <button
            className="rounded-lg bg-teal-700 px-3 py-2 text-sm font-semibold text-white"
            type="button"
            onClick={() => {
              setForm(initialForm);
              setPanelMode("create");
              setRemoveImageOnEdit(false);
            }}
          >
            New Item
          </button>
        </div>
        <input
          className="mb-3 rounded-lg border border-slate-300 px-3 py-2 text-sm"
          placeholder="Search by name, code, category, or UOM"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
        />

        {items.isLoading && (
          <p className="px-2 py-3 text-sm text-slate-500">Loading items...</p>
        )}
        {items.isError && (
          <p className="px-2 py-3 text-sm text-rose-600">
            Could not load items.
          </p>
        )}

        <div className="space-y-2 flex-1 overflow-y-scroll">
          {filteredItems.map((item) => {
            const isSelected =
              selectedItemId === item.id && panelMode !== "create";
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => {
                  setSelectedItemId(item.id);
                  setPanelMode("view");
                  setRemoveImageOnEdit(false);
                }}
                className={`w-full rounded-lg border px-3 py-2 text-left transition ${
                  isSelected
                    ? "border-teal-600 bg-teal-50"
                    : "border-slate-200 bg-white hover:border-slate-300"
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <p className="font-semibold text-slate-900">{item.name}</p>
                  <span className="rounded-md bg-slate-100 px-2 py-0.5 text-xs text-slate-700">
                    {item.taxMode}
                  </span>
                </div>
                <p className="text-xs text-slate-500">{item.code}</p>
                <p className="text-sm text-slate-700">
                  Sell: Rs {money(item.sellPrice)}
                </p>
              </button>
            );
          })}
        </div>

        {!items.isLoading && !items.data?.length && (
          <p className="px-2 py-3 text-sm text-slate-500">
            No active items found.
          </p>
        )}
        {!items.isLoading &&
          !!items.data?.length &&
          !filteredItems.length && (
            <p className="px-2 py-3 text-sm text-slate-500">
              No items match your search.
            </p>
          )}
      </aside>

      <div className="rounded-xl border border-slate-200 p-4">
        {panelMode === "create" ? (
          <>
            <div className="mb-3 flex items-center justify-between">
              <h3 className="text-lg font-semibold">Create Item</h3>
              <button
                className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
                type="button"
                onClick={() => setPanelMode("view")}
              >
                Cancel
              </button>
            </div>
            <form
              className="grid grid-cols-1 gap-2 md:grid-cols-2"
              onSubmit={(e) => {
                e.preventDefault();
                createItem.mutate();
              }}
            >
              <input
                className="rounded-lg border border-slate-300 px-3 py-2 md:col-span-2"
                type="file"
                accept="image/*"
                onChange={(e) =>
                  setForm((s) => ({
                    ...s,
                    imageFile: e.target.files?.[0] ?? null,
                  }))
                }
              />
              {form.imageFile && (
                <p className="text-xs text-slate-600 md:col-span-2">
                  Selected image: {form.imageFile.name}
                </p>
              )}
              <input
                className="rounded-lg border border-slate-300 px-3 py-2"
                placeholder="Code"
                value={form.code}
                onChange={(e) =>
                  setForm((s) => ({ ...s, code: e.target.value }))
                }
                required
              />
              <input
                className="rounded-lg border border-slate-300 px-3 py-2"
                placeholder="Name"
                value={form.name}
                onChange={(e) =>
                  setForm((s) => ({ ...s, name: e.target.value }))
                }
                required
              />
              <input
                className="rounded-lg border border-slate-300 px-3 py-2"
                placeholder="Category"
                value={form.category}
                onChange={(e) =>
                  setForm((s) => ({ ...s, category: e.target.value }))
                }
              />
              <input
                className="rounded-lg border border-slate-300 px-3 py-2"
                placeholder="UOM"
                value={form.uom}
                onChange={(e) =>
                  setForm((s) => ({ ...s, uom: e.target.value }))
                }
              />
              <input
                className="rounded-lg border border-slate-300 px-3 py-2"
                placeholder="Cost"
                type="number"
                step="0.01"
                min="0"
                value={form.costPrice}
                onChange={(e) =>
                  setForm((s) => ({ ...s, costPrice: e.target.value }))
                }
              />
              <input
                className="rounded-lg border border-slate-300 px-3 py-2"
                placeholder="Sell Price"
                type="number"
                step="0.01"
                min="0"
                value={form.sellPrice}
                onChange={(e) =>
                  setForm((s) => ({ ...s, sellPrice: e.target.value }))
                }
              />
              <select
                className="rounded-lg border border-slate-300 px-3 py-2"
                value={form.taxMode}
                onChange={(e) =>
                  setForm((s) => ({
                    ...s,
                    taxMode: e.target.value as "INCLUSIVE" | "EXCLUSIVE",
                  }))
                }
              >
                <option value="EXCLUSIVE">Tax Exclusive</option>
                <option value="INCLUSIVE">Tax Inclusive</option>
              </select>
              <input
                className="rounded-lg border border-slate-300 px-3 py-2"
                placeholder="Tax %"
                type="number"
                step="0.01"
                min="0"
                value={form.taxRate}
                onChange={(e) =>
                  setForm((s) => ({ ...s, taxRate: e.target.value }))
                }
              />

              <button
                className="rounded-lg bg-teal-700 px-3 py-2 font-semibold text-white md:col-span-2"
                type="submit"
                disabled={createItem.isPending}
              >
                {createItem.isPending ? "Creating..." : "Create Item"}
              </button>
            </form>
          </>
        ) : panelMode === "edit" && selectedItem ? (
          <>
            <div className="mb-3 flex items-center justify-between">
              <h3 className="text-lg font-semibold">Edit Item</h3>
              <button
                className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
                type="button"
                onClick={() => {
                  setPanelMode("view");
                  setRemoveImageOnEdit(false);
                  setForm(initialForm);
                }}
              >
                Cancel
              </button>
            </div>
            <form
              className="grid grid-cols-1 gap-2 md:grid-cols-2"
              onSubmit={(e) => {
                e.preventDefault();
                updateItem.mutate();
              }}
            >
              <input
                className="rounded-lg border border-slate-300 px-3 py-2 md:col-span-2"
                type="file"
                accept="image/*"
                onChange={(e) =>
                  setForm((s) => ({
                    ...s,
                    imageFile: e.target.files?.[0] ?? null,
                  }))
                }
              />
              <label className="flex items-center gap-2 text-sm text-slate-700 md:col-span-2">
                <input
                  type="checkbox"
                  checked={removeImageOnEdit}
                  onChange={(e) => setRemoveImageOnEdit(e.target.checked)}
                />
                Remove existing image
              </label>
              <input
                className="rounded-lg border border-slate-200 bg-slate-100 px-3 py-2 text-slate-600"
                value={selectedItem.code}
                disabled
              />
              <input
                className="rounded-lg border border-slate-300 px-3 py-2"
                placeholder="Name"
                value={form.name}
                onChange={(e) =>
                  setForm((s) => ({ ...s, name: e.target.value }))
                }
                required
              />
              <input
                className="rounded-lg border border-slate-300 px-3 py-2"
                placeholder="Category"
                value={form.category}
                onChange={(e) =>
                  setForm((s) => ({ ...s, category: e.target.value }))
                }
              />
              <input
                className="rounded-lg border border-slate-300 px-3 py-2"
                placeholder="UOM"
                value={form.uom}
                onChange={(e) =>
                  setForm((s) => ({ ...s, uom: e.target.value }))
                }
              />
              <input
                className="rounded-lg border border-slate-300 px-3 py-2"
                placeholder="Cost"
                type="number"
                step="0.01"
                min="0"
                value={form.costPrice}
                onChange={(e) =>
                  setForm((s) => ({ ...s, costPrice: e.target.value }))
                }
              />
              <input
                className="rounded-lg border border-slate-300 px-3 py-2"
                placeholder="Sell Price"
                type="number"
                step="0.01"
                min="0"
                value={form.sellPrice}
                onChange={(e) =>
                  setForm((s) => ({ ...s, sellPrice: e.target.value }))
                }
              />
              <select
                className="rounded-lg border border-slate-300 px-3 py-2"
                value={form.taxMode}
                onChange={(e) =>
                  setForm((s) => ({
                    ...s,
                    taxMode: e.target.value as "INCLUSIVE" | "EXCLUSIVE",
                  }))
                }
              >
                <option value="EXCLUSIVE">Tax Exclusive</option>
                <option value="INCLUSIVE">Tax Inclusive</option>
              </select>
              <input
                className="rounded-lg border border-slate-300 px-3 py-2"
                placeholder="Tax %"
                type="number"
                step="0.01"
                min="0"
                value={form.taxRate}
                onChange={(e) =>
                  setForm((s) => ({ ...s, taxRate: e.target.value }))
                }
              />

              <button
                className="rounded-lg bg-teal-700 px-3 py-2 font-semibold text-white md:col-span-2"
                type="submit"
                disabled={updateItem.isPending}
              >
                {updateItem.isPending ? "Saving..." : "Save Changes"}
              </button>
            </form>
          </>
        ) : selectedItem ? (
          <>
            <div className="mb-3 flex items-center justify-between gap-2">
              <h3 className="text-lg font-semibold">Item Details</h3>
              <div className="flex items-center gap-2">
                <button
                  className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
                  type="button"
                  onClick={() => {
                    setForm({
                      code: selectedItem.code,
                      name: selectedItem.name,
                      category: selectedItem.category || "",
                      uom: selectedItem.uom,
                      costPrice: String(selectedItem.costPrice),
                      sellPrice: String(selectedItem.sellPrice),
                      taxMode: selectedItem.taxMode,
                      taxRate: String(selectedItem.taxRate),
                      imageFile: null,
                    });
                    setRemoveImageOnEdit(false);
                    setPanelMode("edit");
                  }}
                >
                  Edit
                </button>
                <button
                  className="rounded-lg border border-rose-300 px-3 py-2 text-sm text-rose-700"
                  type="button"
                  onClick={() => {
                    if (
                      !window.confirm(
                        "Delete this item? This only works if the item has no sales.",
                      )
                    )
                      return;
                    deleteItem.mutate();
                  }}
                  disabled={deleteItem.isPending}
                >
                  {deleteItem.isPending ? "Deleting..." : "Delete"}
                </button>
              </div>
            </div>
            <div className="mt-3 grid grid-cols-1 gap-4 md:grid-cols-[220px_minmax(0,1fr)]">
              <div className="overflow-hidden rounded-lg border border-slate-200 bg-slate-50">
                {selectedItem.imageUrl ? (
                  <img
                    src={selectedItem.imageUrl}
                    alt={selectedItem.name}
                    className="h-52 w-full object-scale-down"
                  />
                ) : (
                  <div className="flex h-52 items-center justify-center text-sm text-slate-500">
                    No image
                  </div>
                )}
              </div>
              <dl className="grid grid-cols-1 gap-2 text-sm md:grid-cols-2">
                <div>
                  <dt className="text-slate-500">Code</dt>
                  <dd className="font-medium text-slate-900">
                    {selectedItem.code}
                  </dd>
                </div>
                <div>
                  <dt className="text-slate-500">Name</dt>
                  <dd className="font-medium text-slate-900">
                    {selectedItem.name}
                  </dd>
                </div>
                <div>
                  <dt className="text-slate-500">Category</dt>
                  <dd className="font-medium text-slate-900">
                    {selectedItem.category || "Uncategorized"}
                  </dd>
                </div>
                <div>
                  <dt className="text-slate-500">UOM</dt>
                  <dd className="font-medium text-slate-900">
                    {selectedItem.uom}
                  </dd>
                </div>
                <div>
                  <dt className="text-slate-500">Cost</dt>
                  <dd className="font-medium text-slate-900">
                    Rs {money(selectedItem.costPrice)}
                  </dd>
                </div>
                <div>
                  <dt className="text-slate-500">Sell Price</dt>
                  <dd className="font-medium text-slate-900">
                    Rs {money(selectedItem.sellPrice)}
                  </dd>
                </div>
                <div>
                  <dt className="text-slate-500">Tax Mode</dt>
                  <dd className="font-medium text-slate-900">
                    {selectedItem.taxMode}
                  </dd>
                </div>
                <div>
                  <dt className="text-slate-500">Tax %</dt>
                  <dd className="font-medium text-slate-900">
                    {selectedItem.taxRate}%
                  </dd>
                </div>
              </dl>
            </div>
          </>
        ) : (
          <p className="text-sm text-slate-500">
            Select an item from the left to view details.
          </p>
        )}

        {hasMutationError && (
          <p className="mt-3 text-sm text-rose-600">
            Action failed. Delete is blocked when the item has sales history.
          </p>
        )}
      </div>
    </section>
  );
}
