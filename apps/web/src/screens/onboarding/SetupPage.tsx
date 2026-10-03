import { Link, useNavigate } from "@tanstack/react-router";
import { useMutation } from "@tanstack/react-query";
import { COMPOSITION_CATEGORY_LABELS, GST_STATES } from "@pos/contracts";
import { FormEvent, useState } from "react";
import { api, apiErrorMessage } from "../../lib/api";
import { desktop } from "../../lib/desktop";
import { rememberBusinessCode } from "../../lib/business-code";
import { setSession, type Session } from "../../lib/session";
import { ErrorNote, OnboardingShell } from "./OnboardingShell";
import { RecoveryCodeCard } from "../../components/RecoveryCode";
import { EmailCodeField } from "../../components/EmailCodeField";

type CompositionCategory = keyof typeof COMPOSITION_CATEGORY_LABELS;

/** The zone this computer is set to; report periods (Today, This Month) use it. */
function localTimeZone() {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "Asia/Kolkata";
  } catch {
    return "Asia/Kolkata";
  }
}

type Created = { session: Session; code: string; name: string; server: string };

/**
 * A new business: its details and the admin account.
 * - Offline (one counter): first run of the local API, which accepts it only while it has no users.
 * - Online (desktop app, first launch): also the owner's account; the server creates the
 *   business and answers its code, which staff need on every other computer.
 */
