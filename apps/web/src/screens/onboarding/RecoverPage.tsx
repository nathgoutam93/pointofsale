import { Link } from "@tanstack/react-router";
import { useMutation } from "@tanstack/react-query";
import { FormEvent, useState } from "react";
import { RecoveryCodeCard } from "../../components/RecoveryCode";
import { api, apiErrorMessage } from "../../lib/api";
import { ErrorNote, OnboardingShell } from "./OnboardingShell";

/** Offline: "Forgot your password?" A recovery code resets an admin's password. */
export function RecoverPage() {
  const [recoveryCode, setRecoveryCode] = useState("");
  const [username, setUsername] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirm, setConfirm] = useState("");

  const recover = useMutation({
    mutationFn: async () => {
      if (newPassword !== confirm) throw new Error("The two passwords don't match.");
      const res = await api.auth.recover({ body: { recoveryCode, username, newPassword } });
      if (res.status !== 200) throw new Error(apiErrorMessage(res.body, "That didn't work. Check the code and the username."));
      return res.body.recoveryCode;
    },
  });

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    recover.mutate();
  };

  if (recover.data) {
    return (
      <OnboardingShell title="Password changed" subtitle="Sign in with the new password. The recovery code you used no longer works; here is its replacement.">
        <RecoveryCodeCard code={recover.data} />
        <div className="mt-6 flex justify-end">
          <Link to="/" className="btn-primary h-10 px-5">
            Sign in
          </Link>
        </div>
      </OnboardingShell>
    );
  }

  return (
    <OnboardingShell title="Reset an admin password" subtitle="With the recovery code you were given when the business was set up (or made later in Settings).">
      <form onSubmit={onSubmit} className="card grid gap-4 p-5">
        <div>
          <label className="field-label" htmlFor="recover-code">Recovery code</label>
          <input id="recover-code" className="field h-10 font-mono uppercase" value={recoveryCode} onChange={(e) => setRecoveryCode(e.target.value)} placeholder="XXXX-XXXX-XXXX-XXXX" autoComplete="off" required autoFocus />
        </div>
        <div className="sm:max-w-[50%]">
          <label className="field-label" htmlFor="recover-username">Admin username</label>
          <input id="recover-username" className="field h-10" value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="username" required />
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label className="field-label" htmlFor="recover-password">New password</label>
            <input id="recover-password" className="field h-10" type="password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} autoComplete="new-password" minLength={8} maxLength={128} required />
          </div>
          <div>
            <label className="field-label" htmlFor="recover-confirm">Confirm new password</label>
            <input id="recover-confirm" className="field h-10" type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} autoComplete="new-password" required />
          </div>
        </div>
        {recover.error ? <ErrorNote message={(recover.error as Error).message} /> : null}
        <div className="flex items-center justify-between gap-3">
          <Link to="/" className="text-sm text-slate-600 hover:text-slate-900">
            Back to sign in
          </Link>
          <button className="btn-primary h-10 px-5" type="submit" disabled={recover.isPending}>
            {recover.isPending ? "Resetting…" : "Reset password"}
          </button>
        </div>
      </form>
    </OnboardingShell>
  );
}
