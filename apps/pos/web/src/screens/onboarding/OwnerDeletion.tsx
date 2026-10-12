import { useMutation } from "@tanstack/react-query";
import { FormEvent, useState } from "react";
import { api, apiErrorMessage } from "../../lib/api";
import { ErrorNote } from "./OnboardingShell";

export type OwnedBusiness = { id: string; code: string; name: string; status: string; deleteAfter?: string | null };

const dateOf = (iso: string | null | undefined) =>
  iso ? new Date(iso).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" }) : "soon";

/**
 * The owner deletes a business: their password, a code emailed to them and the business code
 * typed again. It is locked at once and erased after the grace period, unless an owner keeps it.
 */
export function BusinessDeletion({
  businesses,
  auth,
  onChanged,
}: {
  businesses: OwnedBusiness[];
  auth: Record<string, string>;
  onChanged: (message: string) => void;
}) {
  const deletable = businesses.filter((business) => business.status === "ACTIVE" || business.status === "SUSPENDED");
  const deleting = businesses.filter((business) => business.status === "DELETING");
  const [open, setOpen] = useState(false);

  return (
    <div className="card grid gap-3 border-rose-200 p-4">
      <div>
        <p className="font-semibold text-slate-900">Delete a business</p>
        <p className="mt-0.5 text-xs text-slate-600">
          Removes the business and all its data (sales, items, stock, customers, staff, uploaded images) from the platform. It is locked at once and
          erased for good after 7 days; until then any owner can keep it. Export anything you need first.
        </p>
      </div>
      {deleting.map((business) => (
        <KeepBusiness key={business.id} business={business} auth={auth} onKept={onChanged} />
      ))}
      {deletable.length === 0 ? null : open ? (
        <DeleteBusinessForm
          businesses={deletable}
          auth={auth}
          onCancel={() => setOpen(false)}
          onDeleted={(message) => {
            setOpen(false);
            onChanged(message);
          }}
        />
      ) : (
        <div>
          <button className="btn-ghost text-rose-700" type="button" onClick={() => setOpen(true)}>
            Delete a business…
          </button>
        </div>
      )}
    </div>
  );
}

