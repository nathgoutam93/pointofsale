import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { invoiceDue } from "@pos/contracts";
import { api, apiErrorMessage, authHeaders } from "../lib/api";
import { BuyerFields, buyerBody, buyerFrom, buyerProblem, emptyBuyer, type BuyerDetails } from "../components/BuyerFields";
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
    const [walletTopupAmount, setWalletTopupAmount] = useState("");

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
            setShowCreateForm(false);
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
            setIsEditingCustomer(false);
            queryClient.invalidateQueries({
                queryKey: ["customers-module", branchId],
            });
        },
    });

    const addWalletCredit = useMutation({
        mutationFn: async (variables: { customerId: string; amount: number }) => {
            const { customerId, amount } = variables;
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
                body: { amount },
                extraHeaders: authHeaders(),
            });
            if (res.status !== 200) throw new Error("Failed to add wallet credit");
            return res.body;
        },
        onSuccess: (_txn, variables) => {
            setWalletTopupAmount("");
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
        setWalletTopupAmount("");
    }, [selectedCustomer]);

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
            JSON.stringify(buyerBody(editBuyer)) !== JSON.stringify(buyerBody(buyerFrom(selectedCustomer)))
        );
    }, [editName, editPhone, editBuyer, selectedCustomer]);

    return (
        <section className="grid grid-cols-1 xl:h-[calc(100vh-48px)] xl:grid-cols-[360px_1fr]">
            <div className="flex h-full max-h-[75vh] flex-col overflow-hidden border-r border-slate-200 bg-white xl:max-h-none">
                <div className="shrink-0 border-b border-slate-200 p-4">
                    <div className="flex items-center justify-between">
                        <h2 className="page-title">Customers</h2>
                        <button
                            className={showCreateForm ? "btn-secondary" : "btn-primary"}
                            onClick={() => setShowCreateForm((prev) => !prev)}
                            type="button"
                        >
                            {showCreateForm ? "Cancel" : "New Customer"}
                        </button>
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
                            <button
                                className="btn-primary"
                                disabled={createCustomer.isPending || !name.trim() || !!buyerProblem(buyer)}
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
                        const pendingSummary = pendingByCustomerId.get(customer.id);
                        const pendingTotal = pendingSummary?.total ?? 0;
                        return (
                            <button
                                className={`list-row ${selected ? "is-active" : ""}`}
                                key={customer.id}
                                onClick={() => setSelectedCustomerId(customer.id)}
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
                                {sales.isLoading ? null : pendingTotal > 0 ? (
                                    <p className="mt-1.5 text-xs font-medium text-amber-700 tabular-nums">
                                        Due {inr(pendingTotal)}
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

            <div className="overflow-y-auto bg-slate-100 p-6">
                {!selectedCustomer ? (
                    <div className="card grid place-items-center p-12 text-center">
                        <p className="text-sm font-medium text-slate-600">No customer selected</p>
                        <p className="mt-1 text-xs text-slate-500">
                            Select a customer from the list to view details.
                        </p>
                    </div>
                ) : (
                    <div className="mx-auto max-w-5xl space-y-6">
                        <div className="card">
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
                                                !!buyerProblem(editBuyer)
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
                                    <dd className={`mt-1 text-xl font-semibold tabular-nums ${pendingInvoiceSummary.total > 0 ? "text-amber-700" : "text-slate-900"}`}>
                                        {sales.isLoading ? "…" : inr(pendingInvoiceSummary.total)}
                                    </dd>
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
                        </div>

                        {!selectedCustomer.isWalkIn && can(session, "TOP_UP_WALLETS") ? (
                            <form
                                className="card max-w-md p-5"
                                onSubmit={(e) => {
                                    e.preventDefault();
                                    if (!selectedCustomer) return;
                                    addWalletCredit.mutate({
                                        customerId: selectedCustomer.id,
                                        amount: Number(walletTopupAmount),
                                    });
                                }}
                            >
                                <h3 className="text-sm font-semibold text-slate-900">Add wallet credit</h3>
                                <p className="mt-0.5 text-xs text-slate-500">
                                    Credit can be used as a payment method at checkout.
                                </p>
                                <div className="mt-3 flex gap-2">
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
                    </div>
                )}
            </div>
        </section>
    );
}
