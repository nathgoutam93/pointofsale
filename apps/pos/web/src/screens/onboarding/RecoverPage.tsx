import { Link } from "@tanstack/react-router";
import { useMutation } from "@tanstack/react-query";
import { FormEvent, useState } from "react";
import { RecoveryCodeCard } from "../../components/RecoveryCode";
import { api, apiErrorMessage } from "../../lib/api";
import { rememberedBusinessCode, rememberBusinessCode } from "../../lib/business-code";
import { useServerMode } from "../../lib/mode";
import { ErrorNote, OnboardingShell } from "./OnboardingShell";

/** "Forgot your password?" on the sign-in screen. */
export function RecoverPage() {
  const mode = useServerMode();
  if (mode === null) return null;
  return mode === "online" ? <OwnerResetsStaffPassword /> : <OfflineRecover />;
}

/**
 * Online: the business's owner signs in with the owner account and gives the admin (or anyone
 * else on the staff) a new password. Cashiers usually ask their admin instead.
 */
function OwnerResetsStaffPassword() {
  const [ownerEmail, setOwnerEmail] = useState("");
  const [ownerPassword, setOwnerPassword] = useState("");
  const [businessCode, setBusinessCode] = useState(rememberedBusinessCode);
  const [username, setUsername] = useState("admin");
  const [newPassword, setNewPassword] = useState("");
  const [confirm, setConfirm] = useState("");

  const reset = useMutation({
    mutationFn: async () => {
      if (newPassword !== confirm) throw new Error("The two passwords don't match.");
      const login = await api.accounts.login({ body: { email: ownerEmail, password: ownerPassword } });
      if (login.status !== 200) throw new Error(apiErrorMessage(login.body, "That owner email and password don't match."));
      const code = businessCode.trim().toUpperCase();
      const business = login.body.businesses.find((candidate) => candidate.code === code);
      if (!business) throw new Error(`${code || "That code"} isn't one of this owner account's businesses.`);
      const res = await api.accounts.staffPassword({
        body: { businessId: business.id, username: username.trim(), newPassword },
        extraHeaders: { Authorization: `Bearer ${login.body.token}` },
      });
      if (res.status !== 200) throw new Error(apiErrorMessage(res.body, "The password couldn't be changed."));
      rememberBusinessCode(code);
      return res.body.username;
    },
  });

  if (reset.data) {
    return (
      <OnboardingShell title="Password changed" subtitle={`${reset.data} can sign in with the new password now. Anywhere they were signed in has been signed out.`}>
        <div className="flex justify-end">
          <Link to="/" className="btn-primary h-10 px-5">
            Sign in
          </Link>
        </div>
      </OnboardingShell>
    );
  }

  return (
    <OnboardingShell title="Forgot your password?" subtitle="Cashiers: ask an admin to set a new one in Settings → Cashiers & Access. Admins: the business's owner can reset it here.">
      <form
        onSubmit={(e: FormEvent) => {
          e.preventDefault();
          reset.mutate();
        }}
        className="grid gap-4"
      >
        <section className="card grid gap-4 p-5">
          <p className="eyebrow">Owner account</p>
          <p className="-mt-2 text-sm text-slate-600">The email and password used to create the business or move it online.</p>
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className="field-label" htmlFor="owner-email">Owner email</label>
              <input id="owner-email" className="field h-10" type="email" value={ownerEmail} onChange={(e) => setOwnerEmail(e.target.value)} autoComplete="email" required autoFocus />
            </div>
            <div>
              <label className="field-label" htmlFor="owner-password">Owner password</label>
              <input id="owner-password" className="field h-10" type="password" value={ownerPassword} onChange={(e) => setOwnerPassword(e.target.value)} autoComplete="current-password" required />
              <Link to="/owner-password" search={ownerEmail ? { email: ownerEmail } : {}} className="mt-1 inline-block text-xs text-slate-600 hover:text-slate-900">
                Forgot the owner password?
              </Link>
            </div>
          </div>
        </section>
        <section className="card grid gap-4 p-5">
          <p className="eyebrow">Who gets a new password</p>
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className="field-label" htmlFor="staff-business">Business code</label>
              <input id="staff-business" className="field h-10 font-mono uppercase" value={businessCode} onChange={(e) => setBusinessCode(e.target.value)} maxLength={16} required />
            </div>
            <div>
              <label className="field-label" htmlFor="staff-username">Username</label>
              <input id="staff-username" className="field h-10" value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="off" required />
            </div>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className="field-label" htmlFor="staff-password">New password</label>
              <input id="staff-password" className="field h-10" type="password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} autoComplete="new-password" minLength={8} maxLength={128} required />
            </div>
            <div>
              <label className="field-label" htmlFor="staff-confirm">Confirm new password</label>
              <input id="staff-confirm" className="field h-10" type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} autoComplete="new-password" required />
            </div>
          </div>
          <p className="text-xs text-slate-500">An admin keeps this password. A cashier is asked to choose their own when they next sign in.</p>
        </section>
        {reset.error ? <ErrorNote message={(reset.error as Error).message} /> : null}
        <div className="flex items-center justify-between gap-3">
          <Link to="/" className="btn-ghost">
            Back to sign in
          </Link>
          <button className="btn-primary h-10 px-5" type="submit" disabled={reset.isPending}>
            {reset.isPending ? "Resetting…" : "Reset password"}
          </button>
        </div>
      </form>
    </OnboardingShell>
  );
}

/** Offline: a recovery code resets an admin's password. */
function OfflineRecover() {
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