export function SetupPage({ online = false }: { online?: boolean }) {
  const navigate = useNavigate();
  const defaultServer = desktop?.config.defaultServerUrl ?? null;
  const [server, setServer] = useState("");
  const [ownerEmail, setOwnerEmail] = useState("");
  const [ownerPassword, setOwnerPassword] = useState("");
  const [created, setCreated] = useState<Created | null>(null);
  const [switching, setSwitching] = useState(false);
  const [recoveryCode, setRecoveryCode] = useState<string | null>(null);
  // Online: set when the server emailed a code to verify the owner's address.
  const [codeMessage, setCodeMessage] = useState<string | null>(null);
  const [emailCode, setEmailCode] = useState("");
  const [savedCode, setSavedCode] = useState(false);
  const [businessName, setBusinessName] = useState("");
  const [gstNumber, setGstNumber] = useState("");
  const [stateCode, setStateCode] = useState("");
  const [composition, setComposition] = useState(false);
  const [category, setCategory] = useState<CompositionCategory>("TRADER");
  const [branchCode, setBranchCode] = useState("MAI");
  const [adminUsername, setAdminUsername] = useState("admin");
  const [adminPassword, setAdminPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");

  const gstin = gstNumber.trim().toUpperCase();
  const stateFromGstin = gstin.length >= 2 ? gstin.slice(0, 2) : "";

  const details = () => ({
    businessName,
    gstNumber: gstin || null,
    stateCode: gstin ? null : stateCode || null,
    timezone: localTimeZone(),
    taxpayerType: composition ? ("COMPOSITION" as const) : ("REGULAR" as const),
    compositionCategory: composition ? category : null,
    branchCode,
    adminUsername,
    adminPassword,
  });

  /**
   * Online: the server (checked by the desktop app) creates the business. null when it emailed
   * a code to verify the owner's address first (`withCode` false sends a new one).
   */
  const createOnline = async (withCode: boolean): Promise<Created | null> => {
    if (!desktop) throw new Error("Creating an online business needs the desktop app.");
    const created = await desktop.createOnlineBusiness(server, {
      ...details(),
      ownerEmail,
      ownerPassword,
      ...(withCode && emailCode ? { emailCode } : {}),
    });
    if (created.emailCodeRequired) {
      setCodeMessage(created.message);
      setEmailCode("");
      return null;
    }
    return { session: created.session as Session, code: created.business.code, name: created.business.name, server: created.server };
  };

  const setup = useMutation({
    mutationFn: async (withCode: boolean = true) => {
      if (adminPassword !== confirmPassword) throw new Error("The two passwords don't match.");
      if (online) return createOnline(withCode);
      const res = await api.setup.run({
        body: {
          businessName,
          gstNumber: gstin || null,
          stateCode: gstin ? null : stateCode || null,
          timezone: localTimeZone(),
          taxpayerType: composition ? "COMPOSITION" : "REGULAR",
          compositionCategory: composition ? category : null,
          branchCode,
          adminUsername,
          adminPassword,
        },
      });
      if (res.status === 409) throw new Error(apiErrorMessage(res.body, "This business is already set up. Sign in instead."));
      if (res.status !== 201) throw new Error(apiErrorMessage(res.body, "Setup failed. Check the details and try again."));
      return res.body;
    },
  });

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    const result = await setup.mutateAsync(true).catch(() => null);
    if (!result) return;
    if ("code" in result) {
      setSession(result.session);
      rememberBusinessCode(result.code);
      setCreated(result);
      return;
    }
    setSession(result);
    // Offline: the recovery code is shown once, before anything else.
    if (result.recoveryCode) {
      setRecoveryCode(result.recoveryCode);
      return;
    }
    navigate({ to: "/open-register" });
  };

  /** Online: from now on the app works with the server; it reloads straight into the business. */
  const continueOnline = async () => {
    if (!created || !desktop) return;
    setSwitching(true);
    await desktop.chooseMode({ mode: "online", apiBaseUrl: created.server });
  };

  if (recoveryCode) {
    return (
      <OnboardingShell title="Save your recovery code" subtitle="Your business is ready. One more thing before you start.">
        <RecoveryCodeCard code={recoveryCode} />
        <label className="mt-5 flex items-center gap-2 text-sm text-slate-700">
          <input type="checkbox" checked={savedCode} onChange={(e) => setSavedCode(e.target.checked)} />
          I've written it down or saved it somewhere safe.
        </label>
        <div className="mt-4 flex justify-end">
          <button className="btn-primary h-10 px-5" onClick={() => navigate({ to: "/open-register" })} disabled={!savedCode}>
            Continue
          </button>
        </div>
      </OnboardingShell>
    );
  }

  if (created) {
    return (
      <OnboardingShell title={`${created.name} is ready`} subtitle="Your business is online. Every counter and branch signs in to it.">
        <BusinessCodeCard code={created.code} />
        <div className="mt-6 flex justify-end">
          <button className="btn-primary h-10 px-5" onClick={() => void continueOnline()} disabled={switching}>
            {switching ? "Opening…" : "Continue"}
          </button>
        </div>
      </OnboardingShell>
    );
  }

  return (
    <OnboardingShell
      title={online ? "Create your online business" : "Set up your business"}
      subtitle="These details appear on your invoices. You can change them later in Settings."
    >
      <form onSubmit={onSubmit} className="grid gap-6">
        {online ? (
          <section className="card grid gap-4 p-5">
            <p className="eyebrow">Owner account</p>
            <p className="-mt-2 text-sm text-slate-600">
              Yours, as the owner: you use it to create businesses or move one online. Already have one? Use the same email
              and password (
              <Link to="/owner-password" search={ownerEmail ? { email: ownerEmail } : {}} className="underline hover:text-slate-900">
                forgot it?
              </Link>
              ).
            </p>
            {defaultServer ? null : (
              <div>
                <label className="field-label" htmlFor="setup-server">Server address</label>
                <input id="setup-server" className="field h-10" value={server} onChange={(e) => setServer(e.target.value)} placeholder="https://pos.example.com" inputMode="url" required />
              </div>
            )}
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <label className="field-label" htmlFor="setup-owner-email">Email</label>
                <input
                id="setup-owner-email"
                className="field h-10"
                type="email"
                value={ownerEmail}
                onChange={(e) => {
                  setOwnerEmail(e.target.value);
                  // A code goes with the address it was sent to.
                  setCodeMessage(null);
                }}
                autoComplete="email"
                required
              />
              </div>
              <div>
                <label className="field-label" htmlFor="setup-owner-password">Password</label>
                <input id="setup-owner-password" className="field h-10" type="password" value={ownerPassword} onChange={(e) => setOwnerPassword(e.target.value)} autoComplete="new-password" minLength={8} maxLength={128} required />
              </div>
            </div>
            {codeMessage ? (
              <EmailCodeField
                id="setup-email-code"
                message={codeMessage}
                value={emailCode}
                onChange={setEmailCode}
                onResend={() => void setup.mutateAsync(false).catch(() => null)}
                disabled={setup.isPending}
              />
            ) : null}
          </section>
        ) : null}
        <section className="card grid gap-4 p-5">
          <p className="eyebrow">Business</p>
          <div>
            <label className="field-label" htmlFor="setup-name">Business name</label>
            <input id="setup-name" className="field h-10" value={businessName} onChange={(e) => setBusinessName(e.target.value)} maxLength={120} required autoFocus />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className="field-label" htmlFor="setup-gstin">GSTIN (optional)</label>
              <input
                id="setup-gstin"
                className="field h-10 font-mono uppercase"
                value={gstNumber}
                onChange={(e) => setGstNumber(e.target.value)}
                maxLength={15}
                placeholder="29ABCDE1234F1ZW"
              />
            </div>
            <div>
              <label className="field-label" htmlFor="setup-state">State</label>
              <select
                id="setup-state"
                className="field h-10"
                value={gstin ? stateFromGstin : stateCode}
                onChange={(e) => setStateCode(e.target.value)}
                disabled={!!gstin}
              >
                <option value="">Not set</option>
                {GST_STATES.map((state) => (
                  <option key={state.code} value={state.code}>{state.code} · {state.name}</option>
                ))}
              </select>
              {gstin ? <p className="mt-1 text-xs text-slate-500">Taken from the GSTIN.</p> : null}
            </div>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className="field-label" htmlFor="setup-taxpayer">GST registration</label>
              <select
                id="setup-taxpayer"
                className="field h-10"
                value={composition ? "COMPOSITION" : "REGULAR"}
                onChange={(e) => setComposition(e.target.value === "COMPOSITION")}
              >
                <option value="REGULAR">Regular</option>
                <option value="COMPOSITION">Composition</option>
              </select>
            </div>
            {composition ? (
              <div>
                <label className="field-label" htmlFor="setup-category">Composition category</label>
                <select id="setup-category" className="field h-10" value={category} onChange={(e) => setCategory(e.target.value as CompositionCategory)}>
                  {Object.entries(COMPOSITION_CATEGORY_LABELS).map(([value, label]) => (
                    <option key={value} value={value}>{label}</option>
                  ))}
                </select>
              </div>
            ) : null}
          </div>
          <div className="sm:max-w-[50%]">
            <label className="field-label" htmlFor="setup-code">Invoice code</label>
            <input
              id="setup-code"
              className="field h-10 font-mono uppercase"
              value={branchCode}
              onChange={(e) => setBranchCode(e.target.value.toUpperCase())}
              minLength={3}
              maxLength={3}
              required
            />
            <p className="mt-1 text-xs text-slate-500">3 letters or digits. Every invoice number starts with it.</p>
          </div>
        </section>

        <section className="card grid gap-4 p-5">
          <p className="eyebrow">Administrator</p>
          <p className="-mt-2 text-sm text-slate-600">The account you'll sign in with. Admins add cashiers in Settings.</p>
          <div className="sm:max-w-[50%]">
            <label className="field-label" htmlFor="setup-username">Username</label>
            <input id="setup-username" className="field h-10" value={adminUsername} onChange={(e) => setAdminUsername(e.target.value)} autoComplete="username" maxLength={64} required />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className="field-label" htmlFor="setup-password">Password</label>
              <input id="setup-password" className="field h-10" type="password" value={adminPassword} onChange={(e) => setAdminPassword(e.target.value)} autoComplete="new-password" minLength={8} maxLength={128} required />
              <p className="mt-1 text-xs text-slate-500">At least 8 characters.</p>
            </div>
            <div>
              <label className="field-label" htmlFor="setup-confirm">Confirm password</label>
              <input id="setup-confirm" className="field h-10" type="password" value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} autoComplete="new-password" required />
            </div>
          </div>
        </section>

        {setup.error ? <ErrorNote message={(setup.error as Error).message} /> : null}

        <div className="flex justify-end">
          <button className="btn-primary h-10 px-5" type="submit" disabled={setup.isPending}>
            {setup.isPending ? (online ? "Creating your business…" : "Setting up…") : "Create business"}
          </button>
        </div>
      </form>
    </OnboardingShell>
  );
}

/** The code staff type on every other computer, shown big enough to read out. */
export function BusinessCodeCard({ code }: { code: string }) {
  return (
    <div className="card p-6 text-center">
      <p className="text-sm text-slate-600">Business code</p>
      <p className="mt-2 font-mono text-4xl font-semibold tracking-[0.3em] text-slate-900">{code}</p>
      <p className="mt-3 text-sm text-slate-600">
        Write it down. On another computer, choose <span className="font-medium">Join an existing business</span> and enter it
        with a username and password.
      </p>
    </div>
  );
}
