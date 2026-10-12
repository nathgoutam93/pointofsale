import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { invoiceDue } from "@pos/contracts";
import { api, apiErrorMessage, authHeaders } from "../lib/api";
import { buyerBody, buyerFrom, emptyBuyer, type BuyerDetails } from "../components/BuyerFields";
import { creditBody, creditFrom, emptyCredit, type CreditDetails } from "../components/CreditFields";
import { AgeingPanel } from "./customers/AgeingPanel";
import { StatementPanel } from "./customers/StatementPanel";
import { CustomerCard } from "./customers/CustomerCard";
import { CustomerList } from "./customers/CustomerList";
import { NewCustomerForm } from "./customers/NewCustomerForm";
import { WalletAdjustForm } from "./customers/WalletAdjustForm";
import { WalletTopupForm } from "./customers/WalletTopupForm";
import { BranchPicker } from "../components/BranchPicker";
import { useManagedBranch } from "../lib/branch";
import { can } from "../lib/session";
import { requireManagementSession } from "./route-helpers";

export function CustomersPage() {
    const session = requireManagementSession();
    const [managedBranch, setManagedBranch] = useManagedBranch();
    const branchId = managedBranch ?? "";
    const queryClient = useQueryClient();
    const [name, setName] = useState("");
    const [phone, setPhone] = useState("");
    const [search, setSearch] = useState("");
    const [selectedCustomerId, setSelectedCustomerId] = useState<string | null>(
        null,
    );
    const [showCreateForm, setShowCreateForm] = useState(false);
    const [isEditingCustomer, setIsEditingCustomer] = useState(false);
    const [editName, setEditName] = useState("");
    const [editPhone, setEditPhone] = useState("");
    // GSTIN, address and email, when creating and when editing.
    const [buyer, setBuyer] = useState<BuyerDetails>(emptyBuyer);
    const [editBuyer, setEditBuyer] = useState<BuyerDetails>(emptyBuyer);
    // Credit limit and payment terms: admins only.
    const isAdmin = session.role === "ADMIN";
    const [credit, setCredit] = useState<CreditDetails>(emptyCredit);
    const [editCredit, setEditCredit] = useState<CreditDetails>(emptyCredit);
    // The right-hand side: a customer, or what everyone owes.
    const [showAgeing, setShowAgeing] = useState(false);
    const [showStatement, setShowStatement] = useState(false);
    const [walletTopupAmount, setWalletTopupAmount] = useState("");
    const [walletTopupMode, setWalletTopupMode] = useState<"CASH" | "CARD" | "UPI">("CASH");
    const [walletAdjustAmount, setWalletAdjustAmount] = useState("");
    const [walletAdjustReason, setWalletAdjustReason] = useState("");
    // Top-ups are money taken at the counter: only on an open register, at its branch.
    const canTakeTopup = !!session.registerId && session.branchId === branchId;

    const customers = useQuery({
        queryKey: ["customers-module", branchId],
        queryFn: async () => {
            const res = await api.customers.list({
                query: { branchId: branchId },
                extraHeaders: authHeaders(),
            });
            if (res.status !== 200) throw new Error("Failed to fetch customers");
            return res.body;
        },
    });

    const createCustomer = useMutation({
        mutationFn: async () => {
            const res = await api.customers.create({
                body: {
                    branchId: branchId,
                    name: name.trim(),
                    phone: phone.trim() || undefined,
                    ...buyerBody(buyer),
                    ...(isAdmin ? creditBody(credit) : {}),
                },
                extraHeaders: authHeaders(),
            });
            if (res.status !== 201) throw new Error(apiErrorMessage(res.body, "Failed to create customer"));
            return res.body;
        },
        onSuccess: (created) => {
            setName("");
            setPhone("");
            setBuyer(emptyBuyer);
            setCredit(emptyCredit);
            setShowCreateForm(false);
            setShowAgeing(false);
            setSelectedCustomerId(created.id);
            queryClient.invalidateQueries({
                queryKey: ["customers-module", branchId],
            });
        },
    });

    const updateCustomer = useMutation({
        mutationFn: async () => {
            if (!selectedCustomer) {
                throw new Error("No customer selected");
            }
            const res = await api.customers.update({
                params: { id: selectedCustomer.id },
                query: { branchId },
                body: {
                    name: editName.trim(),
                    phone: editPhone.trim() || null,
                    ...buyerBody(editBuyer),
                    ...(isAdmin ? creditBody(editCredit) : {}),
                },
                extraHeaders: authHeaders(),
            });
            if (res.status !== 200) throw new Error(apiErrorMessage(res.body, "Failed to update customer"));
            return res.body;
        },
        onSuccess: (updated) => {
            setSelectedCustomerId(updated.id);
            setEditName(updated.name);
            setEditPhone(updated.phone ?? "");
            setEditBuyer(buyerFrom(updated));
            setEditCredit(creditFrom(updated));
            setIsEditingCustomer(false);
            queryClient.invalidateQueries({
                queryKey: ["customers-module", branchId],
            });
            queryClient.invalidateQueries({ queryKey: ["customer-account", updated.id] });
            queryClient.invalidateQueries({ queryKey: ["customers-ageing", branchId] });
        },
    });

    const addWalletCredit = useMutation({
        mutationFn: async (variables: { customerId: string; amount: number; mode: "CASH" | "CARD" | "UPI" }) => {
            const { customerId, amount, mode } = variables;
            if (!customerId) {
                throw new Error("No customer selected");
            }
            if (!Number.isFinite(amount) || amount <= 0) {
                throw new Error("Enter a valid credit amount");
            }
            if (selectedCustomer?.id === customerId && selectedCustomer.isWalkIn) {
                throw new Error("Wallet credit is not available for walk-in customers");
            }

            const res = await api.customers.topupWallet({
                params: { id: customerId },
                query: { branchId },
                body: { amount, mode },
                extraHeaders: authHeaders(),
            });
            if (res.status !== 200) throw new Error(apiErrorMessage(res.body, "Failed to add wallet credit"));
            return res.body;
        },
        onSuccess: (_txn, variables) => {
            setWalletTopupAmount("");
            queryClient.invalidateQueries({
                queryKey: ["customers-module-wallet", variables.customerId],
            });
        },
    });

    // Admins only: correct a balance up or down, with the reason. No money changes hands.
    const adjustWallet = useMutation({
        mutationFn: async (variables: { customerId: string; amount: number; reason: string }) => {
            const res = await api.customers.adjustWallet({
                params: { id: variables.customerId },
                query: { branchId },
                body: { amount: variables.amount, reason: variables.reason },
                extraHeaders: authHeaders(),
            });
            if (res.status !== 200) throw new Error(apiErrorMessage(res.body, "Failed to adjust the wallet"));
            return res.body;
        },
        onSuccess: (_txn, variables) => {
            setWalletAdjustAmount("");
            setWalletAdjustReason("");
            queryClient.invalidateQueries({
                queryKey: ["customers-module-wallet", variables.customerId],
            });
        },
    });

    const visibleCustomers = useMemo(() => {
        return (customers.data ?? []).filter((customer) => !customer.isWalkIn);
    }, [customers.data]);

    const selectedCustomer = useMemo(() => {
        const list = visibleCustomers;
        if (list.length === 0) return null;
        if (!selectedCustomerId) return list[0];
        return (
            list.find((customer) => customer.id === selectedCustomerId) ?? list[0]
        );
    }, [selectedCustomerId, visibleCustomers]);

    useEffect(() => {
        if (!selectedCustomer && selectedCustomerId) {
            setSelectedCustomerId(null);
        }
    }, [selectedCustomer, selectedCustomerId]);

    useEffect(() => {
        if (!selectedCustomer) {
            setIsEditingCustomer(false);
            setEditName("");
            setEditPhone("");
            setWalletTopupAmount("");
            return;
        }
        setIsEditingCustomer(false);
        setEditName(selectedCustomer.name);
        setEditPhone(selectedCustomer.phone ?? "");
        setEditBuyer(buyerFrom(selectedCustomer));
        setEditCredit(creditFrom(selectedCustomer));
        setWalletTopupAmount("");
        setShowStatement(false);
    }, [selectedCustomer]);

    // What they owe (at every branch), against their credit limit.
    const account = useQuery({
        queryKey: ["customer-account", selectedCustomer?.id, branchId],
        enabled: !!selectedCustomer?.id && !selectedCustomer.isWalkIn,
        queryFn: async () => {
            const res = await api.customers.account({
                params: { id: selectedCustomer!.id },
                query: { branchId },
                extraHeaders: authHeaders(),
            });
            if (res.status !== 200) throw new Error("Failed to load what the customer owes");
            return res.body;
        },
    });

    // What each customer owes, and how much of it is overdue, for the list.
    const ageing = useQuery({
        queryKey: ["customers-ageing", branchId],
        enabled: !!branchId,
        queryFn: async () => {
            const res = await api.customers.ageing({ query: { branchId }, extraHeaders: authHeaders() });
            if (res.status !== 200) throw new Error("Failed to load what customers owe");
            return res.body;
        },
    });
    const owedByCustomerId = useMemo(
        () => new Map((ageing.data?.rows ?? []).map((row) => [row.customerId, row])),
        [ageing.data],
    );

    const businessSettings = useQuery({
        queryKey: ["business-settings"],
        queryFn: async () => {
            const res = await api.business.get({ extraHeaders: authHeaders() });
            if (res.status !== 200) throw new Error("Failed to load business settings");
            return res.body;
        },
    });

    const customerWallet = useQuery({
        queryKey: ["customers-module-wallet", selectedCustomer?.id],
        enabled: !!selectedCustomer?.id,
        queryFn: async () => {
            if (!selectedCustomer?.id) {
                throw new Error("No customer selected");
            }
            const res = await api.customers.getWallet({
                params: { id: selectedCustomer.id },
                query: { branchId },
                extraHeaders: authHeaders(),
            });
            if (res.status !== 200) throw new Error("Failed to fetch wallet balance");
            return res.body;
        },
    });

    // The selected customer's bills with money still owed (at this branch).
    const sales = useQuery({
        queryKey: ["customers-module-sales", branchId, selectedCustomer?.id],
        enabled: !!selectedCustomer && !selectedCustomer.isWalkIn,
        queryFn: async () => {
            const res = await api.sales.list({
                query: { branchId: branchId, customerId: selectedCustomer!.id, owed: "true", limit: 500 },
                extraHeaders: authHeaders(),
            });
            if (res.status !== 200) throw new Error("Failed to fetch sales");
            return res.body;
        },
    });

    const filteredCustomers = useMemo(() => {
        const list = visibleCustomers;
        const query = search.trim().toLowerCase();
        if (!query) return list;
        return list.filter((customer) => {
            return [
                customer.name,
                customer.phone ?? "",
                customer.code,
            ].some((value) => value.toLowerCase().includes(query));
        });
    }, [search, visibleCustomers]);

    const pendingInvoiceSummary = useMemo(() => {
        const bills = sales.data ?? [];
        return { count: bills.length, total: bills.reduce((sum, invoice) => sum + invoiceDue(invoice), 0) };
    }, [sales.data]);

    const hasCustomerEdits = useMemo(() => {
        if (!selectedCustomer) return false;
        return (
            editName.trim() !== selectedCustomer.name ||
            editPhone.trim() !== (selectedCustomer.phone ?? "") ||
            JSON.stringify(buyerBody(editBuyer)) !== JSON.stringify(buyerBody(buyerFrom(selectedCustomer))) ||
            JSON.stringify(creditBody(editCredit)) !== JSON.stringify(creditBody(creditFrom(selectedCustomer)))
        );
    }, [editName, editPhone, editBuyer, editCredit, selectedCustomer]);

    return (
        <section className="grid grid-cols-1 xl:h-[calc(100vh-48px)] xl:grid-cols-[360px_1fr] print:block print:h-auto">
            <div className="flex h-full max-h-[75vh] flex-col overflow-hidden border-r border-slate-200 bg-white xl:max-h-none print:hidden">
                <div className="shrink-0 border-b border-slate-200 p-4">
                    <div className="flex items-center justify-between">
                        <h2 className="page-title">Customers</h2>
                        <div className="flex gap-2">
                        <button
                            className={showAgeing ? "btn-primary" : "btn-secondary"}
                            onClick={() => setShowAgeing((prev) => !prev)}
                            type="button"
                            title="What every customer owes, by age"
                            data-tour="customers-owed"
                        >
                            Owed
                        </button>
                        <button
                            className={showCreateForm ? "btn-secondary" : "btn-primary"}
                            onClick={() => setShowCreateForm((prev) => !prev)}
                            type="button"
                            data-tour="customers-new"
                        >
                            {showCreateForm ? "Cancel" : "New Customer"}
                        </button>
                        </div>
                    </div>
                    <BranchPicker
                        className="mt-3"
                        value={branchId}
                        onChange={(next) => {
                            setManagedBranch(next);
                            setSelectedCustomerId(null);
                        }}
                    />

                    {showCreateForm ? (
                        <NewCustomerForm
                            name={name}
                            setName={setName}
                            phone={phone}
                            setPhone={setPhone}
                            buyer={buyer}
                            setBuyer={setBuyer}
                            isAdmin={isAdmin}
                            credit={credit}
                            setCredit={setCredit}
                            createCustomer={createCustomer}
                        />
                    ) : null}

                    <input
                        className="field mt-3"
                        data-tour="customers-search"
                        placeholder="Search by name, phone, or code"
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                    />
                </div>

                <CustomerList
                    filteredCustomers={filteredCustomers}
                    visibleCustomers={visibleCustomers}
                    selectedCustomer={selectedCustomer}
                    setSelectedCustomerId={setSelectedCustomerId}
                    setShowAgeing={setShowAgeing}
                    owedByCustomerId={owedByCustomerId}
                />
            </div>

            <div className="overflow-y-auto bg-slate-100 p-6 print:overflow-visible print:bg-white print:p-0">
                {showAgeing ? (
                    <div className="mx-auto max-w-5xl">
                        <AgeingPanel
                            branchId={branchId}
                            onOpen={(id) => {
                                setSelectedCustomerId(id);
                                setShowAgeing(false);
                            }}
                        />
                    </div>
                ) : !selectedCustomer ? (
                    <div className="card grid place-items-center p-12 text-center">
                        <p className="text-sm font-medium text-slate-600">No customer selected</p>
                        <p className="mt-1 text-xs text-slate-500">
                            Select a customer from the list to view details.
                        </p>
                    </div>
                ) : (
                    <div className="mx-auto max-w-5xl space-y-6" data-tour="customers-details">
                        <CustomerCard
                            selectedCustomer={selectedCustomer}
                            isAdmin={isAdmin}
                            isEditingCustomer={isEditingCustomer}
                            setIsEditingCustomer={setIsEditingCustomer}
                            editName={editName}
                            setEditName={setEditName}
                            editPhone={editPhone}
                            setEditPhone={setEditPhone}
                            editBuyer={editBuyer}
                            setEditBuyer={setEditBuyer}
                            editCredit={editCredit}
                            setEditCredit={setEditCredit}
                            hasCustomerEdits={hasCustomerEdits}
                            updateCustomer={updateCustomer}
                            sales={sales}
                            pendingInvoiceSummary={pendingInvoiceSummary}
                            account={account}
                            customerWallet={customerWallet}
                            showStatement={showStatement}
                            setShowStatement={setShowStatement}
                        />

                        {showStatement && !selectedCustomer.isWalkIn ? (
                            <StatementPanel
                                key={selectedCustomer.id}
                                customerId={selectedCustomer.id}
                                branchId={branchId}
                                defaultEmail={selectedCustomer.email}
                                timeZone={businessSettings.data?.timezone}
                                storeName={businessSettings.data?.name ?? ""}
                            />
                        ) : null}

                        {!selectedCustomer.isWalkIn && can(session, "TOP_UP_WALLETS") ? (
                            <WalletTopupForm
                                selectedCustomer={selectedCustomer}
                                canTakeTopup={canTakeTopup}
                                walletTopupMode={walletTopupMode}
                                setWalletTopupMode={setWalletTopupMode}
                                walletTopupAmount={walletTopupAmount}
                                setWalletTopupAmount={setWalletTopupAmount}
                                addWalletCredit={addWalletCredit}
                            />
                        ) : null}

                        {!selectedCustomer.isWalkIn && isAdmin ? (
                            <WalletAdjustForm
                                selectedCustomer={selectedCustomer}
                                walletAdjustAmount={walletAdjustAmount}
                                setWalletAdjustAmount={setWalletAdjustAmount}
                                walletAdjustReason={walletAdjustReason}
                                setWalletAdjustReason={setWalletAdjustReason}
                                adjustWallet={adjustWallet}
                            />
                        ) : null}
                    </div>
                )}
            </div>
        </section>
    );
}
