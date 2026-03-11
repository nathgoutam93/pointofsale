import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { API_BASE_URL, api, authHeaders } from "../lib/api";
import { requireAdmin } from "./route-helpers";

type SettingsForm = {
  name: string;
  code: string;
  logoUrl: string | null;
  invoicePrefix: string;
  receiptPrefix: string;
  returnPrefix: string;
  invoiceHeader: string;
  invoiceFooter: string;
  receiptHeader: string;
  receiptFooter: string;
  invoiceCss: string;
  receiptCss: string;
};

type CashierForm = {
  username: string;
  password: string;
};

const emptyCashierForm: CashierForm = { username: "", password: "" };

export function BranchSettingsPage() {
  const session = requireAdmin();
  const queryClient = useQueryClient();
  const normalizedApiBaseUrl = API_BASE_URL.replace(/\/$/, "");
  const [message, setMessage] = useState("");
  const [userMessage, setUserMessage] = useState("");
  const [cashierForm, setCashierForm] = useState<CashierForm>(emptyCashierForm);
  const [passwordByUserId, setPasswordByUserId] = useState<Record<string, string>>({});

  const branchSettings = useQuery({
    queryKey: ["branch-settings", session.branchId],
    queryFn: async () => {
      const res = await api.branches.get({
        params: { id: session.branchId },
        extraHeaders: authHeaders()
      });
      if (res.status !== 200) throw new Error("Failed to load branch settings");
      return res.body;
    }
  });

  const users = useQuery({
    queryKey: ["branch-users", session.branchId],
    queryFn: async () => {
      const res = await api.users.list({
        query: { branchId: session.branchId },
        extraHeaders: authHeaders()
      });
      if (res.status !== 200) throw new Error("Failed to load users");
      return res.body;
    }
  });

  const [form, setForm] = useState<SettingsForm>({
    name: "",
    code: "",
    logoUrl: null,
    invoicePrefix: "INV",
    receiptPrefix: "RCPT",
    returnPrefix: "RTN",
    invoiceHeader: "",
    invoiceFooter: "",
    receiptHeader: "",
    receiptFooter: "",
    invoiceCss: "",
    receiptCss: ""
  });

  useEffect(() => {
    if (!branchSettings.data) return;
    setForm({
      name: branchSettings.data.name,
      code: branchSettings.data.code,
      logoUrl: branchSettings.data.logoUrl,
      invoicePrefix: branchSettings.data.invoicePrefix,
      receiptPrefix: branchSettings.data.receiptPrefix,
      returnPrefix: branchSettings.data.returnPrefix,
      invoiceHeader: branchSettings.data.invoiceHeader ?? "",
      invoiceFooter: branchSettings.data.invoiceFooter ?? "",
      receiptHeader: branchSettings.data.receiptHeader ?? "",
      receiptFooter: branchSettings.data.receiptFooter ?? "",
      invoiceCss: branchSettings.data.invoiceCss ?? "",
      receiptCss: branchSettings.data.receiptCss ?? ""
    });
  }, [branchSettings.data]);

  const logoSrc = useMemo(() => {
    if (!form.logoUrl) return null;
    if (form.logoUrl.startsWith("http://") || form.logoUrl.startsWith("https://")) {
      return form.logoUrl;
    }
    return `${normalizedApiBaseUrl}${form.logoUrl.startsWith("/") ? "" : "/"}${form.logoUrl}`;
  }, [form.logoUrl, normalizedApiBaseUrl]);

  const saveSettings = useMutation({
    mutationFn: async () => {
      const emptyToNull = (value: string) => (value.trim() ? value : null);
      const trimmedCode = form.code.trim();
      if (!trimmedCode) {
        throw new Error("Branch code is required.");
      }
      const res = await api.branches.update({
        params: { id: session.branchId },
        body: {
          name: form.name.trim(),
          code: trimmedCode,
          logoUrl: form.logoUrl,
          invoicePrefix: form.invoicePrefix.trim(),
          receiptPrefix: form.receiptPrefix.trim(),
          returnPrefix: form.returnPrefix.trim(),
          invoiceHeader: emptyToNull(form.invoiceHeader),
          invoiceFooter: emptyToNull(form.invoiceFooter),
          receiptHeader: emptyToNull(form.receiptHeader),
          receiptFooter: emptyToNull(form.receiptFooter),
          invoiceCss: emptyToNull(form.invoiceCss),
          receiptCss: emptyToNull(form.receiptCss)
        },
        extraHeaders: authHeaders()
      });
      if (res.status !== 200) throw new Error("Failed to save branch settings");
      return res.body;
    },
    onSuccess: (updated) => {
      queryClient.setQueryData(["branch-settings", session.branchId], updated);
      setMessage("Branch settings saved.");
    },
    onError: (error) => {
      setMessage((error as Error).message);
    }
  });

  const uploadLogo = async (file: File) => {
    const body = new FormData();
    body.append("file", file);
    const res = await fetch(`${normalizedApiBaseUrl}/branches/${session.branchId}/logo`, {
      method: "POST",
      headers: authHeaders(),
      body
    });
    if (!res.ok) throw new Error("Failed to upload logo");
    return (await res.json()) as {
      name: string;
      code: string;
      logoUrl: string | null;
      invoicePrefix: string;
      receiptPrefix: string;
      returnPrefix: string;
      invoiceHeader: string | null;
      invoiceFooter: string | null;
      receiptHeader: string | null;
      receiptFooter: string | null;
      invoiceCss: string | null;
      receiptCss: string | null;
    };
  };

  const uploadLogoMutation = useMutation({
    mutationFn: async (file: File) => uploadLogo(file),
    onSuccess: (updated) => {
      setForm((prev) => ({
        ...prev,
        name: updated.name ?? prev.name,
        code: updated.code ?? prev.code,
        logoUrl: updated.logoUrl ?? null,
        invoicePrefix: updated.invoicePrefix ?? prev.invoicePrefix,
        receiptPrefix: updated.receiptPrefix ?? prev.receiptPrefix,
        returnPrefix: updated.returnPrefix ?? prev.returnPrefix,
        invoiceHeader: updated.invoiceHeader ?? "",
        invoiceFooter: updated.invoiceFooter ?? "",
        receiptHeader: updated.receiptHeader ?? "",
        receiptFooter: updated.receiptFooter ?? "",
        invoiceCss: updated.invoiceCss ?? "",
        receiptCss: updated.receiptCss ?? ""
      }));
      queryClient.invalidateQueries({ queryKey: ["branch-settings", session.branchId] });
      setMessage("Logo updated.");
    },
    onError: (error) => {
      setMessage((error as Error).message);
    }
  });

  const createCashier = useMutation({
    mutationFn: async () => {
      const res = await api.users.create({
        body: { branchId: session.branchId, username: cashierForm.username.trim(), password: cashierForm.password },
        extraHeaders: authHeaders()
      });
      if (res.status !== 201) throw new Error("Failed to create cashier");
      return res.body;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["branch-users", session.branchId] });
      setCashierForm(emptyCashierForm);
      setUserMessage("Cashier account created.");
    },
    onError: (error) => {
      setUserMessage((error as Error).message);
    }
  });

  const updateUser = useMutation({
    mutationFn: async (payload: { id: string; username?: string; password?: string; isActive?: boolean }) => {
      const res = await api.users.update({
        params: { id: payload.id },
        body: { username: payload.username, password: payload.password, isActive: payload.isActive },
        extraHeaders: authHeaders()
      });
      if (res.status !== 200) throw new Error("Failed to update user");
      return res.body;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["branch-users", session.branchId] });
      setUserMessage("User updated.");
    },
    onError: (error) => {
      setUserMessage((error as Error).message);
    }
  });

  const cashiers = useMemo(() => (users.data ?? []).filter((user) => user.role === "CASHIER"), [users.data]);

  return (
    <section className="grid gap-6 p-6">
      <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <h2 className="text-2xl font-semibold text-slate-900">Branch Settings</h2>
        <p className="mt-1 text-sm text-slate-600">
          Update branch identity, numbering prefixes, and printable template styling.
        </p>

        <div className="mt-5 grid gap-5 lg:grid-cols-[1.2fr_1fr]">
          <div className="space-y-4">
            <div>
              <label className="text-sm text-slate-600">Branch name</label>
              <input
                className="mt-1 w-full rounded border border-slate-300 px-3 py-2"
                value={form.name}
                onChange={(e) => setForm((prev) => ({ ...prev, name: e.target.value }))}
              />
            </div>
            <div>
              <label className="text-sm text-slate-600">Branch code</label>
              <input
                className="mt-1 w-full rounded border border-slate-300 px-3 py-2"
                value={form.code}
                onChange={(e) => setForm((prev) => ({ ...prev, code: e.target.value }))}
              />
              <p className="mt-1 text-xs text-slate-500">Used in invoice/receipt numbers. Changing affects future numbers only.</p>
            </div>

            <div>
              <label className="text-sm text-slate-600">Logo</label>
              <div className="mt-2 flex items-center gap-4">
                <div className="h-16 w-16 overflow-hidden rounded border border-slate-200 bg-slate-50">
                  {logoSrc ? <img src={logoSrc} alt="Branch logo" className="h-full w-full object-contain" /> : null}
                </div>
                <div className="grid gap-2">
                  <input
                    type="file"
                    accept="image/*"
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      if (file) uploadLogoMutation.mutate(file);
                    }}
                  />
                  <button
                    className="rounded bg-slate-100 px-2 py-1 text-xs text-slate-700"
                    onClick={() => setForm((prev) => ({ ...prev, logoUrl: null }))}
                  >
                    Remove logo
                  </button>
                </div>
              </div>
            </div>

            <div className="grid gap-3 sm:grid-cols-3">
              <div>
                <label className="text-sm text-slate-600">Invoice prefix</label>
                <input
                  className="mt-1 w-full rounded border border-slate-300 px-3 py-2"
                  value={form.invoicePrefix}
                  onChange={(e) => setForm((prev) => ({ ...prev, invoicePrefix: e.target.value }))}
                />
              </div>
              <div>
                <label className="text-sm text-slate-600">Receipt prefix</label>
                <input
                  className="mt-1 w-full rounded border border-slate-300 px-3 py-2"
                  value={form.receiptPrefix}
                  onChange={(e) => setForm((prev) => ({ ...prev, receiptPrefix: e.target.value }))}
                />
              </div>
              <div>
                <label className="text-sm text-slate-600">Return prefix</label>
                <input
                  className="mt-1 w-full rounded border border-slate-300 px-3 py-2"
                  value={form.returnPrefix}
                  onChange={(e) => setForm((prev) => ({ ...prev, returnPrefix: e.target.value }))}
                />
              </div>
            </div>
          </div>

          <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
            <p className="text-sm font-semibold text-slate-800">Printable templates</p>
            <p className="mt-1 text-xs text-slate-500">
              Use header and footer text for receipts and invoices. Optional CSS applies to printable layouts.
            </p>
            <div className="mt-4 grid gap-3">
              <div>
                <label className="text-xs text-slate-600">Invoice header</label>
                <textarea
                  className="mt-1 w-full rounded border border-slate-300 px-3 py-2 text-sm"
                  rows={2}
                  value={form.invoiceHeader}
                  onChange={(e) => setForm((prev) => ({ ...prev, invoiceHeader: e.target.value }))}
                />
              </div>
              <div>
                <label className="text-xs text-slate-600">Invoice footer</label>
                <textarea
                  className="mt-1 w-full rounded border border-slate-300 px-3 py-2 text-sm"
                  rows={2}
                  value={form.invoiceFooter}
                  onChange={(e) => setForm((prev) => ({ ...prev, invoiceFooter: e.target.value }))}
                />
              </div>
              <div>
                <label className="text-xs text-slate-600">Invoice CSS</label>
                <textarea
                  className="mt-1 w-full rounded border border-slate-300 px-3 py-2 text-xs font-mono"
                  rows={4}
                  value={form.invoiceCss}
                  onChange={(e) => setForm((prev) => ({ ...prev, invoiceCss: e.target.value }))}
                />
              </div>
              <div>
                <label className="text-xs text-slate-600">Receipt header</label>
                <textarea
                  className="mt-1 w-full rounded border border-slate-300 px-3 py-2 text-sm"
                  rows={2}
                  value={form.receiptHeader}
                  onChange={(e) => setForm((prev) => ({ ...prev, receiptHeader: e.target.value }))}
                />
              </div>
              <div>
                <label className="text-xs text-slate-600">Receipt footer</label>
                <textarea
                  className="mt-1 w-full rounded border border-slate-300 px-3 py-2 text-sm"
                  rows={2}
                  value={form.receiptFooter}
                  onChange={(e) => setForm((prev) => ({ ...prev, receiptFooter: e.target.value }))}
                />
              </div>
              <div>
                <label className="text-xs text-slate-600">Receipt CSS</label>
                <textarea
                  className="mt-1 w-full rounded border border-slate-300 px-3 py-2 text-xs font-mono"
                  rows={4}
                  value={form.receiptCss}
                  onChange={(e) => setForm((prev) => ({ ...prev, receiptCss: e.target.value }))}
                />
              </div>
            </div>
          </div>
        </div>

        <div className="mt-4 flex items-center gap-3">
          <button
            className="rounded bg-emerald-600 px-4 py-2 text-sm font-semibold text-white disabled:bg-emerald-300"
            onClick={() => saveSettings.mutate()}
            disabled={saveSettings.isPending || branchSettings.isLoading}
          >
            Save Settings
          </button>
          {message ? <p className="text-sm text-emerald-700">{message}</p> : null}
        </div>
      </div>

      <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <h2 className="text-2xl font-semibold text-slate-900">Cashier Accounts</h2>
        <p className="mt-1 text-sm text-slate-600">Create and manage cashier logins for this branch.</p>

        <div className="mt-4 grid gap-3 md:grid-cols-[1fr_1fr_auto]">
          <input
            className="rounded border border-slate-300 px-3 py-2"
            placeholder="Username"
            value={cashierForm.username}
            onChange={(e) => setCashierForm((prev) => ({ ...prev, username: e.target.value }))}
          />
          <input
            className="rounded border border-slate-300 px-3 py-2"
            placeholder="Password"
            type="password"
            value={cashierForm.password}
            onChange={(e) => setCashierForm((prev) => ({ ...prev, password: e.target.value }))}
          />
          <button
            className="rounded bg-slate-900 px-4 py-2 text-sm font-semibold text-white"
            onClick={() => createCashier.mutate()}
            disabled={createCashier.isPending || !cashierForm.username.trim() || !cashierForm.password}
          >
            Add Cashier
          </button>
        </div>

        <div className="mt-5 space-y-3">
          {cashiers.map((user) => (
            <div key={user.id} className="rounded border border-slate-200 p-3">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <p className="font-semibold text-slate-900">{user.username}</p>
                  <p className="text-xs text-slate-500">
                    Status: {user.isActive ? "Active" : "Inactive"} • Created {new Date(user.createdAt).toLocaleDateString()}
                  </p>
                </div>
                <button
                  className={`rounded px-3 py-1 text-xs font-semibold ${user.isActive ? "bg-rose-100 text-rose-700" : "bg-emerald-100 text-emerald-700"}`}
                  onClick={() => updateUser.mutate({ id: user.id, isActive: !user.isActive })}
                >
                  {user.isActive ? "Deactivate" : "Activate"}
                </button>
              </div>
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <input
                  className="rounded border border-slate-300 px-3 py-1 text-sm"
                  placeholder="New password"
                  type="password"
                  value={passwordByUserId[user.id] ?? ""}
                  onChange={(e) =>
                    setPasswordByUserId((prev) => ({ ...prev, [user.id]: e.target.value }))
                  }
                />
                <button
                  className="rounded bg-slate-200 px-3 py-1 text-xs font-semibold text-slate-700"
                  onClick={() => {
                    const nextPassword = passwordByUserId[user.id];
                    if (!nextPassword?.trim()) {
                      setUserMessage("Enter a password to reset.");
                      return;
                    }
                    updateUser.mutate({ id: user.id, password: nextPassword });
                    setPasswordByUserId((prev) => ({ ...prev, [user.id]: "" }));
                  }}
                >
                  Reset Password
                </button>
              </div>
            </div>
          ))}
          {cashiers.length === 0 ? <p className="text-sm text-slate-500">No cashier accounts yet.</p> : null}
        </div>

        {userMessage ? <p className="mt-3 text-sm text-emerald-700">{userMessage}</p> : null}
      </div>
    </section>
  );
}
