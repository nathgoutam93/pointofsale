import type { ReactNode } from "react";
import { IconStore } from "../../components/icons";

/** The frame of the screens shown before anyone can sign in: first launch and setup. */
export function OnboardingShell({ title, subtitle, children }: { title: string; subtitle: string; children: ReactNode }) {
  return (
    <div className="min-h-screen bg-slate-50 px-4 py-10 sm:px-6">
      <div className="mx-auto w-full max-w-2xl">
        <div className="mb-8 flex items-center gap-2">
          <div className="grid h-8 w-8 place-items-center rounded-lg bg-brand-600 text-white">
            <IconStore width={18} height={18} />
          </div>
          <p className="font-semibold text-slate-900">Point of Sale</p>
        </div>
        <h1 className="text-2xl font-semibold tracking-tight text-slate-900">{title}</h1>
        <p className="mt-1 text-sm text-slate-500">{subtitle}</p>
        <div className="mt-8">{children}</div>
      </div>
    </div>
  );
}

export function ErrorNote({ message }: { message: string }) {
  return (
    <p className="rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700" role="alert">
      {message}
    </p>
  );
}
