import { inr } from "../route-helpers";
import { formatStockOnHand } from "./cartMath";

/** A product's variant as the grid has it: an item, and its values of the product's options. */
export type VariantChoice = {
  id: string;
  choiceKey: string;
  sellPrice: number | string;
  option1?: string | null;
  option2?: string | null;
  group?: { id: string; name: string; option1Name: string; option2Name: string | null; option1Values?: string[]; option2Values?: string[] } | null;
};

/** The values in the product's order, then any others the variants have. */
const valuesOf = (order: string[] | undefined, values: Array<string | null | undefined>) => [...new Set([...(order ?? []), ...values.filter((value): value is string => !!value)])];

/**
 * Picks a size/colour of a product: a grid of its first option (rows) by its second (columns),
 * each with its price and stock. A combination the product doesn't have is left blank.
 */
export function VariantPicker<T extends VariantChoice>({ choices, onHandByItem, onPick, onClose }: { choices: T[]; onHandByItem: Map<string, number>; onPick: (choice: T) => void; onClose: () => void }) {
  const group = choices[0]?.group;
  if (!group) return null;
  const rows = valuesOf(group.option1Values, choices.map((choice) => choice.option1));
  const columns = group.option2Name ? valuesOf(group.option2Values, choices.map((choice) => choice.option2)) : [null];
  const find = (option1: string, option2: string | null) => choices.find((choice) => choice.option1 === option1 && (choice.option2 ?? null) === option2);

  return (
    <div className="modal-backdrop z-50" onClick={onClose}>
      <div role="dialog" aria-modal="true" aria-labelledby="variant-title" className="max-h-[85vh] w-full max-w-2xl overflow-auto rounded-xl border border-slate-200 bg-white p-5 shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="mb-4 flex items-start justify-between gap-3">
          <div>
            <h2 id="variant-title" className="text-lg font-semibold text-slate-900">{group.name}</h2>
            <p className="text-sm text-slate-500">Pick the {group.option2Name ? `${group.option1Name.toLowerCase()} and ${group.option2Name.toLowerCase()}` : group.option1Name.toLowerCase()}.</p>
          </div>
          <button className="btn-ghost px-2" type="button" onClick={onClose} aria-label="Close">✕</button>
        </div>
        <table className="w-full border-separate border-spacing-1.5 text-sm">
          {group.option2Name ? (
            <thead>
              <tr>
                <th className="eyebrow text-left">{group.option1Name} \ {group.option2Name}</th>
                {columns.map((column) => (
                  <th key={column} className="eyebrow text-center">{column}</th>
                ))}
              </tr>
            </thead>
          ) : null}
          <tbody>
            {rows.map((row) => (
              <tr key={row}>
                <th className="pr-2 text-left font-semibold whitespace-nowrap text-slate-800">{row}</th>
                {columns.map((column) => {
                  const choice = find(row, column);
                  if (!choice) return <td key={column ?? "-"} className="rounded-md bg-slate-50" />;
                  const stock = onHandByItem.get(choice.id) ?? 0;
                  return (
                    <td key={column ?? "-"}>
                      <button
                        type="button"
                        className="w-full rounded-md border border-slate-200 px-2 py-2 text-center hover:border-brand-400 hover:bg-brand-50"
                        aria-label={`${group.name} ${row}${column ? ` ${column}` : ""}`}
                        onClick={() => onPick(choice)}
                      >
                        <span className="block font-semibold tabular-nums text-slate-900">{inr(choice.sellPrice)}</span>
                        <span className={`block text-[11px] tabular-nums ${stock <= 0 ? "text-rose-600" : "text-slate-500"}`}>{formatStockOnHand(stock)} left</span>
                      </button>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
