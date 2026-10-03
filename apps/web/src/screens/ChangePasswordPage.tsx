import { useNavigate } from "@tanstack/react-router";
import { useMutation } from "@tanstack/react-query";
import { FormEvent, type ReactNode, useState } from "react";
import { api, apiErrorMessage, authHeaders } from "../lib/api";
import { clearSession, getSession, updateSession } from "../lib/session";
import { ErrorNote, OnboardingShell } from "./onboarding/OnboardingShell";

/**
 * The signed-in user's own new password. Required before anything else when an admin (or the
 * owner) set it for them; otherwise reached from their name at the top of the screen.
 */
export function ChangePasswordPage() {
  const navigate = useNavigate();
  const required = !!getSession()?.mustChangePassword;
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirm, setConfirm] = useState("");

  const change = useMutation({
    mutationFn: async () => {
      if (newPassword !== confirm) throw new Error("The two new passwords don't match.");
      const res = await api.auth.changePassword({ body: { currentPassword, newPassword }, extraHeaders: authHeaders() });
      if (res.status !== 200) throw new Error(apiErrorMessage(res.body, "Your password couldn't be changed."));
      return res.body.token;
    },
    onSuccess: (token) => {
      // Other sessions ended; this one carries on with the new token.
      updateSession({ token, mustChangePassword: false });
      setCurrentPassword("");
      setNewPassword("");
      setConfirm("");
      if (required) navigate({ to: "/" });
    },
  });

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    change.mutate();
  };

  const form = (
    <form onSubmit={onSubmit} className="card grid gap-4 p-5">
      <div className="sm:max-w-[50%]">
        <label className="field-label" htmlFor="current-password">
          {required ? "Password you were given" : "Current password"}
        </label>
        <input id="current-password" className="field h-10" type="password" value={currentPassword} onChange={(e) => setCurrentPassword(e.target.value)} autoComplete="current-password" required autoFocus />
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label className="field-label" htmlFor="new-password">New password</label>
          <input id="new-password" className="field h-10" type="password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} autoComplete="new-password" minLength={8} maxLength={128} required />
          <p className="mt-1 text-xs text-slate-500">At least 8 characters.</p>
        </div>
        <div>
          <label className="field-label" htmlFor="confirm-password">Confirm new password</label>
          <input id="confirm-password" className="field h-10" type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} autoComplete="new-password" required />
        </div>
      </div>
      {change.error ? <ErrorNote message={(change.error as Error).message} /> : null}
      {change.isSuccess && !required ? (
        <p className="text-sm text-emerald-700" role="status">
          Password changed. Anywhere else you were signed in, you'll need to sign in again.
        </p>
      ) : null}
      <div className="flex flex-wrap items-center justify-end gap-3">
        {required ? (
          <button
            type="button"
            className="btn-ghost"
            onClick={() => {
              clearSession();
              window.location.href = "/";
            }}
          >
            Sign out
          </button>
        ) : null}
        <button className="btn-primary h-10 px-5" type="submit" disabled={change.isPending}>
          {change.isPending ? "Saving…" : "Change password"}
        </button>
      </div>
    </form>
  );

  if (required) {
    return (
      <OnboardingShell title="Choose your own password" subtitle="Your password was set for you. Choose a new one that only you know before you continue.">
        {form}
      </OnboardingShell>
    );
  }
  return <Frame>{form}</Frame>;
}

function Frame({ children }: { children: ReactNode }) {
  return (
    <section className="mx-auto grid max-w-2xl gap-4 p-6">
      <div>
        <h2 className="text-lg font-semibold tracking-tight text-slate-900">Change your password</h2>
        <p className="mt-1 text-sm text-slate-600">You stay signed in here; anywhere else you're signed in ends.</p>
      </div>
      {children}
    </section>
  );
}
