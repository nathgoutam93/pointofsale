import { useEffect, useState } from "react";
import { canMoveOnline, MoveOnlineDialog } from "./MoveOnline";
import { desktop } from "../lib/desktop";

/** Marks a feature an offline (single-counter) business can see but not use yet. */
export function OnlineOnlyBadge({ className = "" }: { className?: string }) {
  return <span className={`badge bg-sky-50 text-sky-700 ring-1 ring-sky-200 ring-inset ${className}`}>Online only</span>;
}

function GoOnlineText({ feature }: { feature: string }) {
  return (
    <>
      <p className="text-sm text-slate-600">
        This business runs on this computer only, with one branch and one counter. To use {feature}, move the business
        online. Your items, stock, customers, sales and settings move with it, and every counter and branch then works
        on the same data.
      </p>
      {canMoveOnline() ? null : (
        <p className="mt-3 rounded-md border border-sky-200 bg-sky-50 px-3 py-2 text-sm text-sky-800">
          {desktop ? "An admin can move it online from this screen." : "Moving online is done from the desktop app."}
        </p>
      )}
    </>
  );
}

/** Opens the move online, for those who can start it. */
function MoveOnlineButton() {
  const [open, setOpen] = useState(false);
  if (!canMoveOnline()) return null;
  return (
    <>
      <button className="btn-primary" onClick={() => setOpen(true)}>
        Move business online
      </button>
      {open ? <MoveOnlineDialog onClose={() => setOpen(false)} /> : null}
    </>
  );
}

/** The prompt shown when someone tries an online-only feature. */
export function GoOnlineDialog({ title, feature, onClose }: { title: string; feature: string; onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div
        className="w-full max-w-md rounded-lg bg-white p-6 shadow-xl"
        role="dialog"
        aria-modal="true"
        aria-labelledby="go-online-title"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2">
          <h2 id="go-online-title" className="text-lg font-semibold tracking-tight text-slate-900">{title}</h2>
          <OnlineOnlyBadge />
        </div>
        <div className="mt-3">
          <GoOnlineText feature={feature} />
        </div>
        <div className="mt-5 flex justify-end gap-2">
          <button className="btn-secondary" onClick={onClose} autoFocus>
            Close
          </button>
          <MoveOnlineButton />
        </div>
      </div>
    </div>
  );
}

/** A whole page that needs an online business, shown in place of its content. */
export function GoOnlinePanel({ title, feature }: { title: string; feature: string }) {
  return (
    <section className="p-6">
      <div className="card max-w-2xl p-6" data-tour="online-only">
        <div className="flex items-center gap-2">
          <h2 className="text-lg font-semibold tracking-tight text-slate-900">{title}</h2>
          <OnlineOnlyBadge />
        </div>
        <div className="mt-3">
          <GoOnlineText feature={feature} />
        </div>
        <div className="mt-4">
          <MoveOnlineButton />
        </div>
      </div>
    </section>
  );
}
