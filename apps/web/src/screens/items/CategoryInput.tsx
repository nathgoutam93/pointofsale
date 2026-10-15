import { useQuery } from "@tanstack/react-query";
import { useId, type InputHTMLAttributes } from "react";
import { api, authHeaders } from "../../lib/api";

/**
 * An item's category, suggesting the business's categories as it is typed. Any other text makes
 * a new one; the API saves "snacks" as an existing "Snacks".
 */
export function CategoryInput(props: Omit<InputHTMLAttributes<HTMLInputElement>, "list">) {
  const listId = useId();
  // Under "items-module", so saving an item refreshes it.
  const categories = useQuery({
    queryKey: ["items-module", "categories"],
    queryFn: async () => {
      const res = await api.items.categories({ extraHeaders: authHeaders() });
      if (res.status !== 200) throw new Error("Failed to fetch categories");
      return res.body;
    },
  });
  return (
    <>
      <input autoComplete="off" {...props} list={listId} />
      <datalist id={listId}>
        {(categories.data ?? []).map((category) => (
          <option key={category} value={category} />
        ))}
      </datalist>
    </>
  );
}
