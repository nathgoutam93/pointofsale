import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { invoiceDue } from "@pos/contracts";
import { api, apiErrorMessage, authHeaders } from "../lib/api";
import { BuyerFields, buyerBody, buyerFrom, buyerProblem, emptyBuyer, type BuyerDetails } from "../components/BuyerFields";
import { CreditFields, creditBody, creditFrom, creditProblem, emptyCredit, type CreditDetails } from "../components/CreditFields";
import { AgeingPanel } from "./customers/AgeingPanel";
import { StatementPanel } from "./customers/StatementPanel";
import { gstStateLabel } from "@pos/contracts";
import { BranchPicker } from "../components/BranchPicker";
import { useManagedBranch } from "../lib/branch";
import { can } from "../lib/session";
import { inr, requireManagementSession } from "./route-helpers";

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

    const sales = useQuery({
        queryKey: ["customers-module-sales", branchId],
        queryFn: async () => {
            const res = await api.sales.list({
                query: { branchId: branchId },
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

    const pendingByCustomerId = useMemo(() => {
        const summary = new Map<string, { count: number; total: number }>();
        for (const invoice of sales.data ?? []) {
            if (!invoice.customerId) continue;
            const pending = invoiceDue(invoice);
            if (pending <= 0) continue;

            const current = summary.get(invoice.customerId) ?? { count: 0, total: 0 };
            summary.set(invoice.customerId, {
                count: current.count + 1,
                total: current.total + pending,
            });
        }
        return summary;
    }, [sales.data]);

    const pendingInvoiceSummary = useMemo(() => {
        if (!selectedCustomer) {
            return { count: 0, total: 0 };
        }
        return pendingByCustomerId.get(selectedCustomer.id) ?? { count: 0, total: 0 };
    }, [pendingByCustomerId, selectedCustomer]);

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
                        >
                            Owed
                        </button>
                        <button
                            className={showCreateForm ? "btn-secondary" : "btn-primary"}
                            onClick={() => setShowCreateForm((prev) => !prev)}
                            type="button"
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
                        <form
                            className="mt-3 grid grid-cols-1 gap-2 rounded-md border border-slate-200 bg-slate-50 p-3"
                            onSubmit={(e) => {
                                e.preventDefault();
                                createCustomer.mutate();
                            }}
                        >
                            <input
                                className="field"
                                placeholder="Customer name"
                                value={name}
                                onChange={(e) => setName(e.target.value)}
                                required
                            />
                            <input
                                className="field"
                                placeholder="Phone (optional)"
                                value={phone}
                                onChange={(e) => setPhone(e.target.value)}
                            />
                            <BuyerFields value={buyer} onChange={setBuyer} />
                            {isAdmin ? <CreditFields value={credit} onChange={setCredit} /> : null}
                            <button
                                className="btn-primary"
                                disabled={createCustomer.isPending || !name.trim() || !!buyerProblem(buyer) || !!creditProblem(credit)}
                                type="submit"
                            >
                                {createCustomer.isPending ? "Creating..." : "Create Customer"}
                            </button>
                            {createCustomer.isError ? (
                                <p className="text-xs text-rose-700">{(createCustomer.error as Error).message}</p>
                            ) : null}
                        </form>
                    ) : null}

                    <input
                        className="field mt-3"
                        placeholder="Search by name, phone, or code"
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                    />
                </div>

                <div className="min-h-0 flex-1 space-y-2 overflow-y-auto bg-slate-50 p-3">
                    {filteredCustomers.map((customer) => {
                        const selected = selectedCustomer?.id === customer.id;
                        const owed = owedByCustomerId.get(customer.id);
                        return (
                            <button
                                className={`list-row ${selected ? "is-active" : ""}`}
                                key={customer.id}
                                onClick={() => {
                                    setSelectedCustomerId(customer.id);
                                    setShowAgeing(false);
                                }}
                                type="button"
                            >
                                <div className="flex items-start justify-between gap-2">
                                    <div className="min-w-0">
                                        <p className="truncate text-sm font-semibold text-slate-900">
                                            {customer.name}
                                        </p>
                                        <p className="truncate text-xs text-slate-500">
                                            {customer.phone ?? "No phone"}
                                        </p>
                                    </div>
                                    <span className="badge bg-slate-100 font-medium tracking-normal text-slate-600 normal-case">
                                        {customer.code}
                                    </span>
                                </div>
                                {owed ? (
                                    <p className="mt-1.5 text-xs font-medium text-amber-700 tabular-nums">
                                        Due {inr(owed.total)}
                                        {owed.overdue > 0 ? (
                                            <span className="ml-2 badge bg-rose-50 text-rose-700 ring-1 ring-rose-200 ring-inset">
                                                {inr(owed.overdue)} overdue
                                            </span>
                                        ) : null}
                                    </p>
                                ) : null}
                            </button>
                        );
                    })}

                    {visibleCustomers.length === 0 ? (
                        <p className="rounded-md border border-dashed border-slate-300 bg-white px-3 py-6 text-center text-sm text-slate-500">
                            No customers found.
                        </p>
                    ) : null}

                    {visibleCustomers.length &&
                        filteredCustomers.length === 0 ? (
                        <p className="rounded-md border border-dashed border-slate-300 bg-white px-3 py-6 text-center text-sm text-slate-500">
                            No customers match that search.
                        </p>
                    ) : null}
                </div>
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
                    <div className="mx-auto max-w-5xl space-y-6">
                        <div className="card print:hidden">
                            <div className="flex flex-wrap items-start justify-between gap-4 border-b border-slate-200 p-5">
                                <div className="flex min-w-0 items-center gap-4">
                                    <div className="grid h-12 w-12 shrink-0 place-items-center rounded-full bg-brand-100 text-base font-semibold text-brand-700">
                                        {selectedCustomer.name.trim().slice(0, 1).toUpperCase() || "?"}
                                    </div>
                                    <div className="min-w-0">
                                        {isEditingCustomer ? (
                                            <div className="grid gap-2 sm:grid-cols-2">
                                                <div>
                                                    <label className="field-label">Name</label>
                                                    <input
                                                        className="field"
                                                        value={editName}
                                                        onChange={(e) => setEditName(e.target.value)}
                                                    />
                                                </div>
                                                <div>
                                                    <label className="field-label">Phone</label>
                                                    <input
                                                        className="field"
                                                        placeholder="Phone (optional)"
                                                        value={editPhone}
                                                        onChange={(e) => setEditPhone(e.target.value)}
                                                    />
                                                </div>
                                                <div className="sm:col-span-2">
                                                    <label className="field-label">GST and billing</label>
                                                    <BuyerFields value={editBuyer} onChange={setEditBuyer} />
                                                </div>
                                                {isAdmin ? (
                                                    <div className="sm:col-span-2">
                                                        <label className="field-label">Credit</label>
                                                        <CreditFields value={editCredit} onChange={setEditCredit} />
                                                    </div>
                                                ) : null}
                                                {updateCustomer.isError ? (
                                                    <p className="text-xs text-rose-700 sm:col-span-2">{(updateCustomer.error as Error).message}</p>
                                                ) : null}
                                            </div>
                                        ) : (
                                            <>
                                                <h2 className="truncate text-xl font-semibold tracking-tight text-slate-900">
                                                    {selectedCustomer.name}
                                                </h2>
                                                <p className="mt-0.5 text-sm text-slate-500">
                                                    <span>{selectedCustomer.code}</span> ·{" "}
                                                    {selectedCustomer.phone ?? "No phone"}
                                                    {selectedCustomer.email ? ` · ${selectedCustomer.email}` : ""}
                                                </p>
                                                {selectedCustomer.gstin ? (
                                                    <p className="mt-1 text-sm text-slate-600">
                                                        <span className="badge bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200 ring-inset">Registered buyer</span>{" "}
                                                        GSTIN <span className="font-mono font-semibold text-slate-800">{selectedCustomer.gstin}</span> ·{" "}
                                                        {gstStateLabel(selectedCustomer.gstin.slice(0, 2))}
                                                    </p>
                                                ) : null}
                                                {selectedCustomer.address ? (
                                                    <p className="mt-0.5 whitespace-pre-line text-sm text-slate-500">{selectedCustomer.address}</p>
                                                ) : null}
                                            </>
                                        )}
                                    </div>
                                </div>
                                {selectedCustomer.isWalkIn ? (
                                    <span className="badge bg-slate-100 text-slate-600">Walk-in · not editable</span>
                                ) : isEditingCustomer ? (
                                    <div className="flex gap-2">
                                        <button
                                            className="btn-secondary"
                                            onClick={() => {
                                                setIsEditingCustomer(false);
                                                setEditName(selectedCustomer.name);
                                                setEditPhone(selectedCustomer.phone ?? "");
                                                setEditBuyer(buyerFrom(selectedCustomer));
                                                setEditCredit(creditFrom(selectedCustomer));
                                            }}
                                            type="button"
                                        >
                                            Cancel
                                        </button>
                                        <button
                                            className="btn-primary"
                                            disabled={
                                                updateCustomer.isPending ||
                                                !editName.trim() ||
                                                !hasCustomerEdits ||
                                                !!buyerProblem(editBuyer) ||
                                                !!creditProblem(editCredit)
                                            }
                                            onClick={() => updateCustomer.mutate()}
                                            type="button"
                                        >
                                            {updateCustomer.isPending ? "Saving..." : "Save"}
                                        </button>
                                    </div>
                                ) : (
                                    <button
                                        className="btn-secondary"
                                        onClick={() => setIsEditingCustomer(true)}
                                        type="button"
                                    >
                                        Edit Customer
                                    </button>
                                )}
                            </div>
                            <dl className="grid grid-cols-2 divide-slate-200 md:grid-cols-4 md:divide-x">
                                <div className="p-5">
                                    <dt className="eyebrow">Pending invoices</dt>
                                    <dd className="mt-1 flex items-center gap-2">
                                        <span className="text-xl font-semibold text-slate-900 tabular-nums">
                                            {sales.isLoading ? "…" : pendingInvoiceSummary.count}
                                        </span>
                                        {!sales.isLoading && pendingInvoiceSummary.count > 0 ? (
                                            <Link
                                                className="text-xs font-semibold text-brand-600 hover:text-brand-700 hover:underline"
                                                search={{
                                                    customerId: selectedCustomer.id,
                                                    paymentFilter: "PENDING",
                                                }}
                                                to="/sales"
                                            >
                                                View →
                                            </Link>
                                        ) : null}
                                    </dd>
                                </div>
                                <div className="p-5">
                                    <dt className="eyebrow">Amount due</dt>
                                    <dd className={`mt-1 text-xl font-semibold tabular-nums ${(account.data?.outstanding ?? 0) > 0 ? "text-amber-700" : "text-slate-900"}`}>
                                        {account.isLoading ? "…" : inr(account.data?.outstanding ?? 0)}
                                    </dd>
                                    {account.data && account.data.overdue > 0 ? (
                                        <dd className="mt-0.5 text-xs font-medium text-rose-700 tabular-nums">
                                            {inr(account.data.overdue)} overdue ({account.data.overdueBills} {account.data.overdueBills === 1 ? "bill" : "bills"})
                                        </dd>
                                    ) : null}
                                </div>
                                <div className="p-5">
                                    <dt className="eyebrow">Wallet balance</dt>
                                    <dd className="mt-1 text-xl font-semibold text-slate-900 tabular-nums">
                                        {customerWallet.isLoading ? "…" : inr(customerWallet.data?.balance ?? 0)}
                                    </dd>
                                </div>
                                <div className="p-5">
                                    <dt className="eyebrow">Customer since</dt>
                                    <dd className="mt-1 text-sm font-medium text-slate-900">
                                        {new Date(selectedCustomer.createdAt).toLocaleString()}
                                    </dd>
                                </div>
                            </dl>
                            {!selectedCustomer.isWalkIn ? (
                                <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-200 px-5 py-3 text-sm">
                                    <p className="text-slate-600">
                                        {account.data?.creditLimit != null ? (
                                            <>
                                                Credit limit <span className="font-semibold text-slate-900 tabular-nums">{inr(account.data.creditLimit)}</span>
                                                {" · "}
                                                <span className={account.data.available === 0 ? "font-semibold text-rose-700" : ""}>
                                                    {inr(account.data.available ?? 0)} available
                                                </span>
                                            </>
                                        ) : (
                                            "No credit limit"
                                        )}
                                        {" · "}
                                        {selectedCustomer.paymentTermsDays != null
                                            ? `Pay within ${selectedCustomer.paymentTermsDays} ${selectedCustomer.paymentTermsDays === 1 ? "day" : "days"}`
                                            : "No payment terms"}
                                    </p>
                                    <button className="btn-secondary" type="button" onClick={() => setShowStatement((prev) => !prev)}>
                                        {showStatement ? "Hide statement" : "Statement"}
                                    </button>
                                </div>
                            ) : null}
                        </div>

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
                            <form
                                className="card max-w-md p-5 print:hidden"
                                onSubmit={(e) => {
                                    e.preventDefault();
                                    if (!selectedCustomer) return;
                                    addWalletCredit.mutate({
                                        customerId: selectedCustomer.id,
                                        amount: Number(walletTopupAmount),
                                        mode: walletTopupMode,
                                    });
                                }}
                            >
                                <h3 className="text-sm font-semibold text-slate-900">Add wallet credit</h3>
                                <p className="mt-0.5 text-xs text-slate-500">
                                    Money taken now, on your open register. Credit can be used as a payment method at checkout.
                                </p>
                                {!canTakeTopup ? (
                                    <p className="mt-3 rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-800">
                                        Open a register at this branch to take a top-up.
                                    </p>
                                ) : null}
                                <div className="mt-3 flex gap-2">
                                    <select
                                        className="field w-28 shrink-0"
                                        value={walletTopupMode}
                                        onChange={(e) => setWalletTopupMode(e.target.value as "CASH" | "CARD" | "UPI")}
                                        aria-label="Paid by"
                                    >
                                        <option value="CASH">Cash</option>
                                        <option value="CARD">Card</option>
                                        <option value="UPI">UPI</option>
                                    </select>
                                    <input
                                        className="field"
                                        inputMode="decimal"
                                        min="0"
                                        placeholder="Amount"
                                        value={walletTopupAmount}
                                        onChange={(e) => setWalletTopupAmount(e.target.value)}
                                    />
                                    <button
                                        className="btn-primary shrink-0"
                                        disabled={
                                            !canTakeTopup ||
                                            addWalletCredit.isPending ||
                                            !walletTopupAmount.trim() ||
                                            !Number.isFinite(Number(walletTopupAmount)) ||
                                            Number(walletTopupAmount) <= 0
                                        }
                                        type="submit"
                                    >
                                        {addWalletCredit.isPending ? "Adding..." : "Add Credit"}
                                    </button>
                                </div>
                                {addWalletCredit.isError ? (
                                    <p className="mt-2 text-xs text-rose-700">
                                        {(addWalletCredit.error as Error).message}
                                    </p>
                                ) : null}
                            </form>
                        ) : null}

                        {!selectedCustomer.isWalkIn && isAdmin ? (
                            <form
                                className="card max-w-md p-5 print:hidden"
                                onSubmit={(e) => {
                                    e.preventDefault();
                                    if (!selectedCustomer) return;
                                    adjustWallet.mutate({
                                        customerId: selectedCustomer.id,
                                        amount: Number(walletAdjustAmount),
                                        reason: walletAdjustReason.trim(),
                                    });
                                }}
                            >
                                <h3 className="text-sm font-semibold text-slate-900">Correct wallet balance</h3>
                                <p className="mt-0.5 text-xs text-slate-500">
                                    Admins only. No money changes hands: use a negative amount to take credit off.
                                </p>
                                <div className="mt-3 grid gap-2">
                                    <input
                                        className="field"
                                        inputMode="decimal"
                                        placeholder="Amount, e.g. 50 or -50"
                                        value={walletAdjustAmount}
                                        onChange={(e) => setWalletAdjustAmount(e.target.value)}
                                    />
                                    <input
                                        className="field"
                                        placeholder="Reason"
                                        maxLength={200}
                                        value={walletAdjustReason}
                                        onChange={(e) => setWalletAdjustReason(e.target.value)}
                                    />
                                    <button
                                        className="btn-secondary"
                                        disabled={
                                            adjustWallet.isPending ||
                                            !Number.isFinite(Number(walletAdjustAmount)) ||
                                            Number(walletAdjustAmount) === 0 ||
                                            walletAdjustReason.trim().length < 3
                                        }
                                        type="submit"
                                    >
                                        {adjustWallet.isPending ? "Saving..." : "Correct balance"}
                                    </button>
                                </div>
                                {adjustWallet.isError ? (
                                    <p className="mt-2 text-xs text-rose-700">{(adjustWallet.error as Error).message}</p>
                                ) : null}
                            </form>
                        ) : null}
                    </div>
                )}
            </div>
        </section>
    );
}
