import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import {
  COMPOSITION_CATEGORIES,
  COMPOSITION_CATEGORY_LABELS,
  COMPOSITION_RATES,
  type CompositionCategory,
  type TaxpayerType,
} from "@pos/contracts";
import { api, apiErrorMessage, authHeaders } from "../../lib/api";

const todayIn = (timeZone: string) => new Intl.DateTimeFormat("en-CA", { timeZone }).format(new Date());

function describe(type: TaxpayerType, category: CompositionCategory | null) {
  if (type === "COMPOSITION" && category) {
    return `Composition: ${COMPOSITION_CATEGORY_LABELS[category]}, ${COMPOSITION_RATES[category]}% of turnover`;
  }
  return "Regular";
}

/**
 * The business's GST registration type. A change applies to sales from its date onwards;
 * sales already made keep the type they were made under.
 */
export function TaxpayerTypeSection({ timeZone }: { timeZone: string }) {
  const queryClient = useQueryClient();
  const today = todayIn(timeZone);
  const [taxpayerType, setTaxpayerType] = useState<TaxpayerType>("COMPOSITION");
  const [category, setCategory] = useState<CompositionCategory>("TRADER");
  const [effectiveDate, setEffectiveDate] = useState(today);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const summary = useQuery({
    queryKey: ["taxpayer-type"],
    queryFn: async () => {
      const res = await api.business.taxpayerType({ extraHeaders: authHeaders() });
      if (res.status !== 200) throw new Error("Failed to load the GST registration type");
      return res.body;
    },
  });

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ["taxpayer-type"] });
    queryClient.invalidateQueries({ queryKey: ["business-settings"] });
  };

  const saveChange = useMutation({
    mutationFn: async () => {
      const res = await api.business.changeTaxpayerType({
        body: {
          taxpayerType,
          compositionCategory: taxpayerType === "COMPOSITION" ? category : null,
          effectiveDate,
        },
        extraHeaders: authHeaders(),
      });
      if (res.status !== 201) throw new Error(apiErrorMessage(res.body, "Could not change the registration type"));
      return res.body;
    },
    onSuccess: () => {
      setError("");
      setMessage(effectiveDate === today ? "Changed. New sales use it from now on." : `Scheduled from ${effectiveDate}.`);
      refresh();
    },
    onError: (err) => {
      setMessage("");
      setError((err as Error).message);
    },
  });

  const cancelChange = useMutation({
    mutationFn: async (id: string) => {
      const res = await api.business.cancelTaxpayerTypeChange({ params: { id }, extraHeaders: authHeaders() });
      if (res.status !== 200) throw new Error(apiErrorMessage(res.body, "Could not cancel the change"));
      return res.body;
    },
    onSuccess: () => {
      setError("");
      setMessage("Scheduled change cancelled.");
      refresh();
    },
    onError: (err) => {
      setMessage("");
      setError((err as Error).message);
    },
  });

  const submit = () => {
    if (
      effectiveDate === today &&
      !window.confirm(
        `Change to ${describe(taxpayerType, taxpayerType === "COMPOSITION" ? category : null)} now? Every sale from now on uses it.`,
      )
    ) {
      return;
    }
    saveChange.mutate();
  };

  const current = summary.data?.current;
  const scheduled = summary.data?.scheduled ?? null;

  // Offer the other type than the one in force.
  useEffect(() => {
    if (current) setTaxpayerType(current.taxpayerType === "REGULAR" ? "COMPOSITION" : "REGULAR");
  }, [current?.taxpayerType]);

  return (
    <div className="card p-5">
      <h2 className="text-2xl font-semibold text-slate-900">GST Registration Type</h2>
      <p className="mt-1 text-sm text-slate-600">
        Regular taxpayers charge GST and issue a Tax Invoice. Composition taxpayers can't charge GST or sell goods to
        another state: they issue a Bill of Supply and pay a flat rate on turnover. A change applies to sales from its
        date; sales already made keep their type.
      </p>

      {summary.isLoading ? <p className="mt-4 text-sm text-slate-500">Loading…</p> : null}
      {summary.error ? <p className="mt-4 text-sm text-red-700">{(summary.error as Error).message}</p> : null}

      {current ? (
        <div className="mt-4 rounded border border-slate-200 bg-slate-50 p-3">
          <p className="eyebrow">In force now</p>
          <p className="text-lg font-semibold text-slate-900">
            {describe(current.taxpayerType, current.compositionCategory)}
          </p>
          <p className="text-sm text-slate-600">
            {current.effectiveDate ? `Since ${current.effectiveDate}. ` : ""}
            {current.taxpayerType === "COMPOSITION"
              ? "Sales charge no GST and print a Bill of Supply."
              : "Sales charge GST and print a Tax Invoice."}
          </p>
        </div>
      ) : null}

      {scheduled ? (
        <div className="mt-3 flex flex-wrap items-center justify-between gap-3 rounded border border-amber-300 bg-amber-50 p-3">
          <p className="text-sm text-amber-900">
            Changes to <strong>{describe(scheduled.taxpayerType, scheduled.compositionCategory)}</strong> from{" "}
            <strong>{scheduled.effectiveDate}</strong> (set by {scheduled.createdByName}).
          </p>
          <button
            className="rounded bg-white px-3 py-1 text-sm font-semibold text-amber-900 ring-1 ring-amber-300 disabled:opacity-50"
            onClick={() => cancelChange.mutate(scheduled.id)}
            disabled={cancelChange.isPending}
          >
            Cancel change
          </button>
        </div>
      ) : current ? (
        <div className="mt-4 grid gap-3 md:grid-cols-3">
          <div>
            <label className="text-sm text-slate-600">Change to</label>
            <select
              className="field mt-1"
              value={taxpayerType}
              onChange={(e) => setTaxpayerType(e.target.value as TaxpayerType)}
            >
              <option value="REGULAR">Regular</option>
              <option value="COMPOSITION">Composition</option>
            </select>
          </div>
          {taxpayerType === "COMPOSITION" ? (
            <div>
              <label className="text-sm text-slate-600">Composition category</label>
              <select
                className="field mt-1"
                value={category}
                onChange={(e) => setCategory(e.target.value as CompositionCategory)}
              >
                {COMPOSITION_CATEGORIES.map((key) => (
                  <option key={key} value={key}>
                    {COMPOSITION_CATEGORY_LABELS[key]} ({COMPOSITION_RATES[key]}%)
                  </option>
                ))}
              </select>
            </div>
          ) : (
            <div />
          )}
          <div>
            <label className="text-sm text-slate-600">Effective from</label>
            <input
              type="date"
              className="field mt-1"
              min={today}
              value={effectiveDate}
              onChange={(e) => setEffectiveDate(e.target.value)}
            />
          </div>
          <div className="md:col-span-3 flex flex-wrap items-center gap-3">
            <button
              className="btn-primary"
              onClick={submit}
              disabled={saveChange.isPending || !effectiveDate}
            >
              {effectiveDate === today ? "Change now" : "Schedule change"}
            </button>
            <p className="text-xs text-slate-500">
              Opting into composition usually starts on 1 April, after filing CMP-02 on the GST portal.
            </p>
          </div>
        </div>
      ) : null}

      {message ? <p className="mt-3 text-sm text-emerald-700">{message}</p> : null}
      {error ? <p className="mt-3 text-sm text-red-700">{error}</p> : null}

      {summary.data && summary.data.history.length > 0 ? (
        <div className="mt-5">
          <p className="text-sm font-semibold text-slate-700">History</p>
          <table className="mt-2 w-full text-left text-sm">
            <thead className="eyebrow">
              <tr>
                <th className="py-1 pr-3">From</th>
                <th className="py-1 pr-3">Type</th>
                <th className="py-1">Set by</th>
              </tr>
            </thead>
            <tbody>
              {summary.data.history.map((change) => (
                <tr key={change.id} className="border-t border-slate-100">
                  <td className="py-1 pr-3">{change.effectiveDate}</td>
                  <td className="py-1 pr-3">{describe(change.taxpayerType, change.compositionCategory)}</td>
                  <td className="py-1">{change.createdByName}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </div>
  );
}
