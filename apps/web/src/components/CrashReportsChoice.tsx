import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { desktop } from "../lib/desktop";

const bridge = desktop?.crashReports ?? null;
const WHAT_IS_SENT =
  "Only what broke: the error, where in the app, the app version, mode and operating system. Never customers, sales, receipts or passwords.";

function useCrashReports() {
  const queryClient = useQueryClient();
  const status = useQuery({ queryKey: ["crash-reports"], enabled: !!bridge, queryFn: () => bridge!.status() });
  const set = useMutation({
    mutationFn: (enabled: boolean) => bridge!.set(enabled),
    onSuccess: (next) => queryClient.setQueryData(["crash-reports"], next),
  });
  return { status, set };
}

/** Desktop app, admins: asked once whether crash reports may be sent. */
export function CrashReportsPrompt() {
  const { status, set } = useCrashReports();
  if (!bridge || status.data?.enabled !== null || !status.data) return null;
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border-b border-sky-200 bg-sky-50 px-6 py-3 text-sm text-sky-900 print:hidden" role="status">
      <div className="max-w-3xl">
        <p className="font-semibold">Send crash reports to help us fix problems?</p>
        <p className="text-xs">{WHAT_IS_SENT} You can change this in Settings → Business.</p>
      </div>
      <div className="flex gap-2">
        <button className="btn-secondary" disabled={set.isPending} onClick={() => set.mutate(false)}>
          Don't send
        </button>
        <button className="btn-primary" disabled={set.isPending} onClick={() => set.mutate(true)}>
          Send reports
        </button>
      </div>
    </div>
  );
}

/** Desktop app, Settings → Business: the crash reports switch. */
export function CrashReportsSetting() {
  const { status, set } = useCrashReports();
  if (!bridge || !status.data) return null;
  const enabled = status.data.enabled === true;
  return (
    <div className="card flex flex-wrap items-center justify-between gap-3 p-5">
      <div className="max-w-xl">
        <h2 className="text-lg font-semibold tracking-tight text-slate-900">Crash reports</h2>
        <p className="mt-1 text-sm text-slate-600">{WHAT_IS_SENT}</p>
        <p className="mt-1 text-xs text-slate-500">
          {enabled
            ? "On: reports are sent when this computer has internet."
            : status.data.enabled === false
              ? "Off: nothing is sent."
              : `Not chosen yet${status.data.queued ? `: ${status.data.queued} waiting, sent only if you turn this on` : ""}.`}
        </p>
      </div>
      <button className={enabled ? "btn-secondary" : "btn-primary"} disabled={set.isPending} onClick={() => set.mutate(!enabled)}>
        {enabled ? "Turn off" : "Turn on"}
      </button>
    </div>
  );
}
