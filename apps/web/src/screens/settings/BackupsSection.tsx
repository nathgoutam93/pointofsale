import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import type { BackupEntry, DesktopBackups } from "../../lib/desktop";
import { getSession } from "../../lib/session";

const REASON_LABELS: Record<BackupEntry["reason"], string> = {
  daily: "Daily",
  manual: "Made by hand",
  "before-update": "Before an app update",
  "before-restore": "Before a restore",
};

const DAY_CHOICES = [2, 3, 4, 5];

const formatWhen = (iso: string) =>
  new Date(iso).toLocaleString("en-IN", { weekday: "short", day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });

const formatSize = (bytes: number) => (bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`);

/**
 * Desktop app, offline mode: the backups kept on this computer. A backup is made every day
 * and before each app update; the owner picks how many days to keep and can restore one.
 */
export function BackupsSection({ backups }: { backups: DesktopBackups }) {
  const queryClient = useQueryClient();
  const token = getSession()?.token ?? "";
  const [message, setMessage] = useState("");
  const [restoring, setRestoring] = useState<BackupEntry | null>(null);

  const list = useQuery({ queryKey: ["desktop-backups"], queryFn: () => backups.list(token) });
  const refresh = () => queryClient.invalidateQueries({ queryKey: ["desktop-backups"] });

  const setDays = useMutation({
    mutationFn: (days: number) => backups.setDays(token, days),
    onSuccess: (days) => {
      setMessage(`Backups from the last ${days} days are kept.`);
      void refresh();
    },
  });
  const create = useMutation({
    mutationFn: () => backups.create(token),
    onSuccess: () => {
      setMessage("Backup made.");
      void refresh();
    },
  });
  // On success the app reloads at the sign-in screen, so there is nothing to do afterwards.
  const restore = useMutation({ mutationFn: (file: string) => backups.restore(token, file) });

  const error = (list.error ?? setDays.error ?? create.error ?? restore.error) as Error | null;
  const days = setDays.isPending ? setDays.variables : list.data?.days;

  return (
    <div className="grid gap-4">
      <div className="card p-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="max-w-xl">
            <h2 className="text-lg font-semibold tracking-tight text-slate-900">Backups</h2>
            <p className="mt-1 text-sm text-slate-600">
              A copy of the whole business (sales, stock, items, customers, settings and images) is made every day and
              before each app update, while you keep working. They are kept on this computer; copy the backups folder to
              a USB drive or a cloud folder now and then, in case the computer itself is lost.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button className="btn-secondary" onClick={() => void backups.openFolder(token)}>
              Open backups folder
            </button>
            <button className="btn-primary" onClick={() => create.mutate()} disabled={create.isPending || restore.isPending}>
              {create.isPending ? "Backing up…" : "Back up now"}
            </button>
          </div>
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-3">
          <label className="text-sm font-medium text-slate-700" htmlFor="backup-days">
            Keep backups for
          </label>
          <select
            id="backup-days"
            className="field w-auto"
            value={days ?? ""}
            onChange={(e) => setDays.mutate(Number(e.target.value))}
            disabled={!list.data || setDays.isPending}
          >
            {DAY_CHOICES.map((choice) => (
              <option key={choice} value={choice}>
                {choice} days
              </option>
            ))}
          </select>
          <span className="text-xs text-slate-500">Older backups are deleted; the newest one is always kept.</span>
        </div>

        {message && !error ? <p className="mt-3 text-sm text-emerald-700" role="status">{message}</p> : null}
        {error ? (
          <p className="mt-3 rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700" role="alert">
            {error.message}
          </p>
        ) : null}
      </div>

      <div className="card overflow-hidden">
        <div className="border-b border-slate-200 px-5 py-3">
          <h3 className="text-sm font-semibold text-slate-900">On this computer</h3>
        </div>
        {list.isLoading ? (
          <p className="p-5 text-sm text-slate-500">Loading backups…</p>
        ) : (list.data?.backups.length ?? 0) === 0 ? (
          <p className="p-5 text-sm text-slate-500">No backups yet. The first one is made today.</p>
        ) : (
          <ul className="divide-y divide-slate-100">
            {list.data!.backups.map((backup) => (
              <li key={backup.file} className="flex flex-wrap items-center justify-between gap-3 px-5 py-3">
                <div>
                  <p className="text-sm font-semibold text-slate-900">{formatWhen(backup.createdAt)}</p>
                  <p className="text-xs text-slate-500">
                    {REASON_LABELS[backup.reason]} · {formatSize(backup.bytes)}
                  </p>
                </div>
                <button className="btn-secondary py-1.5" onClick={() => setRestoring(backup)} disabled={restore.isPending}>
                  Restore
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {restoring ? (
        <div className="modal-backdrop" onClick={() => !restore.isPending && setRestoring(null)}>
          <div
            className="w-full max-w-md rounded-lg bg-white p-6 shadow-xl"
            role="dialog"
            aria-modal="true"
            aria-labelledby="restore-title"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 id="restore-title" className="text-lg font-semibold tracking-tight text-slate-900">
              Restore the backup from {formatWhen(restoring.createdAt)}?
            </h2>
            <p className="mt-3 text-sm text-slate-600">
              The business goes back to how it was then. Sales, stock changes, items and anything else changed since are
              replaced. A backup of the business as it is now is made first, so this can be undone.
            </p>
            <p className="mt-2 text-sm text-slate-600">Everyone is signed out; sign in again afterwards.</p>
            {restore.error ? <p className="mt-3 text-sm text-rose-600">{(restore.error as Error).message}</p> : null}
            <div className="mt-5 flex gap-2">
              <button className="btn-secondary flex-1" onClick={() => setRestoring(null)} disabled={restore.isPending}>
                Cancel
              </button>
              <button className="btn-danger flex-1" onClick={() => restore.mutate(restoring.file)} disabled={restore.isPending}>
                {restore.isPending ? "Restoring…" : "Restore"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
