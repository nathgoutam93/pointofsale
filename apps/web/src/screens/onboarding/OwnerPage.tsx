import { Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { FormEvent, useState } from "react";
import { api, apiErrorMessage } from "../../lib/api";
import { useServerMode } from "../../lib/mode";
import { ErrorNote, OnboardingShell } from "./OnboardingShell";

type Owner = { token: string; email: string; businesses: Array<{ id: string; code: string; name: string; status: string }> };

/**
 * Online: the owner account's own screen. The owner signs in with the email and password that
 * created the business (or moved it online), sees each of their businesses' staff, gives anyone
 * a new password, and turns staff off or on. The owner token lives only in this page.
 */
export function OwnerPage() {
  const mode = useServerMode();
  const [owner, setOwner] = useState<Owner | null>(null);
  if (mode === null) return null;
  if (mode !== "online") {
    return (
      <OnboardingShell title="Owner" subtitle="This business runs on this computer only: manage staff in Settings → Cashiers & Access.">
        <Link to="/" className="btn-primary h-10 px-5">Back to sign in</Link>
      </OnboardingShell>
    );
  }
  return owner ? <OwnerStaff owner={owner} onSignOut={() => setOwner(null)} /> : <OwnerSignIn onSignedIn={setOwner} />;
}

function OwnerSignIn({ onSignedIn }: { onSignedIn: (owner: Owner) => void }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const signIn = useMutation({
    mutationFn: async () => {
      const res = await api.accounts.login({ body: { email, password } });
      if (res.status !== 200) throw new Error(apiErrorMessage(res.body, "That owner email and password don't match."));
      return { token: res.body.token, email, businesses: res.body.businesses };
    },
    onSuccess: onSignedIn,
  });
  return (
    <OnboardingShell title="Business owner" subtitle="Sign in with the owner account to see your businesses' staff, give anyone a new password, or turn staff off.">
      <form
        className="card grid gap-4 p-5"
        onSubmit={(e: FormEvent) => {
          e.preventDefault();
          signIn.mutate();
        }}
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label className="field-label" htmlFor="owner-email">Owner email</label>
            <input id="owner-email" className="field h-10" type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" required autoFocus />
          </div>
          <div>
            <label className="field-label" htmlFor="owner-password">Owner password</label>
            <input id="owner-password" className="field h-10" type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" required />
            <Link to="/owner-password" search={email ? { email } : {}} className="mt-1 inline-block text-xs text-slate-600 hover:text-slate-900">
              Forgot the owner password?
            </Link>
          </div>
        </div>
        {signIn.error ? <ErrorNote message={(signIn.error as Error).message} /> : null}
        <div className="flex items-center justify-between gap-3">
          <Link to="/" className="btn-ghost">Back to sign in</Link>
          <button className="btn-primary h-10 px-5" type="submit" disabled={signIn.isPending}>
            {signIn.isPending ? "Signing in…" : "Sign in"}
          </button>
        </div>
      </form>
    </OnboardingShell>
  );
}

function OwnerStaff({ owner, onSignOut }: { owner: Owner; onSignOut: () => void }) {
  const queryClient = useQueryClient();
  const usable = owner.businesses.filter((business) => business.status === "ACTIVE");
  const [businessId, setBusinessId] = useState(usable[0]?.id ?? "");
  const [resetting, setResetting] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const auth = { Authorization: `Bearer ${owner.token}` };
  const business = owner.businesses.find((candidate) => candidate.id === businessId);

  const staff = useQuery({
    queryKey: ["owner-staff", businessId],
    enabled: !!businessId,
    queryFn: async () => {
      const res = await api.accounts.staff({ params: { businessId }, extraHeaders: auth });
      if (res.status !== 200) throw new Error(apiErrorMessage(res.body, "Couldn't load the staff."));
      return res.body;
    },
  });

  const setActive = useMutation({
    mutationFn: async (input: { username: string; isActive: boolean }) => {
      const res = await api.accounts.staffActive({ body: { businessId, ...input }, extraHeaders: auth });
      if (res.status !== 200) throw new Error(apiErrorMessage(res.body, "That couldn't be changed."));
      return res.body;
    },
    onSuccess: (result) => {
      setMessage(result.isActive ? `${result.username} can sign in again.` : `${result.username} is turned off and signed out everywhere.`);
      void queryClient.invalidateQueries({ queryKey: ["owner-staff", businessId] });
    },
  });

  return (
    <OnboardingShell title="Your businesses' staff" subtitle={`Signed in as ${owner.email}.`}>
      <div className="grid gap-4">
        <div className="flex flex-wrap items-end justify-between gap-3">
          {owner.businesses.length > 1 ? (
            <div>
              <label className="field-label" htmlFor="owner-business">Business</label>
              <select
                id="owner-business"
                className="field h-10"
                value={businessId}
                onChange={(e) => {
                  setBusinessId(e.target.value);
                  setResetting(null);
                  setMessage("");
                }}
              >
                {owner.businesses.map((candidate) => (
                  <option key={candidate.id} value={candidate.id} disabled={candidate.status !== "ACTIVE"}>
                    {candidate.name} ({candidate.code}){candidate.status !== "ACTIVE" ? " · not active" : ""}
                  </option>
                ))}
              </select>
            </div>
          ) : business ? (
            <p className="text-sm text-slate-700">
              <span className="font-semibold text-slate-900">{business.name}</span> · business code <span className="font-mono">{business.code}</span>
            </p>
          ) : (
            <p className="text-sm text-slate-600">This owner account has no active business.</p>
          )}
          <button className="btn-secondary" type="button" onClick={onSignOut}>Sign out</button>
        </div>

        {message ? <p className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800" role="status">{message}</p> : null}
        {setActive.error ? <ErrorNote message={(setActive.error as Error).message} /> : null}

        {staff.isLoading ? (
          <p className="text-sm text-slate-500">Loading…</p>
        ) : staff.error ? (
          <ErrorNote message={(staff.error as Error).message} />
        ) : (
          <div className="card divide-y divide-slate-100">
            {(staff.data ?? []).map((user) => (
              <div key={user.id} className="p-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="font-semibold text-slate-900">
                      {user.username}{" "}
                      <span className={`badge ring-1 ring-inset ${user.role === "ADMIN" ? "bg-brand-50 text-brand-700 ring-brand-200" : "bg-slate-100 text-slate-600 ring-slate-200"}`}>
                        {user.role === "ADMIN" ? "Admin" : "Cashier"}
                      </span>{" "}
                      {user.isActive ? null : <span className="badge bg-rose-50 text-rose-700 ring-1 ring-rose-200 ring-inset">Off</span>}
                    </p>
                    <p className="mt-0.5 text-xs text-slate-500">
                      {user.branchName}
                      {user.branchCount > 1 ? ` and ${user.branchCount - 1} more ${user.branchCount === 2 ? "branch" : "branches"}` : ""}
                      {user.mustChangePassword ? " · chooses a new password at next sign-in" : ""}
                    </p>
                  </div>
                  <div className="flex gap-2">
                    <button className="btn-secondary" type="button" onClick={() => setResetting(resetting === user.username ? null : user.username)}>
                      New password
                    </button>
                    <button
                      className={user.isActive ? "btn-ghost text-rose-700" : "btn-secondary"}
                      type="button"
                      disabled={setActive.isPending}
                      onClick={() => {
                        if (user.isActive && !window.confirm(`Turn ${user.username} off? They are signed out everywhere and can't sign in until you turn them on again.`)) return;
                        setMessage("");
                        setActive.mutate({ username: user.username, isActive: !user.isActive });
                      }}
                    >
                      {user.isActive ? "Turn off" : "Turn on"}
                    </button>
                  </div>
                </div>
                {resetting === user.username ? (
                  <NewPasswordForm
                    businessId={businessId}
                    username={user.username}
                    isAdmin={user.role === "ADMIN"}
                    auth={auth}
                    onDone={(text) => {
                      setResetting(null);
                      setMessage(text);
                      void queryClient.invalidateQueries({ queryKey: ["owner-staff", businessId] });
                    }}
                  />
                ) : null}
              </div>
            ))}
          </div>
        )}
        <p className="text-xs text-slate-500">
          Adding staff, their branches and what cashiers may do stay with the business's admins (Settings → Cashiers & Access).
        </p>
      </div>
    </OnboardingShell>
  );
}

function NewPasswordForm({
  businessId,
  username,
  isAdmin,
  auth,
  onDone,
}: {
  businessId: string;
  username: string;
  isAdmin: boolean;
  auth: Record<string, string>;
  onDone: (message: string) => void;
}) {
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const save = useMutation({
    mutationFn: async () => {
      if (password !== confirm) throw new Error("The two passwords don't match.");
      const res = await api.accounts.staffPassword({ body: { businessId, username, newPassword: password }, extraHeaders: auth });
      if (res.status !== 200) throw new Error(apiErrorMessage(res.body, "The password couldn't be changed."));
      return res.body.username;
    },
    onSuccess: (name) =>
      onDone(isAdmin ? `${name} has the new password, and is signed out everywhere.` : `${name} signs in with the new password, then chooses their own.`),
  });
  return (
    <form
      className="mt-3 grid gap-3 rounded-md bg-slate-50 p-3 sm:grid-cols-[1fr_1fr_auto]"
      onSubmit={(e: FormEvent) => {
        e.preventDefault();
        save.mutate();
      }}
    >
      <input className="field h-10" type="password" placeholder="New password" aria-label={`New password for ${username}`} value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" minLength={8} maxLength={128} required autoFocus />
      <input className="field h-10" type="password" placeholder="Confirm" aria-label="Confirm the new password" value={confirm} onChange={(e) => setConfirm(e.target.value)} autoComplete="new-password" required />
      <button className="btn-primary h-10 px-4" type="submit" disabled={save.isPending}>
        {save.isPending ? "Saving…" : "Save"}
      </button>
      {save.error ? (
        <div className="sm:col-span-3">
          <ErrorNote message={(save.error as Error).message} />
        </div>
      ) : null}
    </form>
  );
}