function DeleteBusinessForm({
  businesses,
  auth,
  onCancel,
  onDeleted,
}: {
  businesses: OwnedBusiness[];
  auth: Record<string, string>;
  onCancel: () => void;
  onDeleted: (message: string) => void;
}) {
  const [businessId, setBusinessId] = useState(businesses[0]?.id ?? "");
  const [codeSent, setCodeSent] = useState(false);
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [businessCode, setBusinessCode] = useState("");
  const business = businesses.find((candidate) => candidate.id === businessId);

  const sendCode = useMutation({
    mutationFn: async () => {
      const res = await api.accounts.businessDeletionCode({ params: { businessId }, body: {}, extraHeaders: auth });
      if (res.status !== 202) throw new Error(apiErrorMessage(res.body, "The code couldn't be sent."));
    },
    onSuccess: () => setCodeSent(true),
  });
  const remove = useMutation({
    mutationFn: async () => {
      const res = await api.accounts.deleteBusiness({ params: { businessId }, body: { password, code, businessCode }, extraHeaders: auth });
      if (res.status !== 200) throw new Error(apiErrorMessage(res.body, "The business couldn't be deleted."));
      return res.body;
    },
    onSuccess: (result) => onDeleted(`${business?.name ?? "The business"} is locked, and will be erased on ${dateOf(result.deleteAfter)}.`),
  });

  return (
    <form
      className="grid gap-3 rounded-md bg-rose-50 p-3"
      onSubmit={(e: FormEvent) => {
        e.preventDefault();
        if (codeSent) remove.mutate();
        else sendCode.mutate();
      }}
    >
      {businesses.length > 1 ? (
        <div>
          <label className="field-label" htmlFor="delete-business">Business to delete</label>
          <select
            id="delete-business"
            className="field h-10"
            value={businessId}
            disabled={codeSent}
            onChange={(e) => setBusinessId(e.target.value)}
          >
            {businesses.map((candidate) => (
              <option key={candidate.id} value={candidate.id}>
                {candidate.name} ({candidate.code})
              </option>
            ))}
          </select>
        </div>
      ) : (
        <p className="text-sm text-slate-800">
          Delete <span className="font-semibold">{business?.name}</span> (<span className="font-mono">{business?.code}</span>)?
        </p>
      )}
      {codeSent ? (
        <>
          <p className="text-xs text-slate-700">We emailed you an 8-digit code. It works for 15 minutes.</p>
          <div className="grid gap-3 sm:grid-cols-3">
            <div>
              <label className="field-label" htmlFor="delete-code">Code from the email</label>
              <input id="delete-code" className="field h-10 font-mono" inputMode="numeric" autoComplete="one-time-code" value={code} onChange={(e) => setCode(e.target.value)} required autoFocus />
            </div>
            <div>
              <label className="field-label" htmlFor="delete-password">Owner password</label>
              <input id="delete-password" className="field h-10" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
            </div>
            <div>
              <label className="field-label" htmlFor="delete-business-code">Type {business?.code} to confirm</label>
              <input id="delete-business-code" className="field h-10 font-mono" autoComplete="off" value={businessCode} onChange={(e) => setBusinessCode(e.target.value)} required />
            </div>
          </div>
        </>
      ) : null}
      {sendCode.error ? <ErrorNote message={(sendCode.error as Error).message} /> : null}
      {remove.error ? <ErrorNote message={(remove.error as Error).message} /> : null}
      <div className="flex flex-wrap justify-end gap-2">
        <button className="btn-secondary" type="button" onClick={onCancel}>Cancel</button>
        {codeSent ? (
          <button className="btn-ghost" type="button" disabled={sendCode.isPending} onClick={() => sendCode.mutate()}>
            Send another code
          </button>
        ) : null}
        <button className="btn-primary h-10 bg-rose-600 px-4 hover:bg-rose-700" type="submit" disabled={sendCode.isPending || remove.isPending}>
          {codeSent ? (remove.isPending ? "Deleting…" : "Delete business") : sendCode.isPending ? "Sending…" : "Email me a code"}
        </button>
      </div>
    </form>
  );
}

function KeepBusiness({ business, auth, onKept }: { business: OwnedBusiness; auth: Record<string, string>; onKept: (message: string) => void }) {
  const [asking, setAsking] = useState(false);
  const [password, setPassword] = useState("");
  const keep = useMutation({
    mutationFn: async () => {
      const res = await api.accounts.cancelBusinessDeletion({ params: { businessId: business.id }, body: { password }, extraHeaders: auth });
      if (res.status !== 200) throw new Error(apiErrorMessage(res.body, "The business couldn't be kept."));
    },
    onSuccess: () => onKept(`${business.name} is kept, and works again.`),
  });
  return (
    <div className="rounded-md border border-rose-200 bg-rose-50 p-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-rose-900">
          <span className="font-semibold">{business.name}</span> (<span className="font-mono">{business.code}</span>) is being deleted: it is locked, and
          will be erased on {dateOf(business.deleteAfter)}.
        </p>
        {asking ? null : (
          <button className="btn-secondary" type="button" onClick={() => setAsking(true)}>
            Keep this business
          </button>
        )}
      </div>
      {asking ? (
        <form
          className="mt-3 grid gap-3 sm:grid-cols-[1fr_auto_auto]"
          onSubmit={(e: FormEvent) => {
            e.preventDefault();
            keep.mutate();
          }}
        >
          <input
            className="field h-10"
            type="password"
            placeholder="Owner password"
            aria-label={`Owner password to keep ${business.name}`}
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            autoFocus
          />
          <button className="btn-ghost" type="button" onClick={() => setAsking(false)}>Cancel</button>
          <button className="btn-primary h-10 px-4" type="submit" disabled={keep.isPending}>
            {keep.isPending ? "Keeping…" : "Keep it"}
          </button>
          {keep.error ? (
            <div className="sm:col-span-3">
              <ErrorNote message={(keep.error as Error).message} />
            </div>
          ) : null}
        </form>
      ) : null}
    </div>
  );
}
