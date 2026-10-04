import { CrashReportsSetting } from "../components/CrashReportsChoice";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useSearch } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import {
  BRANCH_CODE_LENGTH,
  branchCodeProblem,
  financialYearStart,
  GST_STATES,
  gstinProblem,
  gstStateLabel,
  isGstStateCode,
  type CashierPermission,
} from "@pos/contracts";
import { api, apiErrorMessage, apiFetch, authHeaders, uploadSrc } from "../lib/api";
import { requireAdmin } from "./route-helpers";
import { GoOnlineDialog, OnlineOnlyBadge } from "../components/OnlineOnly";
import { useHosting, useIsOffline } from "../lib/mode";
import { desktop } from "../lib/desktop";
import { BackupsSection } from "./settings/BackupsSection";
import { PrinterSection } from "./settings/PrinterSection";
import { ReceiptTemplateSection } from "./settings/ReceiptTemplateSection";
import { canMoveOnline, MoveOnlineDialog } from "../components/MoveOnline";
import { RecoveryCodeSettings } from "../components/RecoveryCode";
import { CountersSection } from "./settings/CountersSection";
import { CashierPermissions } from "./settings/CashierPermissions";
import { TaxpayerTypeSection } from "./settings/TaxpayerTypeSection";
import { BillingSection } from "./settings/BillingSection";
import { DataExportSection } from "./settings/DataExportSection";

type SettingsForm = {
  name: string;
  code: string;
  logoUrl: string | null;
  receiptPrefix: string;
  invoiceHeader: string;
  invoiceFooter: string;
  receiptHeader: string;
  receiptFooter: string;
  invoiceCss: string;
  receiptCss: string;
  gstin: string;
  stateCode: string;
};

type BusinessSettingsForm = {
  name: string;
  logoUrl: string | null;
  gstNumber: string;
  taxCalculationMode: "AFTER_DISCOUNT" | "BEFORE_DISCOUNT";
  cashierMaxDiscountPercent: string;
  customerScope: "SHARED" | "BRANCH";
  timezone: string;
  hsnMinDigits: 4 | 6;
  /** Days; empty for no limit. */
  returnWindowDays: string;
};

type CashierForm = {
  username: string;
  password: string;
  branchIds: string[];
  permissions: CashierPermission[];
};

type CreateBranchForm = {
  name: string;
  code: string;
};

type SettingsTab = "business" | "branches" | "receipts" | "cashiers" | "printer" | "backups" | "billing" | "data";

const emptyCashierForm = (branchId: string): CashierForm => ({ username: "", password: "", branchIds: [branchId], permissions: [] });

/** Every IANA zone this browser knows, keeping the saved one even if it isn't listed. */
function timeZoneOptions(current: string) {
  const supported =
    typeof Intl.supportedValuesOf === "function" ? Intl.supportedValuesOf("timeZone") : ["Asia/Kolkata", "UTC"];
  return supported.includes(current) ? supported : [current, ...supported];
}

