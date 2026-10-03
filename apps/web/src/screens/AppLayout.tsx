import { Link, Outlet, useRouterState } from "@tanstack/react-router";
import { useEffect, useState, type ComponentType, type SVGProps } from "react";
import {
  IconBoxes,
  IconChart,
  IconChevronsLeft,
  IconFile,
  IconLock,
  IconLogout,
  IconMenu,
  IconReceipt,
  IconRegister,
  IconReturn,
  IconSettings,
  IconStore,
  IconTag,
  IconTransfer,
  IconTruck,
  IconUsers,
} from "../components/icons";
import { OnlineOnlyBadge } from "../components/OnlineOnly";
import { MoveOnlineNotice } from "../components/MoveOnline";
import { RecoveryCodeNotice } from "../components/RecoveryCode";
import { confirmLeave } from "../lib/leaveGuard";
import { useIsOffline } from "../lib/mode";
import { clearSession, getSession } from "../lib/session";
import { CloseRegisterDialog } from "./CloseRegisterDialog";

type NavItem = {
  to: string;
  label: string;
  icon: ComponentType<SVGProps<SVGSVGElement>>;
  /** The route needs an open register (see requireOperationalSession). */
  needsRegister?: boolean;
  adminOnly?: boolean;
  /** Needs an online business; an offline one sees it marked "Online only". */
  onlineOnly?: boolean;
};

const NAV_SECTIONS: Array<{ title: string; items: NavItem[] }> = [
  {
    title: "Operations",
    items: [
      { to: "/pos", label: "Point of Sale", icon: IconRegister, needsRegister: true },
      { to: "/sales", label: "Sales", icon: IconReceipt, needsRegister: true },
      { to: "/returns", label: "Returns", icon: IconReturn, needsRegister: true },
      { to: "/customers", label: "Customers", icon: IconUsers, needsRegister: true },
    ],
  },
  {
    title: "Catalog",
    items: [
      { to: "/items", label: "Items", icon: IconTag },
      { to: "/stock", label: "Inventory", icon: IconBoxes, needsRegister: true },
      { to: "/purchases", label: "Purchases", icon: IconTruck, needsRegister: true, adminOnly: true },
      { to: "/transfers", label: "Transfers", icon: IconTransfer, needsRegister: true, adminOnly: true, onlineOnly: true },
    ],
  },
  {
    title: "Administration",
    items: [
      { to: "/reports", label: "Reports", icon: IconChart, adminOnly: true },
      { to: "/gst", label: "GST Returns", icon: IconFile, adminOnly: true },
      { to: "/settings", label: "Settings", icon: IconSettings, adminOnly: true },
    ],
  },
];

const PAGE_TITLES: Record<string, string> = {
  "/open-register": "Open Register",
  "/change-password": "Change Password",
  ...Object.fromEntries(NAV_SECTIONS.flatMap((s) => s.items.map((i) => [i.to, i.label]))),
};

const COLLAPSE_KEY = "pos_sidebar_collapsed";

function readCollapsed() {
  try {
    return localStorage.getItem(COLLAPSE_KEY) === "1";
  } catch {
    return false;
  }
}

function initials(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  return ((parts[0]?.[0] ?? "") + (parts[1]?.[0] ?? "")).toUpperCase() || "?";
}

/** Screens shown before anyone is signed in, without the app's navigation. */
const FULL_SCREEN_PATHS = new Set(["/", "/welcome", "/setup", "/create-business", "/recover", "/owner-password"]);

