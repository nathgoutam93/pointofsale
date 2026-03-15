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

type BusinessSettingsForm = {
  name: string;
  logoUrl: string | null;
  gstNumber: string;
  taxCalculationMode: "AFTER_DISCOUNT" | "BEFORE_DISCOUNT";
};

type CashierForm = {
  username: string;
  password: string;
  branchIds: string[];
};

type CreateBranchForm = {
  name: string;
  code: string;
};

type SettingsTab = "business" | "branches" | "cashiers";

const emptyCashierForm = (branchId: string): CashierForm => ({ username: "", password: "", branchIds: [branchId] });

export function BranchSettingsPage() {
  const session = requireAdmin();
  const initialBranchId = session.branchId ?? session.branches[0]?.id ?? "";
  const queryClient = useQueryClient();
  const normalizedApiBaseUrl = API_BASE_URL.replace(/\/$/, "");
  const [activeTab, setActiveTab] = useState<SettingsTab>("business");
  const [selectedBranchId, setSelectedBranchId] = useState(initialBranchId);
  const [message, setMessage] = useState("");
  const [businessMessage, setBusinessMessage] = useState("");
  const [branchMessage, setBranchMessage] = useState("");
  const [userMessage, setUserMessage] = useState("");
  const [cashierForm, setCashierForm] = useState<CashierForm>(emptyCashierForm(initialBranchId));
  const [createBranchForm, setCreateBranchForm] = useState<CreateBranchForm>({ name: "", code: "" });
  const [passwordByUserId, setPasswordByUserId] = useState<Record<string, string>>({});

  const branchSettings = useQuery({
    queryKey: ["branch-settings", selectedBranchId],
    enabled: !!selectedBranchId,
    queryFn: async () => {
      const res = await api.branches.get({
        params: { id: selectedBranchId },
        extraHeaders: authHeaders()
      });
      if (res.status !== 200) throw new Error("Failed to load branch settings");
      return res.body;
    }
  });

  const businessSettings = useQuery({
    queryKey: ["business-settings"],
    queryFn: async () => {
      const res = await api.business.get({
        extraHeaders: authHeaders()
      });
      if (res.status !== 200) throw new Error("Failed to load business settings");
      return res.body;
    }
  });

  const users = useQuery({
    queryKey: ["branch-users", selectedBranchId],
    enabled: !!selectedBranchId,
    queryFn: async () => {
      const res = await api.users.list({
        query: { branchId: selectedBranchId },
        extraHeaders: authHeaders()
      });
      if (res.status !== 200) throw new Error("Failed to load users");
      return res.body;
    }
  });

  const branches = useQuery({
    queryKey: ["accessible-branches"],
    queryFn: async () => {
      const res = await api.branches.list({ extraHeaders: authHeaders() });
      if (res.status !== 200) throw new Error("Failed to load branches");
      return res.body;
    },
    initialData: session.branches
  });

  const availableBranches = branches.data ?? [];

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
  const [businessForm, setBusinessForm] = useState<BusinessSettingsForm>({
    name: "",
    logoUrl: null,
    gstNumber: "",
    taxCalculationMode: "AFTER_DISCOUNT"
  });

  useEffect(() => {
    if (availableBranches.length === 0) {
      setSelectedBranchId("");
      return;
    }
    setSelectedBranchId((prev) => (availableBranches.some((branch) => branch.id === prev) ? prev : availableBranches[0].id));
  }, [availableBranches]);

  useEffect(() => {
    if (!selectedBranchId) return;
    setCashierForm((prev) => ({
      ...prev,
      branchIds: prev.branchIds.includes(selectedBranchId) ? prev.branchIds : [selectedBranchId]
    }));
  }, [selectedBranchId]);

  useEffect(() => {
    if (!businessSettings.data) return;
    setBusinessForm({
      name: businessSettings.data.name,
      logoUrl: businessSettings.data.logoUrl,
      gstNumber: businessSettings.data.gstNumber ?? "",
      taxCalculationMode: businessSettings.data.taxCalculationMode
    });
  }, [businessSettings.data]);

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

  const businessLogoSrc = useMemo(() => {
    if (!businessForm.logoUrl) return null;
    if (businessForm.logoUrl.startsWith("http://") || businessForm.logoUrl.startsWith("https://")) {
      return businessForm.logoUrl;
    }
    return `${normalizedApiBaseUrl}${businessForm.logoUrl.startsWith("/") ? "" : "/"}${businessForm.logoUrl}`;
  }, [businessForm.logoUrl, normalizedApiBaseUrl]);

  const saveBusinessSettings = useMutation({
    mutationFn: async () => {
      const emptyToNull = (value: string) => (value.trim() ? value.trim() : null);
      const trimmedName = businessForm.name.trim();
      if (!trimmedName) {
        throw new Error("Business name is required.");
      }
      const res = await api.business.update({
        body: {
          name: trimmedName,
          logoUrl: businessForm.logoUrl,
          gstNumber: emptyToNull(businessForm.gstNumber),
          taxCalculationMode: businessForm.taxCalculationMode
        },
        extraHeaders: authHeaders()
      });
      if (res.status !== 200) throw new Error("Failed to save business settings");
      return res.body;
    },
    onSuccess: (updated) => {
      queryClient.setQueryData(["business-settings"], updated);
      setBusinessMessage("Business settings saved.");
    },
    onError: (error) => {
      setBusinessMessage((error as Error).message);
    }
  });

  const uploadBusinessLogo = async (file: File) => {
    const body = new FormData();
    body.append("file", file);
    const res = await fetch(`${normalizedApiBaseUrl}/business/logo`, {
      method: "POST",
      headers: authHeaders(),
      body
    });
    if (!res.ok) throw new Error("Failed to upload business logo");
    return (await res.json()) as {
      id: string;
      name: string;
      logoUrl: string | null;
      gstNumber: string | null;
      taxCalculationMode: "AFTER_DISCOUNT" | "BEFORE_DISCOUNT";
    };
  };

  const uploadBusinessLogoMutation = useMutation({
    mutationFn: async (file: File) => uploadBusinessLogo(file),
    onSuccess: (updated) => {
      setBusinessForm((prev) => ({
        ...prev,
        name: updated.name ?? prev.name,
        logoUrl: updated.logoUrl ?? null,
        gstNumber: updated.gstNumber ?? "",
        taxCalculationMode: updated.taxCalculationMode ?? prev.taxCalculationMode
      }));
      queryClient.invalidateQueries({ queryKey: ["business-settings"] });
      setBusinessMessage("Business logo updated.");
    },
    onError: (error) => {
      setBusinessMessage((error as Error).message);
    }
  });

  const createBranch = useMutation({
    mutationFn: async () => {
      const trimmedName = createBranchForm.name.trim();
      const trimmedCode = createBranchForm.code.trim().toUpperCase();
      if (!trimmedName) {
        throw new Error("Branch name is required.");
      }
      if (!trimmedCode) {
        throw new Error("Branch code is required.");
      }
      const res = await api.branches.create({
        body: { name: trimmedName, code: trimmedCode },
        extraHeaders: authHeaders()
      });
      if (res.status !== 201) throw new Error("Failed to create branch");
      return res.body;
    },
    onSuccess: (created) => {
      queryClient.invalidateQueries({ queryKey: ["accessible-branches"] });
      setSelectedBranchId(created.id);
      setCreateBranchForm({ name: "", code: "" });
      setBranchMessage(`Branch ${created.code} created.`);
      setMessage("");
      setUserMessage("");
      setActiveTab("branches");
    },
    onError: (error) => {
      setBranchMessage((error as Error).message);
    }
  });

  const saveSettings = useMutation({
    mutationFn: async () => {
      const emptyToNull = (value: string) => (value.trim() ? value : null);
      const trimmedCode = form.code.trim();
      if (!trimmedCode) {
        throw new Error("Branch code is required.");
      }
      if (!selectedBranchId) {
        throw new Error("Select a branch first.");
      }
      const res = await api.branches.update({
        params: { id: selectedBranchId },
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
      queryClient.setQueryData(["branch-settings", selectedBranchId], updated);
      setMessage("Branch settings saved.");
      queryClient.invalidateQueries({ queryKey: ["accessible-branches"] });
    },
    onError: (error) => {
      setMessage((error as Error).message);
    }
  });

  const uploadLogo = async (file: File) => {
    if (!selectedBranchId) {
      throw new Error("Select a branch first.");
    }
    const body = new FormData();
    body.append("file", file);
    const res = await fetch(`${normalizedApiBaseUrl}/branches/${selectedBranchId}/logo`, {
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
      queryClient.invalidateQueries({ queryKey: ["branch-settings", selectedBranchId] });
      setMessage("Logo updated.");
      queryClient.invalidateQueries({ queryKey: ["accessible-branches"] });
    },
    onError: (error) => {
      setMessage((error as Error).message);
    }
  });

  const createCashier = useMutation({
    mutationFn: async () => {
      if (!selectedBranchId) {
        throw new Error("Select a branch first.");
      }
      const res = await api.users.create({
        body: {
          branchId: selectedBranchId,
          username: cashierForm.username.trim(),
          password: cashierForm.password,
          branchIds: cashierForm.branchIds
        },
        extraHeaders: authHeaders()
      });
      if (res.status !== 201) throw new Error("Failed to create cashier");
      return res.body;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["branch-users", selectedBranchId] });
      setCashierForm(emptyCashierForm(selectedBranchId));
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
      queryClient.invalidateQueries({ queryKey: ["branch-users", selectedBranchId] });
      setUserMessage("User updated.");
    },
    onError: (error) => {
      setUserMessage((error as Error).message);
    }
  });

  const grantBranchAccess = useMutation({
    mutationFn: async (payload: { id: string; branchId: string }) => {
      const res = await api.users.grantBranchAccess({
        params: { id: payload.id, branchId: payload.branchId },
        extraHeaders: authHeaders()
      });
      if (res.status !== 204) throw new Error("Failed to add branch access");
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["branch-users", selectedBranchId] });
    },
    onError: (error) => {
      setUserMessage((error as Error).message);
    }
  });

  const revokeBranchAccess = useMutation({
    mutationFn: async (payload: { id: string; branchId: string }) => {
      const res = await api.users.revokeBranchAccess({
        params: { id: payload.id, branchId: payload.branchId },
        extraHeaders: authHeaders()
      });
      if (res.status !== 204) throw new Error("Failed to remove branch access");
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["branch-users", selectedBranchId] });
    },
    onError: (error) => {
      setUserMessage((error as Error).message);
    }
  });

  const cashiers = useMemo(() => (users.data ?? []).filter((user) => user.role === "CASHIER"), [users.data]);

  if (availableBranches.length === 0) {
    return (
      <section className="p-6">
        <p className="text-sm text-slate-600">No branch access is configured for this admin account.</p>
      </section>
    );
  }

  const selectedBranch = availableBranches.find((branch) => branch.id === selectedBranchId) ?? availableBranches[0];

  return (
    <section className="grid gap-4 p-6">
      <div className="rounded-2xl border border-slate-200 bg-white p-2 shadow-sm">
        <div className="grid gap-2 sm:grid-cols-3">
          {[
            { id: "business" as const, label: "Business Settings" },
            { id: "branches" as const, label: "Branch Settings" },
            { id: "cashiers" as const, label: "Cashiers & Access" }
          ].map((tab) => (
            <button
              key={tab.id}
              className={`rounded-xl px-4 py-2 text-sm font-semibold transition ${
                activeTab === tab.id ? "bg-slate-900 text-white" : "bg-slate-100 text-slate-700"
              }`}
              onClick={() => setActiveTab(tab.id)}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {activeTab === "business" ? (
        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <h2 className="text-2xl font-semibold text-slate-900">Business Settings</h2>
          <p className="mt-1 text-sm text-slate-600">
            Configure global details shared by all branches, including logo and GST number.
          </p>

          <div className="mt-5 grid gap-5 lg:grid-cols-[1.2fr_1fr]">
            <div className="space-y-4">
              <div>
                <label className="text-sm text-slate-600">Business name</label>
                <input
                  className="mt-1 w-full rounded border border-slate-300 px-3 py-2"
                  value={businessForm.name}
                  onChange={(e) => setBusinessForm((prev) => ({ ...prev, name: e.target.value }))}
                />
              </div>
              <div>
                <label className="text-sm text-slate-600">GST number</label>
                <input
                  className="mt-1 w-full rounded border border-slate-300 px-3 py-2"
                  value={businessForm.gstNumber}
                  onChange={(e) => setBusinessForm((prev) => ({ ...prev, gstNumber: e.target.value }))}
                  placeholder="e.g. 29ABCDE1234F2Z5"
                />
              </div>
              <div>
                <label className="text-sm text-slate-600">Tax calculation mode</label>
                <select
                  className="mt-1 w-full rounded border border-slate-300 px-3 py-2"
                  value={businessForm.taxCalculationMode}
                  onChange={(e) =>
                    setBusinessForm((prev) => ({
                      ...prev,
                      taxCalculationMode: e.target.value as "AFTER_DISCOUNT" | "BEFORE_DISCOUNT",
                    }))
                  }
                >
                  <option value="AFTER_DISCOUNT">After discount</option>
                  <option value="BEFORE_DISCOUNT">Before discount</option>
                </select>
                <p className="mt-1 text-xs text-slate-500">
                  Controls whether tax is recomputed after discounts or held on the original pre-discount base.
                </p>
              </div>
            </div>

            <div>
              <label className="text-sm text-slate-600">Global logo</label>
              <div className="mt-2 flex items-center gap-4">
                <div className="h-16 w-16 overflow-hidden rounded border border-slate-200 bg-slate-50">
                  {businessLogoSrc ? <img src={businessLogoSrc} alt="Business logo" className="h-full w-full object-contain" /> : null}
                </div>
                <div className="grid gap-2">
                  <input
                    type="file"
                    accept="image/*"
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      if (file) uploadBusinessLogoMutation.mutate(file);
                    }}
                  />
                  <button
                    className="rounded bg-slate-100 px-2 py-1 text-xs text-slate-700"
                    onClick={() => setBusinessForm((prev) => ({ ...prev, logoUrl: null }))}
                  >
                    Remove logo
                  </button>
                </div>
              </div>
              <p className="mt-1 text-xs text-slate-500">
                Branch logo can override this. If branch logo is empty, this one is used.
              </p>
            </div>
          </div>

          <div className="mt-4 flex items-center gap-3">
            <button
              className="rounded bg-emerald-600 px-4 py-2 text-sm font-semibold text-white disabled:bg-emerald-300"
              onClick={() => saveBusinessSettings.mutate()}
              disabled={saveBusinessSettings.isPending || businessSettings.isLoading}
            >
              Save Business Settings
            </button>
            {businessMessage ? <p className="text-sm text-emerald-700">{businessMessage}</p> : null}
          </div>
        </div>
      ) : null}

      {activeTab === "branches" ? (
        <div className="grid gap-4">
          <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <h2 className="text-2xl font-semibold text-slate-900">Create New Branch</h2>
            <p className="mt-1 text-sm text-slate-600">
              Create a new branch and manage its prefixes, templates, and logo from this page.
            </p>
            <div className="mt-4 grid gap-3 md:grid-cols-[1fr_1fr_auto]">
              <input
                className="rounded border border-slate-300 px-3 py-2"
                placeholder="Branch name"
                value={createBranchForm.name}
                onChange={(e) => setCreateBranchForm((prev) => ({ ...prev, name: e.target.value }))}
              />
              <input
                className="rounded border border-slate-300 px-3 py-2"
                placeholder="Branch code (e.g. BLR01)"
                value={createBranchForm.code}
                onChange={(e) => setCreateBranchForm((prev) => ({ ...prev, code: e.target.value.toUpperCase() }))}
              />
              <button
                className="rounded bg-slate-900 px-4 py-2 text-sm font-semibold text-white disabled:bg-slate-400"
                onClick={() => createBranch.mutate()}
                disabled={createBranch.isPending || !createBranchForm.name.trim() || !createBranchForm.code.trim()}
              >
                Create Branch
              </button>
            </div>
            {branchMessage ? <p className="mt-3 text-sm text-emerald-700">{branchMessage}</p> : null}
          </div>

          <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="flex flex-wrap items-center gap-3">
              <h2 className="text-2xl font-semibold text-slate-900">Branch Settings</h2>
              <select
                className="rounded border border-slate-300 px-3 py-2 text-sm"
                value={selectedBranch.id}
                onChange={(e) => {
                  setSelectedBranchId(e.target.value);
                  setMessage("");
                }}
              >
                {availableBranches.map((branch) => (
                  <option key={branch.id} value={branch.id}>
                    {branch.name} ({branch.code})
                  </option>
                ))}
              </select>
            </div>

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
                Save Branch Settings
              </button>
              {message ? <p className="text-sm text-emerald-700">{message}</p> : null}
            </div>
          </div>
        </div>
      ) : null}

      {activeTab === "cashiers" ? (
        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex flex-wrap items-center gap-3">
            <h2 className="text-2xl font-semibold text-slate-900">Cashier Accounts</h2>
            <select
              className="rounded border border-slate-300 px-3 py-2 text-sm"
              value={selectedBranch.id}
              onChange={(e) => {
                setSelectedBranchId(e.target.value);
                setUserMessage("");
              }}
            >
              {availableBranches.map((branch) => (
                <option key={branch.id} value={branch.id}>
                  {branch.name} ({branch.code})
                </option>
              ))}
            </select>
          </div>
          <p className="mt-1 text-sm text-slate-600">Create and manage cashier logins, branch access, and account status.</p>

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
            <div className="rounded border border-slate-200 p-2 text-sm">
              <p className="text-xs font-semibold text-slate-600">Branch Access</p>
              <div className="mt-1 flex flex-wrap gap-2">
                {availableBranches.map((branch) => {
                  const checked = cashierForm.branchIds.includes(branch.id);
                  return (
                    <label key={branch.id} className="inline-flex items-center gap-1 text-xs">
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={(e) => {
                          setCashierForm((prev) => ({
                            ...prev,
                            branchIds: e.target.checked
                              ? Array.from(new Set([...prev.branchIds, branch.id]))
                              : prev.branchIds.filter((id) => id !== branch.id)
                          }));
                        }}
                      />
                      {branch.code}
                    </label>
                  );
                })}
              </div>
            </div>
            <button
              className="rounded bg-slate-900 px-4 py-2 text-sm font-semibold text-white"
              onClick={() => createCashier.mutate()}
              disabled={createCashier.isPending || !cashierForm.username.trim() || !cashierForm.password || cashierForm.branchIds.length === 0}
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
                    <p className="mt-1 text-xs text-slate-500">Branch access: {user.branchIds.join(", ")}</p>
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
                    onChange={(e) => setPasswordByUserId((prev) => ({ ...prev, [user.id]: e.target.value }))}
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
                <div className="mt-3 rounded border border-slate-200 p-2">
                  <p className="text-xs font-semibold text-slate-600">Branch Access</p>
                  <div className="mt-2 flex flex-wrap gap-3">
                    {availableBranches.map((branch) => {
                      const hasAccess = user.branchIds.includes(branch.id);
                      const isPrimary = user.branchId === branch.id;
                      return (
                        <label key={`${user.id}-${branch.id}`} className="inline-flex items-center gap-1 text-xs">
                          <input
                            type="checkbox"
                            checked={hasAccess}
                            disabled={isPrimary}
                            onChange={(e) => {
                              if (e.target.checked) {
                                grantBranchAccess.mutate({ id: user.id, branchId: branch.id });
                              } else {
                                revokeBranchAccess.mutate({ id: user.id, branchId: branch.id });
                              }
                            }}
                          />
                          {branch.name} ({branch.code}){isPrimary ? " - Primary" : ""}
                        </label>
                      );
                    })}
                  </div>
                </div>
              </div>
            ))}
            {cashiers.length === 0 ? <p className="text-sm text-slate-500">No cashier accounts yet for this branch.</p> : null}
          </div>

          {userMessage ? <p className="mt-3 text-sm text-emerald-700">{userMessage}</p> : null}
        </div>
      ) : null}
    </section>
  );
}
