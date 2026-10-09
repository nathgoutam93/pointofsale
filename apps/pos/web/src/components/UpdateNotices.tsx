import { useState } from "react";
import { desktop, type UpdateStatus } from "../lib/desktop";
import { useDesktopUpdateStatus, useRequiredVersion } from "../lib/updates";

/**
 * App-wide update notices, shown over any page:
 * - when the server needs a newer app, a screen that blocks use until it is installed;
 * - otherwise, once an update has downloaded, a small "ready" note with "Restart now".
 */
export function UpdateNotices() {
  const status = useDesktopUpdateStatus();
  const requiredByServer = useRequiredVersion();
  const [dismissed, setDismissed] = useState<string | null>(null);

  const required = status?.required ?? (requiredByServer && !desktop ? requiredByServer : null);
  if (required) {
    return status ? <DesktopUpdateRequired status={status} required={required} /> : <BrowserUpdateRequired />;
  }
  if (status?.state === "ready" && status.availableVersion && dismissed !== status.availableVersion) {
    return <UpdateReady status={status} onLater={() => setDismissed(status.availableVersion)} />;
  }
  return null;
}

function useInstall() {
  const [installing, setInstalling] = useState(false);
  const [error, setError] = useState("");
  const install = async () => {
    setInstalling(true);
    setError("");
    try {
      await desktop?.updates?.installNow();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setInstalling(false);
    }
  };
  return { install, installing, error };
}

function UpdateReady({ status, onLater }: { status: UpdateStatus; onLater: () => void }) {
  const { install, installing, error } = useInstall();
  return (
    <div className="fixed right-4 bottom-4 z-40 w-full max-w-sm print:hidden" role="status" aria-live="polite">
      <div className="card p-4 shadow-lg">
        <p className="text-sm font-semibold text-slate-900">Version {status.availableVersion} is ready</p>
        <p className="mt-1 text-sm text-slate-600">
          It installs when you close the app. Restart now to use it straight away; open bills are kept.
        </p>
        {error ? <p className="mt-2 text-sm text-rose-600">{error}</p> : null}
        <div className="mt-3 flex justify-end gap-2">
          <button className="btn-ghost" onClick={onLater} disabled={installing}>
            Later
          </button>
          <button className="btn-primary" onClick={() => void install()} disabled={installing}>
            {installing ? "Restarting…" : "Restart now"}
          </button>
        </div>
      </div>
    </div>
  );
}

function RequiredScreen({ children }: { children: React.ReactNode }) {
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-slate-50/95 p-4 backdrop-blur-sm" role="alertdialog" aria-modal="true" aria-labelledby="update-required-title">
      <div className="card w-full max-w-md p-6 shadow-xl">{children}</div>
    </div>
  );
}

function DesktopUpdateRequired({ status, required }: { status: UpdateStatus; required: string }) {
  const { install, installing, error } = useInstall();
  const [checking, setChecking] = useState(false);
  const ready = status.state === "ready";
  const checkAgain = async () => {
    setChecking(true);
    await desktop?.updates?.check().catch(() => undefined);
    setChecking(false);
  };

  let body: React.ReactNode;
  if (ready) {
    body = <p>Version {status.availableVersion} is downloaded. Restart to install it; open bills are kept.</p>;
  } else if (status.state === "downloading") {
    body = (
      <>
        <p>Downloading version {status.availableVersion}…</p>
        <div className="mt-3 h-2 overflow-hidden rounded-full bg-slate-100" aria-hidden="true">
          <div className="h-full rounded-full bg-brand-600 transition-[width]" style={{ width: `${status.percent ?? 0}%` }} />
        </div>
        <p className="mt-1 text-xs text-slate-500">{status.percent ?? 0}%</p>
      </>
    );
  } else if (status.state === "unsupported") {
    body = <p>This copy of the app can't update itself. Install version {required} or later.</p>;
  } else if (status.state === "error") {
    body = (
      <p>
        The update couldn't be downloaded{status.error ? ` (${status.error})` : ""}. Check the internet connection; the app keeps
        trying.
      </p>
    );
  } else if (status.state === "none") {
    body = <p>Version {required} isn't available to download yet. The app keeps checking.</p>;
  } else {
    body = <p>Looking for the update…</p>;
  }

  return (
    <RequiredScreen>
      <h2 id="update-required-title" className="text-lg font-semibold tracking-tight text-slate-900">
        Update required
      </h2>
      <p className="mt-2 text-sm text-slate-600">
        The server needs version {required} or later of the app. This computer has version {status.currentVersion}.
      </p>
      <div className="mt-3 text-sm text-slate-700">{body}</div>
      {error ? <p className="mt-2 text-sm text-rose-600">{error}</p> : null}
      <div className="mt-5 flex justify-end gap-2">
        {ready ? (
          <button className="btn-primary" onClick={() => void install()} disabled={installing}>
            {installing ? "Restarting…" : "Restart and update"}
          </button>
        ) : status.state === "error" || status.state === "none" ? (
          <button className="btn-secondary" onClick={() => void checkAgain()} disabled={checking}>
            {checking ? "Checking…" : "Try again now"}
          </button>
        ) : null}
      </div>
    </RequiredScreen>
  );
}

function BrowserUpdateRequired() {
  return (
    <RequiredScreen>
      <h2 id="update-required-title" className="text-lg font-semibold tracking-tight text-slate-900">
        Update required
      </h2>
      <p className="mt-2 text-sm text-slate-600">A newer version of the app is available. Reload the page to use it.</p>
      <div className="mt-5 flex justify-end">
        <button className="btn-primary" onClick={() => window.location.reload()}>
          Reload
        </button>
      </div>
    </RequiredScreen>
  );
}
