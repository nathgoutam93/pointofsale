import { useMemo, useState } from "react";
import { IconSearch } from "../../components/icons";

export type PickableItem = { id: string; code: string; name: string; uom: string };

/** A search box that lists matching items by name or code; picking one calls `onPick`. */
export function ItemPicker<T extends PickableItem>({
  items,
  onPick,
  excludeIds,
  placeholder = "Add an item by name or code",
}: {
  items: T[];
  onPick: (item: T) => void;
  excludeIds?: Set<string>;
  placeholder?: string;
}) {
  const [term, setTerm] = useState("");
  const matches = useMemo(() => {
    const query = term.trim().toLowerCase();
    if (!query) return [];
    return items
      .filter((item) => !excludeIds?.has(item.id))
      .filter((item) => item.name.toLowerCase().includes(query) || item.code.toLowerCase().includes(query))
      .slice(0, 8);
  }, [items, term, excludeIds]);

  const pick = (item: T) => {
    onPick(item);
    setTerm("");
  };

  return (
    <div className="relative">
      <IconSearch className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-slate-400" width={16} height={16} />
      <input
        className="field pl-9"
        placeholder={placeholder}
        value={term}
        onChange={(e) => setTerm(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            if (matches[0]) pick(matches[0]);
          }
          if (e.key === "Escape") setTerm("");
        }}
      />
      {matches.length > 0 && (
        <ul className="absolute z-20 mt-1 max-h-72 w-full overflow-y-auto rounded-lg border border-slate-200 bg-white py-1 shadow-lg">
          {matches.map((item) => (
            <li key={item.id}>
              <button
                type="button"
                className="flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-sm hover:bg-slate-50"
                onClick={() => pick(item)}
              >
                <span className="truncate font-medium text-slate-900">{item.name}</span>
                <span className="shrink-0 text-xs text-slate-500">
                  {item.code} · {item.uom}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