export function AppLayout() {
  const location = useRouterState({ select: (s) => s.location.pathname });
  const session = getSession();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(readCollapsed);
  const [closingRegister, setClosingRegister] = useState(false);
  const userLabel = session ? session.username?.trim() || session.role : "";
  const branch = session?.branchId
    ? session.branches.find((b) => b.id === session.branchId)
    : undefined;
  const branchLabel = session?.branchId ? (branch?.name ?? "Selected Branch") : "";
  const pageTitle = PAGE_TITLES[location] ?? "";
  // Above the early return below: hooks must run the same way on every render.
  const offline = useIsOffline();

  useEffect(() => {
    document.title = pageTitle && pageTitle !== "Point of Sale" ? `${pageTitle} · Point of Sale` : "Point of Sale";
  }, [pageTitle]);

  useEffect(() => {
    setMobileOpen(false);
  }, [location]);

  // Without navigation too: the password someone was given, before they may use anything.
  if ((!session && FULL_SCREEN_PATHS.has(location)) || (session?.mustChangePassword && location === "/change-password")) {
    return <Outlet />;
  }

  const toggleCollapsed = () => {
    setCollapsed((value) => {
      try {
        localStorage.setItem(COLLAPSE_KEY, value ? "0" : "1");
      } catch {
        // Not remembered; the sidebar still toggles.
      }
      return !value;
    });
  };

  const hasRegister = Boolean(session?.registerId);
  // Labels are hidden only in the desktop rail; the mobile drawer always shows them.
  const labelClass = collapsed ? "lg:hidden" : "";

  return (
    <div className="flex h-screen overflow-hidden bg-slate-100 print:block print:h-auto print:overflow-visible print:bg-white">
      {mobileOpen ? (
        <div
          className="fixed inset-0 z-30 bg-slate-950/50 lg:hidden print:hidden"
          onClick={() => setMobileOpen(false)}
        />
      ) : null}

      <aside
        className={`fixed inset-y-0 left-0 z-40 flex w-64 shrink-0 flex-col bg-shell-900 text-slate-300 transition-[width,translate] duration-200 lg:static lg:translate-x-0 print:hidden ${collapsed ? "lg:w-16" : "lg:w-60"} ${mobileOpen ? "translate-x-0" : "-translate-x-full"}`}
      >
        <div className={`flex h-12 shrink-0 items-center gap-2.5 border-b border-white/5 px-4 ${collapsed ? "lg:justify-center lg:px-0" : ""}`}>
          <div className="grid h-7 w-7 shrink-0 place-items-center rounded-md bg-brand-600 text-white">
            <IconStore width={16} height={16} />
          </div>
          <div className={`min-w-0 leading-tight ${labelClass}`}>
            <p className="truncate text-sm font-semibold text-white">Point of Sale</p>
            <p className="truncate text-[11px] text-slate-400">Retail Management</p>
          </div>
        </div>

        <nav className="flex-1 overflow-y-auto px-2 py-3">
          {NAV_SECTIONS.map((section) => {
            const items = section.items.filter((item) => !item.adminOnly || session?.role === "ADMIN");
            if (items.length === 0) return null;
            return (
              <div key={section.title} className="mb-4">
                <p className={`mb-1 px-3 text-[10px] font-semibold tracking-wider text-slate-500 uppercase ${labelClass}`}>
                  {section.title}
                </p>
                {collapsed ? <div className="mx-3 mb-2 hidden border-t border-white/5 lg:block" /> : null}
                <div className="grid gap-0.5">
                  {items.map((item) => {
                    const Icon = item.icon;
                    const locked = item.needsRegister && !hasRegister;
                    const active = location === item.to;
                    const base = `group relative flex h-9 items-center gap-3 rounded-md px-3 text-sm font-medium ${collapsed ? "lg:justify-center lg:px-0" : ""}`;
                    if (locked) {
                      return (
                        <span
                          key={item.to}
                          className={`${base} cursor-not-allowed text-slate-600`}
                          title={`${item.label}: open a register first`}
                        >
                          <Icon className="shrink-0" />
                          <span className={`flex-1 truncate ${labelClass}`}>{item.label}</span>
                          {/* One marker only: both don't fit the sidebar's width. */}
                          {item.onlineOnly && offline ? (
                            <OnlineOnlyBadge className={labelClass} />
                          ) : (
                            <IconLock width={14} height={14} className={labelClass} />
                          )}
                        </span>
                      );
                    }
                    return (
                      <Link
                        key={item.to}
                        to={item.to}
                        title={collapsed ? item.label : undefined}
                        className={`${base} ${active ? "bg-shell-700 text-white" : "text-slate-400 hover:bg-shell-800 hover:text-slate-100"}`}
                      >
                        {active ? <span className="absolute inset-y-1.5 left-0 w-0.5 rounded-full bg-brand-400" /> : null}
                        <Icon className={`shrink-0 ${active ? "text-brand-300" : ""}`} />
                        <span className={`truncate ${labelClass}`}>{item.label}</span>
                        {item.onlineOnly && offline ? <OnlineOnlyBadge className={`ml-auto ${labelClass}`} /> : null}
                      </Link>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </nav>

        <div className="shrink-0 border-t border-white/5 p-2">
          {hasRegister ? (
            <button
              className={`flex h-9 w-full items-center gap-3 rounded-md px-3 text-sm font-medium text-slate-400 hover:bg-shell-800 hover:text-slate-100 ${collapsed ? "lg:justify-center lg:px-0" : ""}`}
              title="Close Register"
              onClick={async () => {
                setMobileOpen(false);
                // Ask the open screen (e.g. an unsaved POS cart) before closing.
                if (!(await confirmLeave())) return;
                setClosingRegister(true);
              }}
            >
              <IconLock className="shrink-0" />
              <span className={labelClass}>Close Register</span>
            </button>
          ) : (
            <Link
              to="/open-register"
              className={`flex h-9 items-center gap-3 rounded-md px-3 text-sm font-medium ${location === "/open-register" ? "bg-shell-700 text-white" : "text-slate-400 hover:bg-shell-800 hover:text-slate-100"} ${collapsed ? "lg:justify-center lg:px-0" : ""}`}
              title="Open Register"
            >
              <IconRegister className="shrink-0" />
              <span className={labelClass}>Open Register</span>
            </Link>
          )}
          <button
            className={`flex h-9 w-full items-center gap-3 rounded-md px-3 text-sm font-medium text-slate-400 hover:bg-shell-800 hover:text-slate-100 ${collapsed ? "lg:justify-center lg:px-0" : ""}`}
            title="Sign out"
            onClick={async () => {
              setMobileOpen(false);
              // Only sign out once the open screen agrees; cancelling keeps the session.
              if (!(await confirmLeave())) return;
              clearSession();
              window.location.href = "/";
            }}
          >
            <IconLogout className="shrink-0" />
            <span className={labelClass}>Sign out</span>
          </button>
          <button
            className={`mt-1 hidden h-8 w-full items-center gap-3 rounded-md px-3 text-xs text-slate-500 hover:bg-shell-800 hover:text-slate-200 lg:flex ${collapsed ? "lg:justify-center lg:px-0" : ""}`}
            onClick={toggleCollapsed}
            title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          >
            <IconChevronsLeft className={`shrink-0 transition-transform ${collapsed ? "rotate-180" : ""}`} width={16} height={16} />
            <span className={labelClass}>Collapse</span>
          </button>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col print:block">
        <header className="flex h-12 shrink-0 items-center justify-between gap-3 border-b border-slate-200 bg-white px-3 sm:px-4 print:hidden">
          <div className="flex min-w-0 items-center gap-2">
            <button
              className="btn-ghost -ml-1 h-8 w-8 p-0 lg:hidden"
              onClick={() => setMobileOpen(true)}
              aria-label="Open navigation"
            >
              <IconMenu />
            </button>
            <h1 className="truncate text-sm font-semibold text-slate-900">{pageTitle}</h1>
          </div>

          {session ? (
            <div className="flex min-w-0 items-center gap-2 sm:gap-3">
              {branchLabel ? (
                <span className="hidden min-w-0 items-center gap-1.5 rounded-md border border-slate-200 bg-slate-50 px-2 py-1 text-xs text-slate-600 sm:inline-flex">
                  <IconStore width={14} height={14} className="shrink-0 text-slate-400" />
                  <span className="truncate font-medium text-slate-800">{branchLabel}</span>
                  {branch?.code ? <span className="text-slate-400">· {branch.code}</span> : null}
                </span>
              ) : null}
              <span
                className={`hidden items-center gap-1.5 rounded-md px-2 py-1 text-xs font-medium md:inline-flex ${hasRegister ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-700"}`}
              >
                <span className={`h-1.5 w-1.5 rounded-full ${hasRegister ? "bg-emerald-500" : "bg-amber-500"}`} />
                {hasRegister ? `${session.counterName ?? "Register"} open` : "No register"}
              </span>
              <Link
                to="/change-password"
                title="Change your password"
                className="flex items-center gap-2 rounded-md border-l border-slate-200 pl-2 hover:bg-slate-50 sm:pl-3"
              >
                <div className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-brand-100 text-[11px] font-semibold text-brand-700">
                  {initials(userLabel)}
                </div>
                <div className="hidden leading-tight sm:block">
                  <p className="max-w-32 truncate text-xs font-semibold text-slate-900">{userLabel}</p>
                  <p className="text-[10px] font-medium tracking-wide text-slate-500 uppercase">
                    {session.role === "ADMIN" ? "Administrator" : "Cashier"}
                  </p>
                </div>
              </Link>
            </div>
          ) : null}
        </header>

        <MoveOnlineNotice />
        <RecoveryCodeNotice />
        <main className="min-h-0 flex-1 overflow-auto print:overflow-visible">
          <Outlet />
        </main>
      </div>
      {closingRegister ? <CloseRegisterDialog onCancel={() => setClosingRegister(false)} /> : null}
    </div>
  );
}
