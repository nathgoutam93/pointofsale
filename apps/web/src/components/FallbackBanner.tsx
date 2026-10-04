import { useState } from "react";
import { fallbackBridge, useFallbackStatus } from "../lib/fallback";

const timeOf = (iso: string | null) =>
  iso ? new Date(iso).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" }) : "";

/**
 * Online desktop app: when the server can't be reached, and while a fallback counter sells
 * offline. On the fallback counter's computer it offers to keep selling, then to send the
 * offline sales once the server is back; elsewhere it says selling waits for the server.
 */
export function FallbackBanner() {
  const status = useFallbackStatus();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  if (!status || !fallbackBridge) return null;

  const act = async (action: () => Promise<unknown>) => {
    setBusy(true);
    setError("");
    try {
      await action();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure));
    } finally {
      setBusy(false);
    }
  };

  const errorLine = error ? <p className="mt-1 text-xs font-medium text-rose-700">{error}</p> : null;

  // The server refused the offline sales: what clashes, and a file for support.
  const conflicts = status.conflicts?.length ? (
    <div className="mt-2 rounded-lg border border-amber-300 bg-white/70 p-3 text-xs text-amber-950">
      <p className="font-semibold">The server didn't take the offline sales. Nothing was added; they're safe on this computer.</p>
      <ul className="mt-1 list-disc space-y-0.5 pl-4">
        {status.conflicts.map((conflict, index) => (
          <li key={index}>
            <span className="font-medium">{conflict.document}:</span> {conflict.problem}
          </li>
        ))}
      </ul>
      <p className="mt-1">
        Selling carries on here. These need a person to sort out: save the offline sales to a file and send it to support with this
        list.
      </p>
      {fallbackBridge?.saveOutbox ? (
        <button className="btn-secondary mt-2" disabled={busy} onClick={() => void act(() => fallbackBridge!.saveOutbox!())}>
          Save the offline sales to a file
        </button>
      ) : null}
    </div>
  ) : null;

  if (status.syncing) {
    return (
      <div className="border-b border-sky-200 bg-sky-50 px-6 py-3 text-sm text-sky-900 print:hidden" role="status">
        Sending the offline sales to the server…
      </div>
    );
  }

  if (status.active) {
    return (
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-amber-300 bg-amber-50 px-6 py-3 text-sm text-amber-900 print:hidden" role="status">
        <div>
          <p className="font-semibold">Working offline on {status.counterName}</p>
          <p className="text-xs">
            Sales are kept on this computer and sent when the server is back. Cash and card only; credit, returns and
            changes wait for the server.
          </p>
          {conflicts ?? errorLine}
        </div>
        {status.serverReachable ? (
          <button className="btn-primary" disabled={busy} onClick={() => void act(() => fallbackBridge!.finish())}>
            {busy ? "Sending…" : "Send offline sales and go back online"}
          </button>
        ) : (
          <span className="text-xs">The server still can't be reached.</span>
        )}
      </div>
    );
  }

  if (status.serverReachable === false) {
    return (
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-rose-200 bg-rose-50 px-6 py-3 text-sm text-rose-900 print:hidden" role="alert">
        <div>
          <p className="font-semibold">Can't reach the server</p>
          <p className="text-xs">
            {status.configured
              ? status.ready
                ? `This computer can keep selling on ${status.counterName} (offline copy from ${timeOf(status.refreshedAt)}).`
                : "This computer is the fallback counter, but its offline copy isn't ready yet."
              : "Selling here waits for the server. The branch's fallback counter, if it has one, can keep selling on its own computer."}
          </p>
          {errorLine}
        </div>
        {status.configured && status.ready ? (
          <button className="btn-primary" disabled={busy} onClick={() => void act(() => fallbackBridge!.start())}>
            {busy ? "Switching…" : "Keep selling on this computer"}
          </button>
        ) : null}
      </div>
    );
  }

  return null;
}
