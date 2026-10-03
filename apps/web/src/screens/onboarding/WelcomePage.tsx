import { useMutation } from "@tanstack/react-query";
import { FormEvent, useState } from "react";
import { desktop, type ModeChoice } from "../../lib/desktop";
import { clearSession } from "../../lib/session";
import { ErrorNote, OnboardingShell } from "./OnboardingShell";

type Choice = "offline" | "online";

const OPTIONS: Array<{ value: Choice; title: string; body: string }> = [
  {
    value: "offline",
    title: "One shop, one billing counter",
    body: "Works without internet. Everything is kept on this computer. If you add counters or branches later, you can move the business online in one step.",
  },
  {
    value: "online",
    title: "More than one counter or branch",
    body: "Needs an internet connection and an online account. Every counter and branch works on the same business.",
  },
];

/** Desktop app, first launch: pick a business type. The app restarts into the chosen mode. */
export function WelcomePage() {
  const [choice, setChoice] = useState<Choice>("offline");
  const [serverUrl, setServerUrl] = useState("");

  const start = useMutation({
    mutationFn: async (picked: ModeChoice) => {
      if (!desktop) throw new Error("This screen only works in the desktop app.");
      clearSession();
      // The window reloads once this resolves; until then the button stays busy.
      await desktop.chooseMode(picked);
    },
  });

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    start.mutate(choice === "offline" ? { mode: "offline" } : { mode: "online", apiBaseUrl: serverUrl.trim() });
  };

  return (
    <OnboardingShell title="Welcome" subtitle="How many billing counters does your business have?">
      <form onSubmit={onSubmit} className="grid gap-4">
        <div className="grid gap-3" role="radiogroup" aria-label="Business type">
          {OPTIONS.map((option) => {
            const selected = choice === option.value;
            return (
              <label
                key={option.value}
                className={`card flex cursor-pointer gap-3 p-4 transition-colors ${selected ? "border-brand-500 ring-1 ring-brand-500" : "hover:border-slate-300"}`}
              >
                <input
                  type="radio"
                  name="business-type"
                  className="mt-1"
                  checked={selected}
                  onChange={() => setChoice(option.value)}
                />
                <span>
                  <span className="block font-medium text-slate-900">{option.title}</span>
                  <span className="mt-1 block text-sm text-slate-600">{option.body}</span>
                </span>
              </label>
            );
          })}
        </div>

        {choice === "online" ? (
          <div className="card grid gap-3 p-4">
            <p className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
              You'll need an internet connection whenever you use the app.
            </p>
            <div>
              <label className="field-label" htmlFor="server-url">Server address</label>
              <input
                id="server-url"
                className="field h-10"
                value={serverUrl}
                onChange={(e) => setServerUrl(e.target.value)}
                placeholder="https://pos.example.com"
                inputMode="url"
                autoComplete="url"
                required
              />
              <p className="mt-1 text-xs text-slate-500">Your administrator gives you this address.</p>
            </div>
          </div>
        ) : null}

        {start.error ? <ErrorNote message={(start.error as Error).message} /> : null}

        <div className="flex justify-end">
          <button className="btn-primary h-10 px-5" type="submit" disabled={start.isPending}>
            {start.isPending ? (choice === "offline" ? "Preparing this computer…" : "Connecting…") : "Continue"}
          </button>
        </div>
        {start.isPending && choice === "offline" ? (
          <p className="text-right text-xs text-slate-500">The first start takes up to a minute.</p>
        ) : null}
      </form>
    </OnboardingShell>
  );
}
