import { useSearch } from "@tanstack/react-router";
import { useMutation } from "@tanstack/react-query";
import { FormEvent, useState } from "react";
import { desktop } from "../../lib/desktop";
import { ownerPasswordReset } from "../../lib/owner-password";
import { ErrorNote, OnboardingShell } from "./OnboardingShell";

/**
 * "Forgot your owner password?": the email address, then the 8-digit code emailed to it and a
 * new password. The owner account is the one used to create businesses, move one online and
 * reset an admin's password; staff passwords are separate.
 */
export function OwnerPasswordPage() {
  // The server to ask, when the app doesn't already know one (no built-in server, not online yet).
  const askServer = !!desktop && desktop.config.mode !== "online" && !desktop.config.defaultServerUrl;
  const [server, setServer] = useState("");
  const search = useSearch({ from: "/owner-password" });
  const [email, setEmail] = useState(search.email ?? "");
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirm, setConfirm] = useState("");

  const request = useMutation({
    mutationFn: () => ownerPasswordReset("request", { email: email.trim() }, server),
    onSuccess: () => {
      setSentTo(email.trim());
      setCode("");
    },
  });
  const reset = useMutation({
    mutationFn: async () => {
      if (newPassword !== confirm) throw new Error("The two passwords don't match.");
      await ownerPasswordReset("confirm", { email: sentTo ?? "", code: code.trim(), newPassword }, server);
    },
  });

  const back = (
    <button type="button" className="btn-ghost" onClick={() => window.history.back()}>
      Back
    </button>
  );

  if (reset.isSuccess) {
    return (
      <OnboardingShell title="Owner password changed" subtitle="Use it from now on to create businesses, move one online or reset an admin's password.">
        <div className="card p-5 text-sm text-slate-600">
          Anywhere else the owner account was signed in has been signed out. Staff passwords haven't changed.
          <div className="mt-4 flex justify-end">{back}</div>
        </div>
      </OnboardingShell>
    );
  }

  if (sentTo) {
    return (
      <OnboardingShell title="Check your email" subtitle={`If ${sentTo} has an owner account, a code is on its way. It works for 15 minutes.`}>
        <form
          className="card grid gap-4 p-5"
          onSubmit={(e: FormEvent) => {
            e.preventDefault();
            reset.mutate();
          }}
        >
          <div className="sm:max-w-[50%]">
            <label className="field-label" htmlFor="owner-reset-code">Code from the email</label>
            <input id="owner-reset-code" className="field h-10 font-mono tracking-widest" value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 8))} inputMode="numeric" autoComplete="one-time-code" placeholder="12345678" required autoFocus />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className="field-label" htmlFor="owner-reset-password">New owner password</label>
              <input id="owner-reset-password" className="field h-10" type="password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} autoComplete="new-password" minLength={8} maxLength={128} required />
            </div>
            <div>
              <label className="field-label" htmlFor="owner-reset-confirm">Confirm new password</label>
              <input id="owner-reset-confirm" className="field h-10" type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} autoComplete="new-password" required />
            </div>
          </div>
          {reset.error ? <ErrorNote message={(reset.error as Error).message} /> : null}
          <div className="flex flex-wrap items-center justify-between gap-3">
            <button type="button" className="btn-ghost" onClick={() => request.mutate()} disabled={request.isPending}>
              {request.isPending ? "Sending…" : "Send a new code"}
            </button>
            <button className="btn-primary h-10 px-5" type="submit" disabled={reset.isPending || code.length !== 8}>
              {reset.isPending ? "Saving…" : "Set new password"}
            </button>
          </div>
          {request.error ? <ErrorNote message={(request.error as Error).message} /> : null}
        </form>
      </OnboardingShell>
    );
  }

  return (
    <OnboardingShell title="Reset your owner password" subtitle="The owner account's email gets a code to choose a new password.">
      <form
        className="card grid gap-4 p-5"
        onSubmit={(e: FormEvent) => {
          e.preventDefault();
          request.mutate();
        }}
      >
        {askServer ? (
          <div>
            <label className="field-label" htmlFor="owner-reset-server">Server address</label>
            <input id="owner-reset-server" className="field h-10" value={server} onChange={(e) => setServer(e.target.value)} placeholder="https://pos.example.com" inputMode="url" required />
          </div>
        ) : null}
        <div className="sm:max-w-[60%]">
          <label className="field-label" htmlFor="owner-reset-email">Owner email</label>
          <input id="owner-reset-email" className="field h-10" type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" required autoFocus />
        </div>
        {request.error ? <ErrorNote message={(request.error as Error).message} /> : null}
        <div className="flex flex-wrap items-center justify-between gap-3">
          {back}
          <button className="btn-primary h-10 px-5" type="submit" disabled={request.isPending}>
            {request.isPending ? "Sending…" : "Email me a code"}
          </button>
        </div>
      </form>
    </OnboardingShell>
  );
}
