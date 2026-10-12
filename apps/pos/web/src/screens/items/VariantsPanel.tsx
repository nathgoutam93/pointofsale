import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { FormEvent, useState } from "react";
import { api, apiErrorMessage, authHeaders } from "../../lib/api";
import { inr } from "../route-helpers";

type Group = { id: string; name: string; option1Name: string; option2Name: string | null };
const splitValues = (text: string) => [...new Set(text.split(",").map((value) => value.trim()).filter(Boolean))];

/** A variant's product: its other sizes/colours, and (item managers) adding values or pricing them all. */
export function VariantsPanel({ group, itemId, canManage, onSelect }: { group: Group; itemId: string; canManage: boolean; onSelect: (itemId: string) => void }) {
  const queryClient = useQueryClient();
  const [values1, setValues1] = useState("");
  const [values2, setValues2] = useState("");
  const [price, setPrice] = useState("");
  const [mrp, setMrp] = useState("");
  const [message, setMessage] = useState("");

  const groups = useQuery({
    queryKey: ["item-groups"],
    queryFn: async () => {
      const res = await api.itemGroups.list({ extraHeaders: authHeaders() });
      if (res.status !== 200) throw new Error("Couldn't load the product");
      return res.body;
    },
  });
  const detail = groups.data?.find((entry) => entry.id === group.id);
  const refresh = () => Promise.all(["items-module", "items-pos", "items-stock-list", "item-groups"].map((key) => queryClient.invalidateQueries({ queryKey: [key] })));

  const add = useMutation({
    mutationFn: async () => {
      const option1Values = splitValues(values1);
      const option2Values = splitValues(values2);
      const res = await api.itemGroups.addValues({
        params: { id: group.id },
        body: { ...(option1Values.length ? { option1Values } : {}), ...(option2Values.length ? { option2Values } : {}) },
        extraHeaders: authHeaders(),
      });
      if (res.status !== 200) throw new Error(apiErrorMessage(res.body, "The values couldn't be added."));
      return res.body.items.length - (detail?.items.length ?? 0);
    },
    onSuccess: async (added) => {
      setValues1("");
      setValues2("");
      setMessage(`${added} new ${added === 1 ? "item" : "items"} added.`);
      await refresh();
    },
  });
  const priceAll = useMutation({
    mutationFn: async () => {
      const res = await api.itemGroups.setPrices({ params: { id: group.id }, body: { sellPrice: Number(price), ...(mrp.trim() ? { mrp: Number(mrp) } : {}) }, extraHeaders: authHeaders() });
      if (res.status !== 200) throw new Error(apiErrorMessage(res.body, "The prices couldn't be changed."));
    },
    onSuccess: async () => {
      setPrice("");
      setMrp("");
      setMessage("Every variant has the new price.");
      await refresh();
    },
  });

  return (
    <div className="mt-6 rounded-lg border border-slate-200 p-4">
      <h4 className="text-sm font-semibold text-slate-900">
        Variant of {group.name} <span className="font-normal text-slate-500">· by {group.option2Name ? `${group.option1Name.toLowerCase()} and ${group.option2Name.toLowerCase()}` : group.option1Name.toLowerCase()}</span>
      </h4>
      <div className="mt-3 flex flex-wrap gap-1.5">
        {(detail?.items ?? []).map((variant) => (
          <button
            key={variant.id}
            type="button"
            className={`rounded-md border px-2 py-1 text-xs ${variant.id === itemId ? "border-brand-500 bg-brand-50 font-semibold text-brand-800" : "border-slate-200 text-slate-700 hover:border-slate-300"}`}
            onClick={() => onSelect(variant.id)}
          >
            {variant.option1}
            {variant.option2 ? ` / ${variant.option2}` : ""} · {inr(variant.sellPrice)}
          </button>
        ))}
      </div>
      {canManage ? (
        <div className="mt-4 grid gap-3 lg:grid-cols-2">
          <form
            className="grid gap-2 rounded-md bg-slate-50 p-3"
            onSubmit={(e: FormEvent) => {
              e.preventDefault();
              setMessage("");
              add.mutate();
            }}
          >
            <p className="text-xs font-semibold text-slate-700">Add {group.option2Name ? "sizes or colours" : `${group.option1Name.toLowerCase()}s`}</p>
            <input className="field py-1" placeholder={`New ${group.option1Name.toLowerCase()}s, e.g. XL, XXL`} aria-label={`New ${group.option1Name} values`} value={values1} onChange={(e) => setValues1(e.target.value)} />
            {group.option2Name ? (
              <input className="field py-1" placeholder={`New ${group.option2Name.toLowerCase()}s`} aria-label={`New ${group.option2Name} values`} value={values2} onChange={(e) => setValues2(e.target.value)} />
            ) : null}
            <button className="btn-secondary py-1" type="submit" disabled={add.isPending || (!values1.trim() && !values2.trim())}>Add</button>
          </form>
          <form
            className="grid gap-2 rounded-md bg-slate-50 p-3"
            onSubmit={(e: FormEvent) => {
              e.preventDefault();
              setMessage("");
              priceAll.mutate();
            }}
          >
            <p className="text-xs font-semibold text-slate-700">One price for every variant</p>
            <div className="grid grid-cols-2 gap-2">
              <input className="field py-1" type="number" min="0" step="0.01" placeholder="Price" aria-label="Price for every variant" value={price} onChange={(e) => setPrice(e.target.value)} required />
              <input className="field py-1" type="number" min="0" step="0.01" placeholder="MRP (optional)" aria-label="MRP for every variant" value={mrp} onChange={(e) => setMrp(e.target.value)} />
            </div>
            <button className="btn-secondary py-1" type="submit" disabled={priceAll.isPending}>Set Price</button>
          </form>
        </div>
      ) : null}
      {add.error || priceAll.error ? <p className="mt-2 text-sm text-rose-700">{((add.error ?? priceAll.error) as Error).message}</p> : null}
      {message ? <p className="mt-2 text-sm text-emerald-700" role="status">{message}</p> : null}
    </div>
  );
}
