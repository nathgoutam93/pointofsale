import { useMutation, useQueryClient } from "@tanstack/react-query";
import { gstinProblem } from "@pos/contracts";
import { FormEvent, useState } from "react";
import { api, apiErrorMessage, authHeaders } from "../../lib/api";
import type { Supplier } from "./useSuppliers";

type Form = { name: string; gstin: string; phone: string; email: string; address: string; paymentTermsDays: string; isActive: boolean };

const formOf = (supplier: Supplier | null): Form => ({
  name: supplier?.name ?? "",
  gstin: supplier?.gstin ?? "",
  phone: supplier?.phone ?? "",
  email: supplier?.email ?? "",
  address: supplier?.address ?? "",
  paymentTermsDays: supplier?.paymentTermsDays === null || supplier?.paymentTermsDays === undefined ? "" : String(supplier.paymentTermsDays),
  isActive: supplier?.isActive ?? true,
});

/** A new supplier, or changes to one (`supplier`). */
export function SupplierForm({ supplier, onSaved, onCancel }: { supplier: Supplier | null; onSaved: (saved: Supplier) => void; onCancel?: () => void }) {
  const queryClient = useQueryClient();
  const [form, setForm] = useState<Form>(() => formOf(supplier));
  const [error, setError] = useState("");
  const gstin = form.gstin.trim().toUpperCase();

  const save = useMutation({
    mutationFn: async () => {
      const body = {
        name: form.name.trim(),
        gstin: gstin || null,
        phone: form.phone.trim() || null,
        email: form.email.trim() || null,
        address: form.address.trim() || null,
        paymentTermsDays: form.paymentTermsDays.trim() === "" ? null : Number(form.paymentTermsDays),
      };
      const res = supplier
        ? await api.suppliers.update({ params: { id: supplier.id }, body: { ...body, isActive: form.isActive }, extraHeaders: authHeaders() })
        : await api.suppliers.create({ body, extraHeaders: authHeaders() });
      if (res.status !== 200 && res.status !== 201) throw new Error(apiErrorMessage(res.body, "Failed to save the supplier"));
      return res.body as Supplier;
    },
    onSuccess: (saved) => {
      setError("");
      void queryClient.invalidateQueries({ queryKey: ["suppliers"] });
      void queryClient.invalidateQueries({ queryKey: ["supplier-account", saved.id] });
      onSaved(saved);
    },
    onError: (e) => setError((e as Error).message),
  });

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (!form.name.trim()) return setError("Enter the supplier's name");
    if (gstin && gstinProblem(gstin)) return setError(gstinProblem(gstin) ?? "");
    save.mutate();
  };
  const field = (key: keyof Omit<Form, "isActive">) => ({
    value: form[key],
    onChange: (e: { target: { value: string } }) => setForm((current) => ({ ...current, [key]: e.target.value })),
  });

  return (
    <form onSubmit={onSubmit} className="space-y-3">
      <div className="grid gap-3 md:grid-cols-2">
        <label className="block text-sm text-slate-600">
          Name
          <input className="field mt-1" maxLength={120} required {...field("name")} />
        </label>
        <label className="block text-sm text-slate-600">
          GSTIN <span className="text-slate-400">(optional)</span>
          <input className="field mt-1 uppercase" maxLength={15} {...field("gstin")} />
        </label>
        <label className="block text-sm text-slate-600">
          Phone <span className="text-slate-400">(optional)</span>
          <input className="field mt-1" maxLength={20} {...field("phone")} />
        </label>
        <label className="block text-sm text-slate-600">
          Email <span className="text-slate-400">(optional)</span>
          <input className="field mt-1" type="email" maxLength={254} {...field("email")} />
        </label>
        <label className="block text-sm text-slate-600 md:col-span-2">
          Address <span className="text-slate-400">(optional)</span>
          <input className="field mt-1" maxLength={500} {...field("address")} />
        </label>
        <label className="block text-sm text-slate-600">
          Payment terms (days) <span className="text-slate-400">(blank: due at once)</span>
          <input className="field mt-1" type="number" min="0" max="365" step="1" {...field("paymentTermsDays")} />
        </label>
        {supplier ? (
          <label className="flex items-center gap-2 self-end pb-2 text-sm text-slate-600">
            <input type="checkbox" checked={form.isActive} onChange={(e) => setForm((current) => ({ ...current, isActive: e.target.checked }))} />
            In use (shown when recording purchases)
          </label>
        ) : null}
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <button className="btn-primary" type="submit" disabled={save.isPending}>
          {save.isPending ? "Saving..." : supplier ? "Save Changes" : "Add Supplier"}
        </button>
        {onCancel ? (
          <button type="button" className="btn-ghost" onClick={onCancel}>
            Cancel
          </button>
        ) : null}
        {error ? (
          <span className="text-sm text-rose-700" role="alert">
            {error}
          </span>
        ) : null}
      </div>
    </form>
  );
}
