import { CrashReportsSetting } from "../components/CrashReportsChoice";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useSearch } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { branchCodeProblem, financialYearStart } from "@pos/contracts";
import { api, apiErrorMessage, authHeaders } from "../lib/api";
import { requireAdmin } from "./route-helpers";
import { useHosting, useIsOffline } from "../lib/mode";
import { desktop } from "../lib/desktop";
import { BackupsSection } from "./settings/BackupsSection";
import { PrinterSection } from "./settings/PrinterSection";
import { ReceiptTemplateSection } from "./settings/ReceiptTemplateSection";
import { canMoveOnline, MoveOnlineDialog } from "../components/MoveOnline";
import { RecoveryCodeSettings } from "../components/RecoveryCode";
import { CountersSection } from "./settings/CountersSection";
import { TaxpayerTypeSection } from "./settings/TaxpayerTypeSection";
import { BillingSection } from "./settings/BillingSection";
import { DataExportSection } from "./settings/DataExportSection";
import { BusinessSettingsCard } from "./settings/BusinessSettingsCard";
import { CreateBranchCard } from "./settings/CreateBranchCard";
import { BranchDetailsCard } from "./settings/BranchDetailsCard";
import { CashierAccountsSection } from "./settings/CashierAccountsSection";
import {
  emptyCashierForm,
  type BusinessSettingsForm,
  type CashierForm,
  type CreateBranchForm,
  type SettingsForm,
} from "./settings/settingsForms";
import { useBusinessSettingsMutations } from "./settings/useBusinessSettingsMutations";
import { useBranchSettingsMutations } from "./settings/useBranchSettingsMutations";
import { useCashierMutations } from "./settings/useCashierMutations";

type SettingsTab = "business" | "branches" | "receipts" | "cashiers" | "printer" | "backups" | "billing" | "data";

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

  const availableBranches = useMemo(() => branches.data ?? [], [branches.data]);

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
    returnWindowDays: "",
    roundOffMode: "NONE",
    allowNegativeStock: false,
    scaleEnabled: false,
    scalePrefix: "2",
    scaleItemDigits: "6",
    scaleValueType: "WEIGHT",
    scaleValueDigits: "5",
    scaleValueDecimals: "3"
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
      returnWindowDays: businessSettings.data.returnWindowDays === null ? "" : String(businessSettings.data.returnWindowDays),
      roundOffMode: businessSettings.data.roundOffMode ?? "NONE",
      allowNegativeStock: businessSettings.data.allowNegativeStock ?? false,
      scaleEnabled: !!businessSettings.data.scaleBarcode,
      scalePrefix: businessSettings.data.scaleBarcode?.prefix ?? "2",
      scaleItemDigits: String(businessSettings.data.scaleBarcode?.itemDigits ?? 6),
      scaleValueType: businessSettings.data.scaleBarcode?.valueType ?? "WEIGHT",
      scaleValueDigits: String(businessSettings.data.scaleBarcode?.valueDigits ?? 5),
      scaleValueDecimals: String(businessSettings.data.scaleBarcode?.valueDecimals ?? 3)
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

  const { saveBusinessSettings, uploadBusinessLogoMutation } = useBusinessSettingsMutations({
    businessForm,
    setBusinessForm,
    setBusinessMessage,
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

  const { saveSettings, uploadLogoMutation } = useBranchSettingsMutations({
    selectedBranchId,
    form,
    setForm,
    setMessage,
  });

  const { createCashier, updateUser, grantBranchAccess, revokeBranchAccess } = useCashierMutations({
    selectedBranchId,
    cashierForm,
    setCashierForm,
    setUserMessage,
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
          <BusinessSettingsCard
            businessForm={businessForm}
            setBusinessForm={setBusinessForm}
            businessSettings={businessSettings}
            saveBusinessSettings={saveBusinessSettings}
            uploadBusinessLogoMutation={uploadBusinessLogoMutation}
            businessMessage={businessMessage}
          />

          <TaxpayerTypeSection timeZone={businessSettings.data?.timezone ?? "Asia/Kolkata"} />
        </div>
      ) : null}

      {activeTab === "branches" ? (
        <div className="grid gap-4">
          <CreateBranchCard
            offline={offline}
            createBranchForm={createBranchForm}
            setCreateBranchForm={setCreateBranchForm}
            createBranch={createBranch}
            branchMessage={branchMessage}
            goOnlinePrompt={goOnlinePrompt}
            setGoOnlinePrompt={setGoOnlinePrompt}
          />

          <BranchDetailsCard
            availableBranches={availableBranches}
            selectedBranch={selectedBranch}
            setSelectedBranchId={setSelectedBranchId}
            form={form}
            setForm={setForm}
            branchSettings={branchSettings}
            saveSettings={saveSettings}
            uploadLogoMutation={uploadLogoMutation}
            message={message}
            setMessage={setMessage}
          />

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
        <CashierAccountsSection
          availableBranches={availableBranches}
          selectedBranch={selectedBranch}
          setSelectedBranchId={setSelectedBranchId}
          cashierForm={cashierForm}
          setCashierForm={setCashierForm}
          cashiers={cashiers}
          passwordByUserId={passwordByUserId}
          setPasswordByUserId={setPasswordByUserId}
          keepPasswordByUserId={keepPasswordByUserId}
          setKeepPasswordByUserId={setKeepPasswordByUserId}
          createCashier={createCashier}
          updateUser={updateUser}
          grantBranchAccess={grantBranchAccess}
          revokeBranchAccess={revokeBranchAccess}
          userMessage={userMessage}
          setUserMessage={setUserMessage}
        />
      ) : null}
      </div>
    </section>
  );
}
