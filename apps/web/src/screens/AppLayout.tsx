import { Link, Outlet, useRouterState } from "@tanstack/react-router";
import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { api, authHeaders } from "../lib/api";
import { clearSession, getSession, updateSession } from "../lib/session";

export function AppLayout() {
  const location = useRouterState({ select: (s) => s.location.pathname });
  const session = getSession();
  const [open, setOpen] = useState(false);
  const userLabel = session
    ? session.username?.trim() || session.role
    : "";
  const branchLabel = session?.branchId ? session.branches.find((branch) => branch.id === session.branchId)?.name ?? "Selected Branch" : "";

  const closeRegister = useMutation({
    mutationFn: async (closingBalance: number) => {
      const res = await api.registers.close({
        body: { closingBalance },
        extraHeaders: authHeaders()
      });
      if (res.status !== 200) {
        throw new Error("Failed to close register");
      }
      return res.body;
    },
    onSuccess: (data) => {
      updateSession({ token: data.token, branchId: null, registerId: null });
      window.location.href = "/open-register";
    }
  });

  if (!session && location === "/") {
    return (
      <main className="min-h-screen grid place-items-center bg-[radial-gradient(circle_at_20%_20%,#fcebd7_0%,#eff4ff_45%,#f6f8fc_100%)] p-4">
        <Outlet />
      </main>
    );
  }

  return (
    <div className="min-h-screen bg-slate-100">
      <nav className="p-1 flex justify-between items-center border-b border-slate-100 bg-white">
        <div>
          <h1 className="font-semibold">POS</h1>
        </div>
        <div className="flex items-center gap-3">
          {session ? (
            <p className="text-right text-xs text-slate-600">
              Logged in: <span className="font-semibold text-slate-900">{userLabel}</span>
              {branchLabel ? <span className="ml-2">| Branch: <span className="font-semibold text-slate-900">{branchLabel}</span></span> : null}
            </p>
          ) : null}
          <button
            className="self-end h-10 w-10 rounded-lg border border-slate-300 bg-white text-lg"
            onClick={() => setOpen((v) => !v)}
          >
            ☰
          </button>
        </div>
      </nav>

      <aside
        className={`fixed right-0 top-0 z-30 h-screen w-60 bg-slate-900 p-4 pt-16 text-white transition-transform ${open ? "translate-x-0" : "translate-x-full"}`}
      >
        <div className="mb-6 flex justify-between items-center">
          <button onClick={() => setOpen(false)}>&gt; close</button>
        </div>
        <nav className="grid gap-2">
          <Link
            className="rounded-lg border border-slate-700 bg-slate-800 px-3 py-2"
            to="/pos"
            onClick={() => setOpen(false)}
          >
            POS
          </Link>
          <Link
            className="rounded-lg border border-slate-700 bg-slate-800 px-3 py-2"
            to="/sales"
            onClick={() => setOpen(false)}
          >
            Sales
          </Link>
          <Link
            className="rounded-lg border border-slate-700 bg-slate-800 px-3 py-2"
            to="/returns"
            onClick={() => setOpen(false)}
          >
            Returns
          </Link>
          <Link
            className="rounded-lg border border-slate-700 bg-slate-800 px-3 py-2"
            to="/items"
            onClick={() => setOpen(false)}
          >
            Items
          </Link>
          <Link
            className="rounded-lg border border-slate-700 bg-slate-800 px-3 py-2"
            to="/customers"
            onClick={() => setOpen(false)}
          >
            Customers
          </Link>
          <Link
            className="rounded-lg border border-slate-700 bg-slate-800 px-3 py-2"
            to="/stock"
            onClick={() => setOpen(false)}
          >
            Inventory
          </Link>
          {session?.role === "ADMIN" ? (
            <>
              <Link
                className="rounded-lg border border-slate-700 bg-slate-800 px-3 py-2"
                to="/reports"
                onClick={() => setOpen(false)}
              >
                Reports
              </Link>
              <Link
                className="rounded-lg border border-slate-700 bg-slate-800 px-3 py-2"
                to="/settings"
                onClick={() => setOpen(false)}
              >
                Settings
              </Link>
            </>
          ) : null}
          {session?.registerId ? (
            <button
              className="rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-left"
              onClick={() => {
                const value = window.prompt("Enter closing cash balance");
                if (value == null) return;
                const amount = Number(value);
                if (!Number.isFinite(amount) || amount < 0) return;
                closeRegister.mutate(amount);
              }}
            >
              Close Register
            </button>
          ) : null}
          <button
            className="rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-left"
            onClick={() => {
              clearSession();
              window.location.href = "/";
            }}
          >
            Logout
          </button>
        </nav>
      </aside>

      <main className="">
        <Outlet />
      </main>
    </div>
  );
}
