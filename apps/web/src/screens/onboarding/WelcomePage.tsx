import { useNavigate } from "@tanstack/react-router";
import { useMutation } from "@tanstack/react-query";
import { FormEvent, useState } from "react";
import { rememberBusinessCode } from "../../lib/business-code";
import { desktop } from "../../lib/desktop";
import { clearSession } from "../../lib/session";
import { ErrorNote, OnboardingShell } from "./OnboardingShell";

type Choice = "offline" | "create" | "join" | "restore";

const OPTIONS: Array<{ value: Choice; title: string; body: string }> = [
  {
    value: "offline",
    title: "One shop, one billing counter",
    body: "Works without internet. Everything is kept on this computer. If you add counters or branches later, you can move the business online in one step.",
  },
  {
    value: "create",
    title: "Create an online business",
    body: "For more than one counter or branch. Needs an internet connection; every counter and branch works on the same business.",
  },
  {
    value: "join",
    title: "Join an existing business",
    body: "Your business is already online and this is another counter or branch. You need its business code.",
  },
  {
    value: "restore",
    title: "Restore from a backup",
    body: "Bring back a business kept on a computer, from a backup file the app made (for example after replacing the computer).",
  },
];

/** Desktop app, first launch: how this computer will be used. */
export function WelcomePage() {
  const navigate = useNavigate();
  const defaultServer = desktop?.config.defaultServerUrl ?? null;
  const [choice, setChoice] = useState<Choice>("offline");
  const [server, setServer] = useState("");
  const [businessCode, setBusinessCode] = useState("");

  const start = useMutation({
    mutationFn: async () => {
      if (!desktop) throw new Error("This screen only works in the desktop app.");
      clearSession();
      if (choice === "restore") {
        // The app asks for the file, restores it and reloads at the sign-in screen.
        await desktop.restoreFromBackup();
        return;
      }
      if (choice === "offline") {
        // The window reloads into the setup screen once the local database is ready.
        await desktop.chooseMode({ mode: "offline" });
        return;
      }
      const apiBaseUrl = await desktop.checkServer(server);
      rememberBusinessCode(businessCode);
      // Reloads into the sign-in screen, with the business code filled in.
      await desktop.chooseMode({ mode: "online", apiBaseUrl });
    },
  });

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (choice === "create") {
      navigate({ to: "/create-business" });
      return;
    }
    start.mutate();
  };

  return (
    <OnboardingShell title="Welcome" subtitle="How will this computer be used?">
      <form onSubmit={onSubmit} className="grid gap-4">
        <div className="grid gap-3" role="radiogroup" aria-label="Business type">
          {OPTIONS.map((option) => {
            const selected = choice === option.value;
            return (
              <label
                key={option.value}
                className={`card flex cursor-pointer gap-3 p-4 transition-colors ${selected ? "border-brand-500 ring-1 ring-brand-500" : "hover:border-slate-300"}`}
              >
                <input type="radio" name="business-type" className="mt-1" checked={selected} onChange={() => setChoice(option.value)} />
                <span>
                  <span className="block font-medium text-slate-900">{option.title}</span>
                  <span className="mt-1 block text-sm text-slate-600">{option.body}</span>
                </span>
              </label>
            );
          })}
        </div>

        {choice === "join" ? (
          <div className="card grid gap-3 p-4">
            <div>
              <label className="field-label" htmlFor="join-code">Business code</label>
              <input
                id="join-code"
                className="field h-10 font-mono uppercase"
                value={businessCode}
                onChange={(e) => setBusinessCode(e.target.value)}
                maxLength={16}
                required
              />
              <p className="mt-1 text-xs text-slate-500">The owner or an admin has it. You sign in next.</p>
            </div>
            {defaultServer ? null : (
              <div>
                <label className="field-label" htmlFor="server-url">Server address</label>
                <input
                  id="server-url"
                  className="field h-10"
                  value={server}
                  onChange={(e) => setServer(e.target.value)}
                  placeholder="https://pos.example.com"
                  inputMode="url"
                  required
                />
              </div>
            )}
          </div>
        ) : null}

        {choice === "restore" ? (
          <p className="card p-4 text-sm text-slate-600">
            Backups are in the old computer's backups folder (Settings → Backups → Open backups folder), or wherever you copied
            them. Sign in afterwards with the usernames and passwords from then.
          </p>
        ) : null}

        {start.error ? <ErrorNote message={(start.error as Error).message} /> : null}

        <div className="flex justify-end">
          <button className="btn-primary h-10 px-5" type="submit" disabled={start.isPending}>
            {start.isPending
              ? choice === "offline"
                ? "Preparing this computer…"
                : choice === "restore"
                  ? "Restoring…"
                  : "Connecting…"
              : choice === "restore"
                ? "Choose backup file…"
                : "Continue"}
          </button>
        </div>
        {start.isPending && (choice === "offline" || choice === "restore") ? (
          <p className="text-right text-xs text-slate-500">This takes up to a minute.</p>
        ) : null}
      </form>
    </OnboardingShell>
  );
}
