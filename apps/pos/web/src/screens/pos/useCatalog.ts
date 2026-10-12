import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { api, authHeaders } from "../../lib/api";

/**
 * The branch's items and stock on hand, the categories they fall in, and the choices the
 * product grid sells: one per item and sale unit, narrowed to the search and category.
 */
export function useCatalog({
  branchId,
  search,
  activeCategory,
}: {
  branchId: string;
  search: string;
  activeCategory: string;
}) {
  const items = useQuery({
    // Priced for this branch: its own prices where it has them.
    queryKey: ["items-pos", branchId],
    queryFn: async () => {
      const res = await api.items.list({
        query: { activeOnly: true, branchId: branchId },
        extraHeaders: authHeaders(),
      });
      if (res.status !== 200) throw new Error("Failed to load items");
      return res.body;
    },
  });

  const onHand = useQuery({
    queryKey: ["stock-module", branchId],
    queryFn: async () => {
      const res = await api.stock.onHand({
        query: { branchId: branchId },
        extraHeaders: authHeaders(),
      });
      if (res.status !== 200) throw new Error("Failed to load stock");
      return res.body;
    },
  });

  const categories = useMemo(() => {
    const set = new Set<string>();
    for (const item of items.data ?? []) {
      set.add(item.category || "Uncategorized");
    }
    return ["All", ...Array.from(set)];
  }, [items.data]);

  const filteredItems = useMemo(() => {
    const keyword = search.trim().toLowerCase();
    return (items.data ?? []).filter((item) => {
      const category = item.category || "Uncategorized";
      const categoryMatch =
        activeCategory === "All" || category === activeCategory;
      const saleUomText = (item.saleUoms ?? []).map((variant) => variant.uom).join(" ");
      const textMatch =
        keyword.length === 0 ||
        item.name.toLowerCase().includes(keyword) ||
        item.code.toLowerCase().includes(keyword) ||
        (item.group?.name.toLowerCase().includes(keyword) ?? false) ||
        category.toLowerCase().includes(keyword) ||
        saleUomText.toLowerCase().includes(keyword);
      return categoryMatch && textMatch;
    });
  }, [items.data, search, activeCategory]);

  const allSaleItemChoices = useMemo(() => {
    return (items.data ?? []).flatMap((item) => {
      const variants = item.saleUoms?.length
        ? item.saleUoms
        : [
            {
              id: `${item.id}-base`,
              uom: item.uom,
              conversionQty: 1,
              sellPrice: item.sellPrice,
              isDefault: true,
            },
          ];
      return variants.map((variant) => ({
        id: item.id,
        choiceKey: `${item.id}:${variant.uom}`,
        name: item.name,
        code: item.code,
        uom: item.uom,
        sellPrice: variant.sellPrice,
        taxRate: item.taxRate,
        taxMode: item.taxMode,
        leastCount: item.leastCount,
        imageUrl: item.imageUrl,
        saleUom: variant.isDefault ? undefined : variant.uom,
        displayUom: variant.uom,
        saleUomQty: 1,
        saleUomConversionQty: variant.conversionQty,
        group: item.group,
        option1: item.option1,
        option2: item.option2,
      }));
    });
  }, [items.data]);

  const saleItemChoices = useMemo(() => {
    const visibleItemIds = new Set(filteredItems.map((item) => item.id));
    return allSaleItemChoices.filter((item) => visibleItemIds.has(item.id));
  }, [allSaleItemChoices, filteredItems]);

  const onHandByItem = useMemo(() => {
    const map = new Map<string, number>();
    for (const row of onHand.data ?? []) {
      map.set(row.itemId, Number(row.onHand) || 0);
    }
    return map;
  }, [onHand.data]);

  return { items, categories, allSaleItemChoices, saleItemChoices, onHandByItem };
}

export type Catalog = ReturnType<typeof useCatalog>;
