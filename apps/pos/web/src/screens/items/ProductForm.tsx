import { useMutation, useQueryClient } from "@tanstack/react-query";
import { FormEvent, useState } from "react";
import { api, apiErrorMessage, authHeaders } from "../../lib/api";
import { canSeeCosts, getSession } from "../../lib/session";

const splitValues = (text: string) => [...new Set(text.split(",").map((value) => value.trim()).filter(Boolean))];
const codePart = (value: string) => value.toUpperCase().replace(/[^A-Z0-9]+/g, "");

/**
 * A product sold in sizes and/or colours: one item is made for each combination of the values
 * (S, M, L × Red, Blue), each with its own code, stock and barcodes, all at the price given.
 */
export function ProductForm({ onDone, onCancel }: { onDone: (firstItemId: string | null) => void; onCancel: () => void }) {
  const queryClient = useQueryClient();
  const [name, setName] = useState("");
  const [codePrefix, setCodePrefix] = useState("");
  const [category, setCategory] = useState("");
  const [uom, setUom] = useState("PCS");
  const [option1Name, setOption1Name] = useState("Size");
  const [option1Values, setOption1Values] = useState("S, M, L, XL");
  const [option2Name, setOption2Name] = useState("Colour");
  const [option2Values, setOption2Values] = useState("");
  const [sellPrice, setSellPrice] = useState("");
  const [mrp, setMrp] = useState("");
  const [costPrice, setCostPrice] = useState("");
  const [taxMode, setTaxMode] = useState<"INCLUSIVE" | "EXCLUSIVE">("INCLUSIVE");
  const [taxRate, setTaxRate] = useState("5");
  const [hsnCode, setHsnCode] = useState("");
  const showCost = canSeeCosts(getSession());

  const values1 = splitValues(option1Values);
  const values2 = splitValues(option2Values);
  const second = option2Name.trim() !== "" && values2.length > 0;
  const count = values1.length * (second ? values2.length : 1);
  const sample = values1[0] ? [codePrefix.trim().toUpperCase() || "CODE", codePart(values1[0]), ...(second ? [codePart(values2[0])] : [])].join("-") : null;

  const save = useMutation({
    mutationFn: async () => {
      const res = await api.itemGroups.create({
        body: {
          name,
          codePrefix,
          category: category.trim() || undefined,
          uom,
          option1Name,
          option1Values: values1,
          ...(second ? { option2Name, option2Values: values2 } : {}),
          sellPrice: Number(sellPrice),
          mrp: mrp.trim() ? Number(mrp) : undefined,
          costPrice: showCost && costPrice.trim() ? Number(costPrice) : undefined,
          taxMode,
          taxRate: Number(taxRate),
          hsnCode: hsnCode.trim() || undefined,
        },
        extraHeaders: authHeaders(),
      });
      if (res.status !== 201) throw new Error(apiErrorMessage(res.body, "The product couldn't be saved."));
      return res.body;
    },
    onSuccess: async (group) => {
      await Promise.all(["items-module", "items-pos", "items-stock-list", "item-groups"].map((key) => queryClient.invalidateQueries({ queryKey: [key] })));
      onDone(group.items[0]?.id ?? null);
    },
  });

  return (
    <form
      className="grid gap-4"
      onSubmit={(e: FormEvent) => {
        e.preventDefault();
        save.mutate();
      }}
    >
      <div>
        <h3 className="text-lg font-semibold">New Product with Sizes / Colours</h3>
        <p className="text-sm text-slate-500">An item is made for each combination, with its own code, stock and barcodes. Change any one later like any item.</p>
      </div>
      <div className="grid gap-4 sm:grid-cols-3">
        <div className="sm:col-span-2">
          <label className="field-label" htmlFor="product-name">Product name</label>
          <input id="product-name" className="field h-10" maxLength={80} value={name} onChange={(e) => setName(e.target.value)} required autoFocus />
        </div>
        <div>
          <label className="field-label" htmlFor="product-prefix">Code prefix</label>
          <input id="product-prefix" className="field h-10 font-mono uppercase" maxLength={20} pattern="[A-Za-z0-9-]+" title="Letters, digits and dashes" value={codePrefix} onChange={(e) => setCodePrefix(e.target.value)} required />
        </div>
        <div>
          <label className="field-label" htmlFor="product-category">Category</label>
          <input id="product-category" className="field h-10" value={category} onChange={(e) => setCategory(e.target.value)} />
        </div>
        <div>
          <label className="field-label" htmlFor="product-uom">Unit</label>
          <input id="product-uom" className="field h-10" value={uom} onChange={(e) => setUom(e.target.value)} required />
        </div>
      </div>

      <div className="grid gap-4 rounded-md bg-slate-50 p-3 sm:grid-cols-[10rem_1fr]">
        <div>
          <label className="field-label" htmlFor="option1-name">First option</label>
          <input id="option1-name" className="field h-10" maxLength={20} value={option1Name} onChange={(e) => setOption1Name(e.target.value)} required />
        </div>
        <div>
          <label className="field-label" htmlFor="option1-values">Its values (comma-separated)</label>
          <input id="option1-values" className="field h-10" value={option1Values} onChange={(e) => setOption1Values(e.target.value)} required />
        </div>
        <div>
          <label className="field-label" htmlFor="option2-name">Second option (optional)</label>
          <input id="option2-name" className="field h-10" maxLength={20} value={option2Name} onChange={(e) => setOption2Name(e.target.value)} />
        </div>
        <div>
          <label className="field-label" htmlFor="option2-values">Its values (comma-separated)</label>
          <input id="option2-values" className="field h-10" placeholder="Red, Navy Blue, White" value={option2Values} onChange={(e) => setOption2Values(e.target.value)} />
        </div>
        <p className="text-xs text-slate-600 sm:col-span-2">
          {count} {count === 1 ? "item" : "items"}
          {sample ? <>, coded like <span className="font-mono">{sample}</span></> : null}
          {count > 200 ? <span className="text-rose-700"> (at most 200)</span> : null}
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <div>
          <label className="field-label" htmlFor="product-price">Selling price</label>
          <input id="product-price" className="field h-10" type="number" min="0" step="0.01" value={sellPrice} onChange={(e) => setSellPrice(e.target.value)} required />
        </div>
        <div>
          <label className="field-label" htmlFor="product-mrp">MRP</label>
          <input id="product-mrp" className="field h-10" type="number" min="0" step="0.01" value={mrp} onChange={(e) => setMrp(e.target.value)} />
        </div>
        {showCost ? (
          <div>
            <label className="field-label" htmlFor="product-cost">Cost price</label>
            <input id="product-cost" className="field h-10" type="number" min="0" step="0.01" value={costPrice} onChange={(e) => setCostPrice(e.target.value)} />
          </div>
        ) : null}
        <div>
          <label className="field-label" htmlFor="product-tax-mode">Price includes GST?</label>
          <select id="product-tax-mode" className="field h-10" value={taxMode} onChange={(e) => setTaxMode(e.target.value as "INCLUSIVE" | "EXCLUSIVE")}>
            <option value="INCLUSIVE">Yes, GST included</option>
            <option value="EXCLUSIVE">No, GST added</option>
          </select>
        </div>
        <div>
          <label className="field-label" htmlFor="product-tax-rate">GST %</label>
          <input id="product-tax-rate" className="field h-10" type="number" min="0" max="100" step="0.01" value={taxRate} onChange={(e) => setTaxRate(e.target.value)} required />
        </div>
        <div>
          <label className="field-label" htmlFor="product-hsn">HSN code</label>
          <input id="product-hsn" className="field h-10" inputMode="numeric" value={hsnCode} onChange={(e) => setHsnCode(e.target.value)} />
        </div>
      </div>

      {save.error ? <p className="text-sm text-rose-700" role="alert">{(save.error as Error).message}</p> : null}
      <div className="flex justify-end gap-2">
        <button className="btn-secondary" type="button" onClick={onCancel}>Cancel</button>
        <button className="btn-primary" type="submit" disabled={save.isPending || count === 0 || count > 200}>
          {save.isPending ? "Saving…" : `Create ${count} ${count === 1 ? "Item" : "Items"}`}
        </button>
      </div>
    </form>
  );
}
