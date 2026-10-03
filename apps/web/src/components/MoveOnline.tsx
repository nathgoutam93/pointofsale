import { Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { FormEvent, useEffect, useState } from "react";
import { api, apiErrorMessage, apiFetch } from "../lib/api";
import { desktop, type MoveResult, type MoveStep } from "../lib/desktop";
import { getSession } from "../lib/session";
import { rememberBusinessCode } from "../lib/business-code";
import { BusinessCodeCard } from "../screens/onboarding/SetupPage";

const STEPS: Array<{ step: MoveStep; label: string }> = [
  { step: "checking", label: "Checking the server" },
  { step: "account", label: "Signing in to your owner account" },
  { step: "backup", label: "Backing up this computer" },
  { step: "pausing", label: "Pausing changes here" },
  { step: "exporting", label: "Packing the business" },
  { step: "uploading", label: "Uploading" },
  { step: "finishing", label: "Finishing" },
];

/** Moving online is possible here: the desktop app, offline, signed in as an admin. */
export function canMoveOnline() {
  return Boolean(desktop?.moveOnline && desktop.config.mode === "offline" && getSession()?.role === "ADMIN");
}

/** The whole move: owner account, then each step as it happens, then the new business code. */
export function MoveOnlineDialog({ onClose }: { onClose: () => void }) {
  const defaultServer = desktop?.config.defaultServerUrl ?? null;
  const [server, setServer] = useState("");
  const [ownerEmail, setOwnerEmail] = useState("");
  const [ownerPassword, setOwnerPassword] = useState("");
  const [step, setStep] = useState<MoveStep | null>(null);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<MoveResult | null>(null);

  useEffect(() => desktop?.onMoveOnlineProgress((next) => setStep(next)), []);

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!desktop) return;
    setRunning(true);
    setError("");
    setStep(null);
    try {
      const moved = await desktop.moveOnline({ server, ownerEmail, ownerPassword });
      // Filled in on the online sign-in screen.
      rememberBusinessCode(moved.businessCode);
      setResult(moved);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure));
    } finally {
      setRunning(false);
    }
  };

  const reached = step ? STEPS.findIndex((s) => s.step === step) : -1;

  return (
    <div className="modal-backdrop">
      <div className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-lg bg-white p-6 shadow-xl" role="dialog" aria-modal="true" aria-labelledby="move-online-title">
        {result ? (
          <>
            <h2 id="move-online-title" className="text-lg font-semibold tracking-tight text-slate-900">
              {result.businessName} is online
            </h2>
            <p className="mt-2 mb-4 text-sm text-slate-600">
              This computer now works with the online business. Everyone signs in with the same username and password as
              before, plus this code. The copy on this computer stays, read-only.
            </p>
            <BusinessCodeCard code={result.businessCode} />
            <div className="mt-5 flex justify-end">
              <button className="btn-primary" onClick={() => void desktop?.reload()}>
                Sign in online
              </button>
            </div>
          </>
        ) : (
          <form onSubmit={onSubmit}>
            <h2 id="move-online-title" className="text-lg font-semibold tracking-tight text-slate-900">
              Move this business online
            </h2>
            <p className="mt-2 text-sm text-slate-600">
              Everything moves: items, stock, customers, sales, GST history, staff and their passwords. Invoice numbers carry
              on. Then you can add counters and branches, and other computers can join with the business code.
            </p>
            <p className="mt-2 text-sm text-slate-600">Close any open register first. Selling here pauses for the few minutes it takes.</p>

            <div className="mt-4 grid gap-3">
              {defaultServer ? null : (
                <div>
                  <label className="field-label" htmlFor="move-server">Server address</label>
                  <input id="move-server" className="field h-10" value={server} onChange={(e) => setServer(e.target.value)} placeholder="https://pos.example.com" inputMode="url" required disabled={running} />
                </div>
              )}
              <div>
                <label className="field-label" htmlFor="move-email">Owner email</label>
                <input id="move-email" className="field h-10" type="email" value={ownerEmail} onChange={(e) => setOwnerEmail(e.target.value)} autoComplete="email" required disabled={running} />
              </div>
              <div>
                <label className="field-label" htmlFor="move-password">Owner password</label>
                <input id="move-password" className="field h-10" type="password" value={ownerPassword} onChange={(e) => setOwnerPassword(e.target.value)} autoComplete="current-password" minLength={8} required disabled={running} />
                <p className="mt-1 text-xs text-slate-500">
                  New here? This creates your owner account. Already have one? Use its password (
                  <Link to="/owner-password" search={ownerEmail ? { email: ownerEmail } : {}} className="underline hover:text-slate-800">
                    forgot it?
                  </Link>
                  ).
                </p>
              </div>
            </div>

            {running || step ? (
              <ol className="mt-4 grid gap-1.5 text-sm">
                {STEPS.map((s, i) => (
                  <li key={s.step} className={i < reached || (!running && !error && i === reached) ? "text-emerald-700" : i === reached ? "font-medium text-slate-900" : "text-slate-400"}>
                    {i < reached ? "✓ " : i === reached && running ? "… " : "· "}
                    {s.label}
                  </li>
                ))}
              </ol>
            ) : null}

            {error ? <p className="mt-4 rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700" role="alert">{error}</p> : null}

            <div className="mt-5 flex justify-end gap-2">
              <button type="button" className="btn-secondary" onClick={onClose} disabled={running}>
                Close
              </button>
              <button type="submit" className="btn-primary" disabled={running}>
                {running ? "Moving…" : error ? "Try again" : "Move online"}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}

/**
 * Offline: a move online that didn't finish leaves changes paused (or, rarely, the business
 * moved but this computer hasn't switched yet). Says so on every page, with the way out.
 */
export function MoveOnlineNotice() {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [error, setError] = useState("");
  const meta = useQuery({
    queryKey: ["meta"],
    queryFn: async () => {
      const res = await api.meta.get();
      if (res.status !== 200) throw new Error("Failed to load server details");
      return res.body;
    },
    staleTime: Infinity,
    // Only an offline business can be moving or have moved.
    enabled: !desktop || desktop.config.mode === "offline",
  });
  const status = meta.data?.instanceStatus;
  if (status !== "MIGRATING" && status !== "ARCHIVED") return null;

  const cancel = async () => {
    if (
      !window.confirm(
        "Cancel moving online? If the upload already reached the server, the online business won't have anything sold here from now on; finishing the move is safer."
      )
    ) {
      return;
    }
    setCancelling(true);
    setError("");
    const res = await apiFetch("/migration/abort", { method: "POST" });
    setCancelling(false);
    if (!res.ok) {
      setError(apiErrorMessage(await res.json().catch(() => null), "Couldn't cancel"));
      return;
    }
    void queryClient.invalidateQueries({ queryKey: ["meta"] });
  };

  return (
    <div className="border-b border-amber-200 bg-amber-50 px-6 py-3 text-sm text-amber-900 print:hidden" role="status">
      {status === "ARCHIVED" ? (
        <p>
          This business has moved online{meta.data?.movedTo ? ` (business code ${meta.data.movedTo.businessCode})` : ""}. This copy is
          read-only; restart the app to sign in online.
        </p>
      ) : (
        <div className="flex flex-wrap items-center gap-3">
          <p className="flex-1">Moving online didn't finish, so changes on this computer are paused.</p>
          {canMoveOnline() ? (
            <>
              <button className="btn-secondary py-1.5" onClick={() => void cancel()} disabled={cancelling}>
                {cancelling ? "Cancelling…" : "Cancel the move"}
              </button>
              <button className="btn-primary py-1.5" onClick={() => setOpen(true)}>
                Finish moving online
              </button>
            </>
          ) : (
            <p>An admin can finish or cancel it.</p>
          )}
          {error ? <p className="w-full text-rose-700">{error}</p> : null}
        </div>
      )}
      {open ? <MoveOnlineDialog onClose={() => setOpen(false)} /> : null}
    </div>
  );
}
