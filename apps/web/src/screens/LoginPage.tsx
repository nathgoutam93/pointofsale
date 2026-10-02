import { useNavigate } from "@tanstack/react-router";
import { useMutation } from "@tanstack/react-query";
import { FormEvent, useState } from "react";
import { IconStore } from "../components/icons";
import { api, apiErrorMessage } from "../lib/api";
import { setSession } from "../lib/session";

export function LoginPage() {
  const navigate = useNavigate();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");

  const login = useMutation({
    mutationFn: async () => {
      const res = await api.auth.login({ body: { username, password } });
      if (res.status === 401) throw new Error("Incorrect username or password.");
      if (res.status !== 200) throw new Error(apiErrorMessage(res.body, "Sign-in failed. Try again."));
      return res.body;
    },
  });

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    const data = await login.mutateAsync().catch(() => null);
    if (!data) return;
    setSession(data);
    navigate({ to: data.branchId && data.registerId ? "/pos" : "/open-register" });
  };

  return (
    <div className="grid min-h-screen bg-white lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
      <aside className="relative hidden overflow-hidden bg-shell-900 p-12 text-white lg:flex lg:flex-col lg:justify-between">
        <div
          className="pointer-events-none absolute inset-0 opacity-[0.07]"
          style={{
            backgroundImage:
              "linear-gradient(to right, white 1px, transparent 1px), linear-gradient(to bottom, white 1px, transparent 1px)",
            backgroundSize: "40px 40px",
          }}
        />
        <div className="relative flex items-center gap-3">
          <div className="grid h-9 w-9 place-items-center rounded-lg bg-brand-600">
            <IconStore width={20} height={20} />
          </div>
          <div className="leading-tight">
            <p className="font-semibold">Point of Sale</p>
            <p className="text-xs text-slate-400">Retail Management</p>
          </div>
        </div>
        <div className="relative max-w-md">
          <h2 className="text-3xl font-semibold tracking-tight">
            Billing, inventory and GST compliance across every branch.
          </h2>
          <ul className="mt-6 grid gap-3 text-sm text-slate-300">
            <li className="flex gap-3"><span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-brand-400" />Fast counter billing with drafts, split payments and wallets</li>
            <li className="flex gap-3"><span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-brand-400" />Stock, returns and register balancing per branch</li>
            <li className="flex gap-3"><span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-brand-400" />GSTR-1, GSTR-3B and composition returns out of the box</li>
          </ul>
        </div>
        <p className="relative text-xs text-slate-500">© {new Date().getFullYear()} Point of Sale</p>
      </aside>

      <main className="flex items-center justify-center p-6 sm:p-12">
        <div className="w-full max-w-sm">
          <div className="mb-8 flex items-center gap-2 lg:hidden">
            <div className="grid h-8 w-8 place-items-center rounded-lg bg-brand-600 text-white">
              <IconStore width={18} height={18} />
            </div>
            <p className="font-semibold text-slate-900">Point of Sale</p>
          </div>
          <h1 className="text-2xl font-semibold tracking-tight text-slate-900">Sign in</h1>
          <p className="mt-1 text-sm text-slate-500">Use the account your administrator gave you.</p>

          <form onSubmit={onSubmit} className="mt-8 grid gap-4">
            <div>
              <label className="field-label" htmlFor="login-username">Username</label>
              <input
                id="login-username"
                className="field h-10"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                autoComplete="username"
                autoFocus
                required
              />
            </div>
            <div>
              <label className="field-label" htmlFor="login-password">Password</label>
              <input
                id="login-password"
                className="field h-10"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                type="password"
                autoComplete="current-password"
                required
              />
            </div>
            {login.error ? (
              <p className="rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700" role="alert">
                {(login.error as Error).message}
              </p>
            ) : null}
            <button className="btn-primary h-10 w-full" type="submit" disabled={login.isPending}>
              {login.isPending ? "Signing in…" : "Sign in"}
            </button>
          </form>
        </div>
      </main>
    </div>
  );
}
