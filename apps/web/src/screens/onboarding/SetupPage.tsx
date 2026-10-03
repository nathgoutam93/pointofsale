import { useNavigate } from "@tanstack/react-router";
import { useMutation } from "@tanstack/react-query";
import { COMPOSITION_CATEGORY_LABELS, GST_STATES } from "@pos/contracts";
import { FormEvent, useState } from "react";
import { api, apiErrorMessage } from "../../lib/api";
import { setSession } from "../../lib/session";
import { ErrorNote, OnboardingShell } from "./OnboardingShell";

type CompositionCategory = keyof typeof COMPOSITION_CATEGORY_LABELS;

/** The zone this computer is set to; report periods (Today, This Month) use it. */
function localTimeZone() {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "Asia/Kolkata";
  } catch {
    return "Asia/Kolkata";
  }
}

/**
 * First run of a single-counter business: the business details and the admin account.
 * The API accepts this only while it has no users, then signs the new admin in.
 */
export function SetupPage() {
  const navigate = useNavigate();
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

  const setup = useMutation({
    mutationFn: async () => {
      if (adminPassword !== confirmPassword) throw new Error("The two passwords don't match.");
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
    const session = await setup.mutateAsync().catch(() => null);
    if (!session) return;
    setSession(session);
    navigate({ to: "/open-register" });
  };

  return (
    <OnboardingShell title="Set up your business" subtitle="These details appear on your invoices. You can change them later in Settings.">
      <form onSubmit={onSubmit} className="grid gap-6">
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
            {setup.isPending ? "Setting up…" : "Create business"}
          </button>
        </div>
      </form>
    </OnboardingShell>
  );
}
