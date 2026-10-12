import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useState } from "react";
import { api, apiErrorMessage, authHeaders } from "../lib/api";
import { useServerMode } from "../lib/mode";
import { getSession } from "../lib/session";

/** A recovery code shown once, with what it's for and a copy button. */
export function RecoveryCodeCard({ code }: { code: string }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  };
  return (
    <div className="card p-6 text-center">
      <p className="text-sm text-slate-600">Recovery code</p>
      <p className="mt-2 font-mono text-2xl font-semibold tracking-widest text-slate-900 select-all">{code}</p>
      <button type="button" className="btn-ghost mt-2" onClick={() => void copy()}>
        {copied ? "Copied" : "Copy"}
      </button>
      <p className="mt-3 text-sm text-slate-600">
        If an admin forgets their password, this code resets it ("Forgot your password?" on the sign-in screen). Write it
        down or keep it somewhere safe, away from this computer. It is shown only now.
      </p>
    </div>
  );
}

function useRecoveryStatus(enabled: boolean) {
  return useQuery({
    queryKey: ["recovery-code-status"],
    queryFn: async () => {
      const res = await api.auth.recoveryCodeStatus({ extraHeaders: authHeaders() });
      if (res.status !== 200) throw new Error("Failed to load the recovery code status");
      return res.body;
    },
    enabled,
  });
}

/** Settings (offline, admins): whether a recovery code exists, and a new one on request. */
export function RecoveryCodeSettings() {
  const queryClient = useQueryClient();
  const offline = useServerMode() === "offline";
  const admin = getSession()?.role === "ADMIN";
  const status = useRecoveryStatus(offline && admin);
  const [shown, setShown] = useState<string | null>(null);
  const create = useMutation({
    mutationFn: async () => {
      const res = await api.auth.newRecoveryCode({ body: {}, extraHeaders: authHeaders() });
      if (res.status !== 201) throw new Error(apiErrorMessage(res.body, "Couldn't create a recovery code"));
      return res.body.recoveryCode;
    },
    onSuccess: (code) => {
      setShown(code);
      void queryClient.invalidateQueries({ queryKey: ["recovery-code-status"] });
    },
  });
  if (!offline || !admin) return null;

  const onCreate = () => {
    if (status.data?.set && !window.confirm("Create a new recovery code? The current one stops working.")) return;
    create.mutate();
  };

  return (
    <div className="card p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="max-w-xl">
          <h2 className="text-lg font-semibold tracking-tight text-slate-900">Password recovery</h2>
          <p className="mt-1 text-sm text-slate-600">
            {status.data?.set
              ? `A recovery code was made on ${new Date(status.data.createdAt ?? "").toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" })}. It resets a forgotten admin password. Lost it? Make a new one.`
              : "There's no recovery code yet. Without one, a forgotten admin password can't be reset."}
          </p>
        </div>
        <button className={status.data?.set ? "btn-secondary" : "btn-primary"} onClick={onCreate} disabled={create.isPending || status.isLoading}>
          {status.data?.set ? "Make a new code" : "Make a recovery code"}
        </button>
      </div>
      {create.error ? <p className="mt-3 text-sm text-rose-700">{(create.error as Error).message}</p> : null}
      {shown ? (
        <div className="mt-4">
          <RecoveryCodeCard code={shown} />
        </div>
      ) : null}
    </div>
  );
}

/** Offline admins whose business has no recovery code (set up before codes existed): a reminder. */
export function RecoveryCodeNotice() {
  const offline = useServerMode() === "offline";
  const admin = getSession()?.role === "ADMIN";
  const status = useRecoveryStatus(offline && admin);
  if (!offline || !admin || !status.data || status.data.set) return null;
  return (
    <div className="border-b border-amber-200 bg-amber-50 px-6 py-3 text-sm text-amber-900 print:hidden" role="status">
      This business has no recovery code, so a forgotten admin password couldn't be reset.{" "}
      <Link to="/settings" className="font-semibold underline">
        Make one in Settings
      </Link>
      .
    </div>
  );
}