export function BranchSettingsPage() {
  const session = requireAdmin();
  const initialBranchId = session.branchId ?? session.branches[0]?.id ?? "";
  const queryClient = useQueryClient();
  const search = useSearch({ from: "/settings" });
  const [activeTab, setActiveTab] = useState<SettingsTab>(search.tab === "billing" ? "billing" : "business");
  const [selectedBranchId, setSelectedBranchId] = useState(initialBranchId);
  const [message, setMessage] = useState("");
  const [businessMessage, setBusinessMessage] = useState("");
  const [branchMessage, setBranchMessage] = useState("");
  const offline = useIsOffline();
  const hosting = useHosting();
  // The subscription banner's link, also while this page is already open.
  useEffect(() => {
    if (search.tab === "billing") setActiveTab("billing");
  }, [search.tab]);
  // Backups are kept by the desktop app, on the computer that holds an offline business.
  const localBackups = desktop?.config.mode === "offline" ? desktop.backups : undefined;
  // The receipt printer and cash drawer belong to this computer (desktop app, either mode).
  const receiptPrinter = desktop?.printing;
  const [goOnlinePrompt, setGoOnlinePrompt] = useState(false);
  const [movingOnline, setMovingOnline] = useState(false);
  const [userMessage, setUserMessage] = useState("");
  const [cashierForm, setCashierForm] = useState<CashierForm>(emptyCashierForm(initialBranchId));
  const [createBranchForm, setCreateBranchForm] = useState<CreateBranchForm>({ name: "", code: "" });
  const [passwordByUserId, setPasswordByUserId] = useState<Record<string, string>>({});
  // Unticked: the cashier keeps the password the admin sets. Ticked (the default): they choose their own.
  const [keepPasswordByUserId, setKeepPasswordByUserId] = useState<Record<string, boolean>>({});

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
    receiptPrefix: "RCPT",
    invoiceHeader: "",
    invoiceFooter: "",
    receiptHeader: "",
    receiptFooter: "",
    invoiceCss: "",
    receiptCss: "",
    gstin: "",
    stateCode: ""
  });
  const [businessForm, setBusinessForm] = useState<BusinessSettingsForm>({
    name: "",
    logoUrl: null,
    gstNumber: "",
    taxCalculationMode: "AFTER_DISCOUNT",
    cashierMaxDiscountPercent: "10",
    customerScope: "SHARED",
    timezone: "Asia/Kolkata",
    hsnMinDigits: 4,
    returnWindowDays: ""
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
      taxCalculationMode: businessSettings.data.taxCalculationMode,
      cashierMaxDiscountPercent: String(businessSettings.data.cashierMaxDiscountPercent),
      customerScope: businessSettings.data.customerScope,
      timezone: businessSettings.data.timezone,
      hsnMinDigits: businessSettings.data.hsnMinDigits === 6 ? 6 : 4,
      returnWindowDays: businessSettings.data.returnWindowDays === null ? "" : String(businessSettings.data.returnWindowDays)
    });
  }, [businessSettings.data]);

  useEffect(() => {
    if (!branchSettings.data) return;
    setForm({
      name: branchSettings.data.name,
      code: branchSettings.data.code,
      logoUrl: branchSettings.data.logoUrl,
      receiptPrefix: branchSettings.data.receiptPrefix,
      invoiceHeader: branchSettings.data.invoiceHeader ?? "",
      invoiceFooter: branchSettings.data.invoiceFooter ?? "",
      receiptHeader: branchSettings.data.receiptHeader ?? "",
      receiptFooter: branchSettings.data.receiptFooter ?? "",
      invoiceCss: branchSettings.data.invoiceCss ?? "",
      receiptCss: branchSettings.data.receiptCss ?? "",
      gstin: branchSettings.data.gstin ?? "",
      stateCode: branchSettings.data.stateCode ?? ""
    });
  }, [branchSettings.data]);

  const currentFiscalYear = useMemo(() => {
    const timeZone = businessSettings.data?.timezone ?? "Asia/Kolkata";
    const [year, month] = new Intl.DateTimeFormat("en-CA", { timeZone }).format(new Date()).split("-").map(Number);
    return financialYearStart(year, month);
  }, [businessSettings.data?.timezone]);

  const logoSrc = uploadSrc(form.logoUrl);

  const businessLogoSrc = uploadSrc(businessForm.logoUrl);

  const saveBusinessSettings = useMutation({
    mutationFn: async () => {
      const emptyToNull = (value: string) => (value.trim() ? value.trim() : null);
      const trimmedName = businessForm.name.trim();
      if (!trimmedName) {
        throw new Error("Business name is required.");
      }
      const cashierMaxDiscountPercent = Number(businessForm.cashierMaxDiscountPercent);
      if (
        businessForm.cashierMaxDiscountPercent.trim() === "" ||
        !Number.isFinite(cashierMaxDiscountPercent) ||
        cashierMaxDiscountPercent < 0 ||
        cashierMaxDiscountPercent > 100
      ) {
        throw new Error("Cashier discount limit must be between 0 and 100.");
      }
      const returnWindowText = businessForm.returnWindowDays.trim();
      const returnWindowDays = returnWindowText === "" ? null : Number(returnWindowText);
      if (returnWindowDays !== null && (!Number.isInteger(returnWindowDays) || returnWindowDays < 0 || returnWindowDays > 3650)) {
        throw new Error("Return window must be a whole number of days, or empty for no limit.");
      }
      const res = await api.business.update({
        body: {
          name: trimmedName,
          logoUrl: businessForm.logoUrl,
          gstNumber: emptyToNull(businessForm.gstNumber),
          taxCalculationMode: businessForm.taxCalculationMode,
          cashierMaxDiscountPercent,
          customerScope: businessForm.customerScope,
          timezone: businessForm.timezone,
          hsnMinDigits: businessForm.hsnMinDigits,
          returnWindowDays
        },
        extraHeaders: authHeaders()
      });
      if (res.status !== 200) throw new Error(apiErrorMessage(res.body, "Failed to save business settings"));
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
    const res = await apiFetch("/business/logo", { method: "POST", body });
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
      const codeProblem = branchCodeProblem(trimmedCode);
      if (codeProblem) {
        throw new Error(codeProblem);
      }
      const res = await api.branches.create({
        body: { name: trimmedName, code: trimmedCode },
        extraHeaders: authHeaders()
      });
      if (res.status !== 201) throw new Error(apiErrorMessage(res.body, "Failed to create branch"));
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
      const trimmedCode = form.code.trim().toUpperCase();
      const codeProblem = branchCodeProblem(trimmedCode);
      if (codeProblem) {
        throw new Error(codeProblem);
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
          receiptPrefix: form.receiptPrefix.trim(),
          invoiceHeader: emptyToNull(form.invoiceHeader),
          invoiceFooter: emptyToNull(form.invoiceFooter),
          receiptHeader: emptyToNull(form.receiptHeader),
          receiptFooter: emptyToNull(form.receiptFooter),
          invoiceCss: emptyToNull(form.invoiceCss),
          receiptCss: emptyToNull(form.receiptCss),
          gstin: emptyToNull(form.gstin.trim().toUpperCase()),
          stateCode: emptyToNull(form.stateCode)
        },
        extraHeaders: authHeaders()
      });
      if (res.status !== 200) throw new Error(apiErrorMessage(res.body, "Failed to save branch settings"));
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
    const res = await apiFetch(`/branches/${selectedBranchId}/logo`, { method: "POST", body });
    if (!res.ok) throw new Error("Failed to upload logo");
    return (await res.json()) as {
      name: string;
      code: string;
      logoUrl: string | null;
      receiptPrefix: string;
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
        receiptPrefix: updated.receiptPrefix ?? prev.receiptPrefix,
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
          branchIds: cashierForm.branchIds,
          permissions: cashierForm.permissions
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
    mutationFn: async (payload: {
      id: string;
      username?: string;
      password?: string;
      mustChangePassword?: boolean;
      isActive?: boolean;
      permissions?: CashierPermission[];
    }) => {
      const res = await api.users.update({
        params: { id: payload.id },
        body: {
          username: payload.username,
          password: payload.password,
          mustChangePassword: payload.mustChangePassword,
          isActive: payload.isActive,
          permissions: payload.permissions
        },
        extraHeaders: authHeaders()
      });
      if (res.status !== 200) throw new Error(apiErrorMessage(res.body, "Failed to update user"));
      return res.body;
    },
    onSuccess: (updated, payload) => {
      queryClient.invalidateQueries({ queryKey: ["branch-users", selectedBranchId] });
      setUserMessage(
        payload.permissions !== undefined
          ? `What ${updated.username} may do is saved; it applies from their next action.`
          : payload.password === undefined
          ? "User updated."
          : updated.mustChangePassword
            ? `New password set. ${updated.username} is signed out everywhere and chooses their own password at next sign-in.`
            : `New password set. ${updated.username} is signed out everywhere.`
      );
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
    <section>
      <div className="sticky top-0 z-10 border-b border-slate-200 bg-white px-6">
        <nav className="-mb-px flex gap-6 overflow-x-auto" aria-label="Settings sections">
          {[
            { id: "business" as const, label: "Business" },
            { id: "branches" as const, label: "Branches" },
            { id: "receipts" as const, label: "Receipts" },
            { id: "cashiers" as const, label: "Cashiers & Access" },
            ...(receiptPrinter ? [{ id: "printer" as const, label: "Printer" }] : []),
            ...(localBackups ? [{ id: "backups" as const, label: "Backups" }] : []),
            ...(hosting === "managed" ? [{ id: "billing" as const, label: "Billing" }] : []),
            { id: "data" as const, label: "Your data" }
          ].map((tab) => (
            <button
              key={tab.id}
              className={`border-b-2 px-1 py-3 text-sm font-semibold whitespace-nowrap transition-colors ${
                activeTab === tab.id
                  ? "border-brand-600 text-brand-700"
                  : "border-transparent text-slate-500 hover:border-slate-300 hover:text-slate-800"
              }`}
              aria-current={activeTab === tab.id ? "page" : undefined}
              onClick={() => setActiveTab(tab.id)}
            >
              {tab.label}
            </button>
          ))}
        </nav>
      </div>
      <div className="mx-auto grid max-w-7xl gap-4 p-6">

      {activeTab === "business" ? (
        <div className="grid gap-4">
          <RecoveryCodeSettings />
          <CrashReportsSetting />
          {canMoveOnline() ? (
            <div className="card flex flex-wrap items-center justify-between gap-3 p-5">
              <div className="max-w-xl">
                <h2 className="text-lg font-semibold tracking-tight text-slate-900">On this computer only</h2>
                <p className="mt-1 text-sm text-slate-600">
                  Move the business online to add counters and branches and sign in from other computers. Everything moves with it.
                </p>
              </div>
              <button className="btn-primary" onClick={() => setMovingOnline(true)}>
                Move business online
              </button>
              {movingOnline ? <MoveOnlineDialog onClose={() => setMovingOnline(false)} /> : null}
            </div>
          ) : null}
          {hosting ? (
            <div className="card p-5">
              <h2 className="text-lg font-semibold tracking-tight text-slate-900">Server</h2>
              <p className="mt-1 text-sm text-slate-600">
                {hosting === "managed"
                  ? "This business is on our hosted service."
                  : "This business is on its own server (self-hosted)."}
              </p>
            </div>
          ) : null}
          <div className="card p-5">
            <h2 className="text-lg font-semibold tracking-tight text-slate-900">Business Settings</h2>
            <p className="mt-1 text-sm text-slate-600">
              Configure global details shared by all branches, including logo and GST number.
            </p>

            <div className="mt-5 grid gap-5 lg:grid-cols-[1.2fr_1fr]">
              <div className="space-y-4">
                <div>
                  <label className="text-sm text-slate-600">Business name</label>
                  <input
                    className="field mt-1"
                    value={businessForm.name}
                    onChange={(e) => setBusinessForm((prev) => ({ ...prev, name: e.target.value }))}
                  />
                </div>
                <div>
                  <label className="text-sm text-slate-600">GST number</label>
                  <input
                    className="field mt-1"
                    value={businessForm.gstNumber}
                    onChange={(e) => setBusinessForm((prev) => ({ ...prev, gstNumber: e.target.value.toUpperCase() }))}
                    placeholder="e.g. 29ABCDE1234F1ZW"
                  />
                  {businessForm.gstNumber.trim() && gstinProblem(businessForm.gstNumber.trim()) ? (
                    <p className="mt-1 text-xs text-rose-700">{gstinProblem(businessForm.gstNumber.trim())}</p>
                  ) : null}
                </div>
                <div>
                  <label className="text-sm text-slate-600">Tax calculation mode</label>
                  <select
                    className="field mt-1"
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
                <div>
                  <label className="text-sm text-slate-600">Cashier discount limit (%)</label>
                  <input
                    className="field mt-1"
                    inputMode="decimal"
                    value={businessForm.cashierMaxDiscountPercent}
                    onChange={(e) =>
                      setBusinessForm((prev) => ({ ...prev, cashierMaxDiscountPercent: e.target.value }))
                    }
                  />
                  <p className="mt-1 text-xs text-slate-500">
                    The most a cashier can take off a sale's list price, counting price changes and discounts together.
                    Admins have no limit.
                  </p>
                </div>
                <div>
                  <label className="text-sm text-slate-600">Return window for cashiers (days)</label>
                  <input
                    className="field mt-1"
                    inputMode="numeric"
                    placeholder="No limit"
                    value={businessForm.returnWindowDays}
                    onChange={(e) => setBusinessForm((prev) => ({ ...prev, returnWindowDays: e.target.value }))}
                  />
                  <p className="mt-1 text-xs text-slate-500">
                    How many days after a sale a cashier can still take its goods back (0: the same day only). Empty for no
                    limit. Admins can always make a return.
                  </p>
                </div>
                <div>
                  <label className="text-sm text-slate-600">Customers</label>
                  <select
                    className="field mt-1"
                    value={businessForm.customerScope}
                    onChange={(e) =>
                      setBusinessForm((prev) => ({ ...prev, customerScope: e.target.value as "SHARED" | "BRANCH" }))
                    }
                  >
                    <option value="SHARED">Shared across all branches</option>
                    <option value="BRANCH">Separate for each branch</option>
                  </select>
                  <p className="mt-1 text-xs text-slate-500">
                    Shared: a customer and their wallet balance can be used at any branch, and a phone number belongs to one
                    customer business-wide. Separate: each branch only sees the customers it created.
                  </p>
                </div>
                <div>
                  <label className="text-sm text-slate-600">Time zone</label>
                  <select
                    className="field mt-1"
                    value={businessForm.timezone}
                    onChange={(e) => setBusinessForm((prev) => ({ ...prev, timezone: e.target.value }))}
                  >
                    {timeZoneOptions(businessForm.timezone).map((zone) => (
                      <option key={zone} value={zone}>
                        {zone}
                      </option>
                    ))}
                  </select>
                  <p className="mt-1 text-xs text-slate-500">
                    Reports work out Today, This Week and This Month on this clock.
                  </p>
                </div>
                <div>
                  <label className="text-sm text-slate-600">HSN code length</label>
                  <select
                    className="field mt-1"
                    value={businessForm.hsnMinDigits}
                    onChange={(e) =>
                      setBusinessForm((prev) => ({ ...prev, hsnMinDigits: Number(e.target.value) === 6 ? 6 : 4 }))
                    }
                  >
                    <option value={4}>At least 4 digits (turnover up to ₹5 crore)</option>
                    <option value={6}>At least 6 digits (turnover above ₹5 crore)</option>
                  </select>
                  <p className="mt-1 text-xs text-slate-500">
                    The shortest HSN or SAC code accepted on items, set by last year's turnover.
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
                      className="btn-secondary px-2 py-1 text-xs"
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
                className="btn-primary"
                onClick={() => saveBusinessSettings.mutate()}
                disabled={saveBusinessSettings.isPending || businessSettings.isLoading}
              >
                Save Business Settings
              </button>
              {businessMessage ? <p className="text-sm text-emerald-700">{businessMessage}</p> : null}
            </div>
          </div>

          <TaxpayerTypeSection timeZone={businessSettings.data?.timezone ?? "Asia/Kolkata"} />
        </div>
      ) : null}

      {activeTab === "branches" ? (
        <div className="grid gap-4">
          <div className="card p-5">
            <div className="flex items-center gap-2">
              <h2 className="text-lg font-semibold tracking-tight text-slate-900">Create New Branch</h2>
              {offline ? <OnlineOnlyBadge /> : null}
            </div>
            <p className="mt-1 text-sm text-slate-600">
              Create a new branch and manage its prefixes, templates, and logo from this page.
            </p>
            <div className="mt-4 grid gap-3 md:grid-cols-[1fr_1fr_auto]">
              <input
                className="field"
                placeholder="Branch name"
                value={createBranchForm.name}
                onChange={(e) => setCreateBranchForm((prev) => ({ ...prev, name: e.target.value }))}
              />
              <input
                className="field uppercase"
                placeholder="Branch code, 3 letters or digits (e.g. BLR)"
                maxLength={BRANCH_CODE_LENGTH}
                value={createBranchForm.code}
                onChange={(e) => setCreateBranchForm((prev) => ({ ...prev, code: e.target.value.toUpperCase() }))}
              />
              <button
                className="btn-primary"
                onClick={() => (offline ? setGoOnlinePrompt(true) : createBranch.mutate())}
                disabled={!offline && (createBranch.isPending || !createBranchForm.name.trim() || !createBranchForm.code.trim())}
              >
                Create Branch
              </button>
            </div>
            {branchMessage ? <p className="mt-3 text-sm text-emerald-700">{branchMessage}</p> : null}
          </div>
          {goOnlinePrompt ? (
            <GoOnlineDialog title="More branches" feature="more than one branch" onClose={() => setGoOnlinePrompt(false)} />
          ) : null}

          <div className="card p-5">
            <div className="flex flex-wrap items-center gap-3">
              <h2 className="text-lg font-semibold tracking-tight text-slate-900">Branch Settings</h2>
              <select
                className="field w-auto"
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
                    className="field mt-1"
                    value={form.name}
                    onChange={(e) => setForm((prev) => ({ ...prev, name: e.target.value }))}
                  />
                </div>
                <div>
                  <label className="text-sm text-slate-600">Branch code</label>
                  <input
                    className="field mt-1 uppercase"
                    maxLength={BRANCH_CODE_LENGTH}
                    value={form.code}
                    onChange={(e) => setForm((prev) => ({ ...prev, code: e.target.value.toUpperCase() }))}
                  />
                  <p className="mt-1 text-xs text-slate-500">
                    {BRANCH_CODE_LENGTH} letters or digits. Starts every invoice and credit note number (see Counters below);
                    changing it starts new series for future documents only.
                  </p>
                </div>

                <div className="grid gap-3 sm:grid-cols-2">
                  <div>
                    <label className="text-sm text-slate-600">GSTIN</label>
                    <input
                      className="field mt-1 uppercase"
                      value={form.gstin}
                      placeholder="Leave empty to use the business GSTIN"
                      onChange={(e) => {
                        const gstin = e.target.value.toUpperCase();
                        const state = gstin.trim().slice(0, 2);
                        setForm((prev) => ({ ...prev, gstin, stateCode: isGstStateCode(state) ? state : prev.stateCode }));
                      }}
                    />
                    {form.gstin.trim() && gstinProblem(form.gstin.trim().toUpperCase()) ? (
                      <p className="mt-1 text-xs text-rose-700">{gstinProblem(form.gstin.trim().toUpperCase())}</p>
                    ) : null}
                  </div>
                  <div>
                    <label className="text-sm text-slate-600">State</label>
                    <select
                      className="field mt-1"
                      value={form.stateCode}
                      onChange={(e) => setForm((prev) => ({ ...prev, stateCode: e.target.value }))}
                    >
                      <option value="">Not set</option>
                      {GST_STATES.map((state) => (
                        <option key={state.code} value={state.code}>
                          {gstStateLabel(state.code)}
                        </option>
                      ))}
                    </select>
                  </div>
                  <p className="text-xs text-slate-500 sm:col-span-2">
                    Each state the business sells from has its own GSTIN. A branch without one uses the business GSTIN when that
                    is for the branch's state. The state is the place of supply of counter sales.
                  </p>
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
                        className="btn-secondary px-2 py-1 text-xs"
                        onClick={() => setForm((prev) => ({ ...prev, logoUrl: null }))}
                      >
                        Remove logo
                      </button>
                    </div>
                  </div>
                </div>

                <div className="grid gap-3 sm:grid-cols-3">
                  <div>
                    <label className="text-sm text-slate-600">Receipt prefix</label>
                    <input
                      className="field mt-1"
                      value={form.receiptPrefix}
                      onChange={(e) => setForm((prev) => ({ ...prev, receiptPrefix: e.target.value }))}
                    />
                  </div>
                  <p className="text-xs text-slate-500 sm:col-span-2 sm:self-end">
                    Invoice and credit note numbers come from the branch code and each counter's number; see Counters below.
                  </p>
                </div>
              </div>

              <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                <p className="text-sm font-semibold text-slate-800">Printable templates</p>
                <p className="mt-1 text-xs text-slate-500">
                  Header and footer text for receipts and invoices. Paper, layout and what prints are set under Receipts; optional CSS restyles them.
                </p>
                <div className="mt-4 grid gap-3">
                  <div>
                    <label className="text-xs text-slate-600">Invoice header</label>
                    <textarea
                      className="field mt-1"
                      rows={2}
                      value={form.invoiceHeader}
                      onChange={(e) => setForm((prev) => ({ ...prev, invoiceHeader: e.target.value }))}
                    />
                  </div>
                  <div>
                    <label className="text-xs text-slate-600">Invoice footer</label>
                    <textarea
                      className="field mt-1"
                      rows={2}
                      value={form.invoiceFooter}
                      onChange={(e) => setForm((prev) => ({ ...prev, invoiceFooter: e.target.value }))}
                    />
                  </div>
                  <div>
                    <label className="text-xs text-slate-600">Invoice CSS</label>
                    <textarea
                      className="field mt-1 text-xs font-mono"
                      rows={4}
                      value={form.invoiceCss}
                      onChange={(e) => setForm((prev) => ({ ...prev, invoiceCss: e.target.value }))}
                    />
                  </div>
                  <div>
                    <label className="text-xs text-slate-600">Receipt header</label>
                    <textarea
                      className="field mt-1"
                      rows={2}
                      value={form.receiptHeader}
                      onChange={(e) => setForm((prev) => ({ ...prev, receiptHeader: e.target.value }))}
                    />
                  </div>
                  <div>
                    <label className="text-xs text-slate-600">Receipt footer</label>
                    <textarea
                      className="field mt-1"
                      rows={2}
                      value={form.receiptFooter}
                      onChange={(e) => setForm((prev) => ({ ...prev, receiptFooter: e.target.value }))}
                    />
                  </div>
                  <div>
                    <label className="text-xs text-slate-600">Receipt CSS</label>
                    <textarea
                      className="field mt-1 text-xs font-mono"
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
                className="btn-primary"
                onClick={() => saveSettings.mutate()}
                disabled={saveSettings.isPending || branchSettings.isLoading}
              >
                Save Branch Settings
              </button>
              {message ? <p className="text-sm text-emerald-700">{message}</p> : null}
            </div>
          </div>

          <CountersSection
            branchId={selectedBranch.id}
            branchName={selectedBranch.name}
            branchCode={selectedBranch.code}
            fiscalYear={currentFiscalYear}
          />
        </div>
      ) : null}

      {activeTab === "receipts" ? (
        <ReceiptTemplateSection
          branches={availableBranches}
          branchId={selectedBranch.id}
          onBranchChange={(id) => {
            setSelectedBranchId(id);
            setMessage("");
          }}
        />
      ) : null}

      {activeTab === "billing" && hosting === "managed" ? <BillingSection /> : null}
      {activeTab === "data" ? (
        <div className="p-6">
          <DataExportSection branches={availableBranches} timeZone={businessSettings.data?.timezone} />
        </div>
      ) : null}

      {activeTab === "printer" && receiptPrinter ? (
        <PrinterSection printing={receiptPrinter} branchId={initialBranchId} />
      ) : null}
      {activeTab === "backups" && localBackups ? <BackupsSection backups={localBackups} /> : null}

      {activeTab === "cashiers" ? (
        <div className="card p-5">
          <div className="flex flex-wrap items-center gap-3">
            <h2 className="text-lg font-semibold tracking-tight text-slate-900">Cashier Accounts</h2>
            <select
              className="field"
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
              className="field"
              placeholder="Username"
              value={cashierForm.username}
              onChange={(e) => setCashierForm((prev) => ({ ...prev, username: e.target.value }))}
            />
            <input
              className="field"
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
            <div className="md:col-span-3">
              <CashierPermissions
                value={cashierForm.permissions}
                onChange={(permissions) => setCashierForm((prev) => ({ ...prev, permissions }))}
              />
            </div>
            <button
              className="btn-primary"
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
                    <p className="font-semibold text-slate-900">
                      {user.username}
                      {user.mustChangePassword ? (
                        <span className="ml-2 rounded bg-amber-100 px-1.5 py-0.5 text-[11px] font-semibold text-amber-800">
                          Chooses a new password at next sign-in
                        </span>
                      ) : null}
                    </p>
                    <p className="text-xs text-slate-500">
                      Status: {user.isActive ? "Active" : "Inactive"} • Created {new Date(user.createdAt).toLocaleDateString()}
                    </p>
                    <p className="mt-1 text-xs text-slate-500">
                      Branch access: {user.branchIds.map((id) => availableBranches.find((branch) => branch.id === id)?.code ?? id).join(", ")}
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
                    className="field"
                    placeholder="New password"
                    type="password"
                    value={passwordByUserId[user.id] ?? ""}
                    onChange={(e) => setPasswordByUserId((prev) => ({ ...prev, [user.id]: e.target.value }))}
                  />
                  <button
                    className="btn-secondary px-3 py-1 text-xs"
                    onClick={() => {
                      const nextPassword = passwordByUserId[user.id];
                      if (!nextPassword?.trim()) {
                        setUserMessage("Enter a password to reset.");
                        return;
                      }
                      updateUser.mutate({ id: user.id, password: nextPassword, mustChangePassword: !keepPasswordByUserId[user.id] });
                      setPasswordByUserId((prev) => ({ ...prev, [user.id]: "" }));
                    }}
                  >
                    Reset Password
                  </button>
                  <label className="inline-flex items-center gap-1.5 text-xs text-slate-600">
                    <input
                      type="checkbox"
                      checked={!keepPasswordByUserId[user.id]}
                      onChange={(e) => setKeepPasswordByUserId((prev) => ({ ...prev, [user.id]: !e.target.checked }))}
                    />
                    Ask them to choose their own at next sign-in
                  </label>
                </div>
                <div className="mt-3">
                  <CashierPermissions
                    value={user.permissions ?? []}
                    disabled={updateUser.isPending}
                    onChange={(permissions) => updateUser.mutate({ id: user.id, permissions })}
                  />
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
      </div>
    </section>
  );
}
