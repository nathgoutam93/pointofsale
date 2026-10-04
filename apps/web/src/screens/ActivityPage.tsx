import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { api, apiErrorMessage, authHeaders } from "../lib/api";

/** What each kind of entry is called on the screen. */
const ACTIONS: Record<string, string> = {
  ITEM_CREATED: "Item added",
  ITEM_UPDATED: "Item changed",
  ITEM_PRICE_CHANGED: "Price or tax changed",
  ITEM_REMOVED: "Item removed",
  SALE_CANCELLED: "Bill cancelled",
  RETURN_MADE: "Return",
  WALLET_ADJUSTED: "Wallet corrected",
  STOCK_ADJUSTED: "Stock adjusted",
  OPENING_STOCK_CORRECTED: "Opening stock corrected",
  USER_CREATED: "Cashier added",
  USER_UPDATED: "Staff changed",
  USER_PERMISSIONS_CHANGED: "Permissions changed",
  BRANCH_ACCESS_GRANTED: "Branch access given",
  BRANCH_ACCESS_REVOKED: "Branch access removed",
  BUSINESS_SETTINGS_CHANGED: "Business settings",
  BRANCH_SETTINGS_CHANGED: "Branch settings",
  TAXPAYER_TYPE_CHANGED: "GST registration",
  REGISTER_CLOSED_FOR: "Register closed for someone",
};

/** Admins: who changed what (prices, cancellations, returns, staff, settings), newest first. */
export function ActivityPage() {
  const [action, setAction] = useState("");
  const [open, setOpen] = useState<string | null>(null);

  const log = useInfiniteQuery({
    queryKey: ["audit", action],
    initialPageParam: undefined as string | undefined,
    queryFn: async ({ pageParam }) => {
      const res = await api.audit.list({
        query: { limit: 50, ...(action ? { action } : {}), ...(pageParam ? { before: pageParam } : {}) },
        extraHeaders: authHeaders(),
      });
      if (res.status !== 200) throw new Error(apiErrorMessage(res.body, "Failed to load the activity"));
      return res.body;
    },
    getNextPageParam: (lastPage) => (lastPage.length === 50 ? lastPage[lastPage.length - 1].createdAt : undefined),
  });
  const entries = log.data?.pages.flat() ?? [];
  // Times in the business's time zone, as everywhere else.
  const business = useQuery({
    queryKey: ["business-settings"],
    queryFn: async () => {
      const res = await api.business.get({ extraHeaders: authHeaders() });
      if (res.status !== 200) throw new Error("Failed to load business settings");
      return res.body;
    },
  });
  const timeZone = business.data?.timezone;

  return (
    <section className="p-6">
      <div className="mx-auto max-w-5xl space-y-4">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="text-xl font-semibold tracking-tight text-slate-900">Activity</h2>
            <p className="mt-1 text-sm text-slate-500">
              Who changed prices, cancelled bills, made returns, corrected stock or wallets, and changed staff or settings.
            </p>
          </div>
          <label className="w-64 text-xs text-slate-600">
            Show
            <select className="field mt-1" value={action} onChange={(e) => setAction(e.target.value)}>
              <option value="">Everything</option>
              {Object.entries(ACTIONS).map(([key, label]) => (
                <option key={key} value={key}>
                  {label}
                </option>
              ))}
            </select>
          </label>
        </div>

        <div className="card divide-y divide-slate-100">
          {log.isLoading ? <p className="p-4 text-sm text-slate-500">Loading…</p> : null}
          {log.error ? <p className="p-4 text-sm text-rose-700">{(log.error as Error).message}</p> : null}
          {!log.isLoading && entries.length === 0 ? <p className="p-4 text-sm text-slate-500">Nothing recorded yet.</p> : null}
          {entries.map((entry) => (
            <div key={entry.id} className="px-4 py-3 text-sm">
              <button type="button" className="flex w-full items-start justify-between gap-3 text-left" onClick={() => setOpen(open === entry.id ? null : entry.id)}>
                <div className="min-w-0">
                  <p className="text-slate-900">{entry.summary}</p>
                  <p className="mt-0.5 text-xs text-slate-500">
                    <span className="badge mr-2 bg-slate-100 text-slate-600">{ACTIONS[entry.action] ?? entry.action}</span>
                    {entry.userName} · {new Date(entry.createdAt).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short", timeZone })}
                  </p>
                </div>
                {entry.details ? <span className="text-xs text-brand-600">{open === entry.id ? "Hide" : "Details"}</span> : null}
              </button>
              {open === entry.id && entry.details ? (
                <pre className="mt-2 overflow-x-auto rounded-md bg-slate-50 p-3 text-xs text-slate-700">{JSON.stringify(entry.details, null, 2)}</pre>
              ) : null}
            </div>
          ))}
        </div>
        {log.hasNextPage ? (
          <button type="button" className="btn-secondary" disabled={log.isFetchingNextPage} onClick={() => void log.fetchNextPage()}>
            {log.isFetchingNextPage ? "Loading…" : "Older"}
          </button>
        ) : null}
      </div>
    </section>
  );
}
