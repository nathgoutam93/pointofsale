import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { api, authHeaders } from "../lib/api";
import { money, requireOperationalSession } from "./route-helpers";

export function CustomersPage() {
    const session = requireOperationalSession();
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
    const [walletTopupAmount, setWalletTopupAmount] = useState("");

    const customers = useQuery({
        queryKey: ["customers-module", session.branchId],
        queryFn: async () => {
            const res = await api.customers.list({
                query: { branchId: session.branchId },
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
                    branchId: session.branchId,
                    name: name.trim(),
                    phone: phone.trim() || undefined,
                },
                extraHeaders: authHeaders(),
            });
            if (res.status !== 201) throw new Error("Failed to create customer");
            return res.body;
        },
        onSuccess: (created) => {
            setName("");
            setPhone("");
            setShowCreateForm(false);
            setSelectedCustomerId(created.id);
            queryClient.invalidateQueries({
                queryKey: ["customers-module", session.branchId],
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
                body: {
                    name: editName.trim(),
                    phone: editPhone.trim() || null,
                },
                extraHeaders: authHeaders(),
            });
            if (res.status !== 200) throw new Error("Failed to update customer");
            return res.body;
        },
        onSuccess: (updated) => {
            setSelectedCustomerId(updated.id);
            setEditName(updated.name);
            setEditPhone(updated.phone ?? "");
            setIsEditingCustomer(false);
            queryClient.invalidateQueries({
                queryKey: ["customers-module", session.branchId],
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
                extraHeaders: authHeaders(),
            });
            if (res.status !== 200) throw new Error("Failed to fetch wallet balance");
            return res.body;
        },
    });

    const sales = useQuery({
        queryKey: ["customers-module-sales", session.branchId],
        queryFn: async () => {
            const res = await api.sales.list({
                query: { branchId: session.branchId },
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
            const pending = Number(invoice.grandTotal) - Number(invoice.paidTotal);
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
            editPhone.trim() !== (selectedCustomer.phone ?? "")
        );
    }, [editName, editPhone, selectedCustomer]);

    return (
        <section className="grid h-[calc(100vh-48px)] grid-cols-1 xl:grid-cols-[390px_1fr]">
            <div className="border-r border-slate-200 bg-white p-3">
                <div className="flex items-center justify-between">
                    <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-600">
                        Customer List
                    </h3>
                    <button
                        className="rounded-lg bg-teal-700 px-3 py-2 text-sm font-semibold text-white"
                        onClick={() => setShowCreateForm((prev) => !prev)}
                        type="button"
                    >
                        {showCreateForm ? "Close" : "New Customer"}
                    </button>
                </div>

                {showCreateForm ? (
                    <form
                        className="mt-3 grid grid-cols-1 gap-2"
                        onSubmit={(e) => {
                            e.preventDefault();
                            createCustomer.mutate();
                        }}
                    >
                        <input
                            className="rounded-lg border border-slate-300 px-3 py-2"
                            placeholder="Customer name"
                            value={name}
                            onChange={(e) => setName(e.target.value)}
                            required
                        />
                        <input
                            className="rounded-lg border border-slate-300 px-3 py-2"
                            placeholder="Phone (optional)"
                            value={phone}
                            onChange={(e) => setPhone(e.target.value)}
                        />
                        <button
                            className="rounded-lg bg-teal-700 px-3 py-2 font-semibold text-white disabled:cursor-not-allowed disabled:opacity-60"
                            disabled={createCustomer.isPending || !name.trim()}
                            type="submit"
                        >
                            {createCustomer.isPending ? "Creating..." : "Create Customer"}
                        </button>
                    </form>
                ) : null}

                <input
                    className="mt-3 w-full rounded-lg border border-slate-300 px-3 py-2"
                    placeholder="Search by name, phone, or code"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                />

                <div className="mt-3 max-h-[520px] space-y-2 overflow-auto pr-1">
                    {filteredCustomers.map((customer) => {
                        const selected = selectedCustomer?.id === customer.id;
                        const pendingSummary = pendingByCustomerId.get(customer.id);
                        const pendingTotal = pendingSummary?.total ?? 0;
                        return (
                            <button
                                className={[
                                    "w-full rounded-lg border px-3 py-2 text-left transition",
                                    selected
                                        ? "border-teal-600 bg-teal-50"
                                        : "border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50",
                                ].join(" ")}
                                key={customer.id}
                                onClick={() => setSelectedCustomerId(customer.id)}
                                type="button"
                            >
                                <div className="flex items-start justify-between gap-2">
                                    <div className="min-w-0">
                                        <p className="truncate font-semibold text-slate-900">
                                            {customer.name}
                                        </p>
                                        <p className="truncate text-xs text-slate-500">
                                            {customer.phone ?? "No phone"}
                                        </p>
                                        <p
                                            className={`mt-1 text-xs font-semibold ${pendingTotal > 0 ? "text-amber-700" : "text-emerald-700"}`}
                                        >
                                            {sales.isLoading
                                                ? "Pending loading..."
                                                : pendingTotal > 0
                                                    ? `Pending ₹ ${money(pendingTotal)}`
                                                    : "No pending amount"}
                                        </p>
                                    </div>
                                    <span className="rounded-md border border-slate-200 px-2 py-0.5 text-xs text-slate-600">
                                        {customer.code}
                                    </span>
                                </div>
                            </button>
                        );
                    })}

                    {visibleCustomers.length === 0 ? (
                        <p className="rounded-lg border border-dashed border-slate-300 px-3 py-6 text-center text-sm text-slate-500">
                            No customers found.
                        </p>
                    ) : null}

                    {visibleCustomers.length &&
                        filteredCustomers.length === 0 ? (
                        <p className="rounded-lg border border-dashed border-slate-300 px-3 py-6 text-center text-sm text-slate-500">
                            No customers match that search.
                        </p>
                    ) : null}
                </div>
            </div>

            <div className="bg-slate-100 p-4">
                <h3 className="text-lg font-semibold text-slate-900">
                    Customer Details
                </h3>
                {!selectedCustomer ? (
                    <p className="mt-3 text-sm text-slate-500">
                        Select a customer from the list to view details.
                    </p>
                ) : (
                    <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-4">
                        <div className="rounded-lg border border-slate-200 bg-white px-3 py-2">
                            <p className="text-xs uppercase tracking-wide text-slate-500">
                                Customer Code
                            </p>
                            <p className="mt-1 font-semibold text-slate-900">
                                {selectedCustomer.code}
                            </p>
                        </div>
                        <div className="rounded-lg border border-slate-200 bg-white px-3 py-2">
                            <p className="text-xs uppercase tracking-wide text-slate-500">
                                Name
                            </p>
                            {isEditingCustomer ? (
                                <input
                                    className="mt-1 w-full rounded border border-slate-300 px-2 py-1 font-semibold text-slate-900"
                                    value={editName}
                                    onChange={(e) => setEditName(e.target.value)}
                                />
                            ) : (
                                <p className="mt-1 font-semibold text-slate-900">
                                    {selectedCustomer.name}
                                </p>
                            )}
                        </div>
                        <div className="rounded-lg border border-slate-200 bg-white px-3 py-2">
                            <p className="text-xs uppercase tracking-wide text-slate-500">
                                Phone
                            </p>
                            {isEditingCustomer ? (
                                <input
                                    className="mt-1 w-full rounded border border-slate-300 px-2 py-1 font-semibold text-slate-900"
                                    placeholder="Phone (optional)"
                                    value={editPhone}
                                    onChange={(e) => setEditPhone(e.target.value)}
                                />
                            ) : (
                                <p className="mt-1 font-semibold text-slate-900">
                                    {selectedCustomer.phone ?? "Not provided"}
                                </p>
                            )}
                        </div>
                        <div className="rounded-lg border border-slate-200 bg-white px-3 py-2">
                            <p className="text-xs uppercase tracking-wide text-slate-500">
                                Actions
                            </p>
                            {selectedCustomer.isWalkIn ? (
                                <p className="mt-1 text-sm font-medium text-slate-500">
                                    Walk-in customer details cannot be edited.
                                </p>
                            ) : isEditingCustomer ? (
                                <div className="mt-2 flex flex-wrap gap-2">
                                    <button
                                        className="rounded-lg bg-teal-700 px-3 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-60"
                                        disabled={
                                            updateCustomer.isPending ||
                                            !editName.trim() ||
                                            !hasCustomerEdits
                                        }
                                        onClick={() => updateCustomer.mutate()}
                                        type="button"
                                    >
                                        {updateCustomer.isPending ? "Saving..." : "Save"}
                                    </button>
                                    <button
                                        className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-semibold text-slate-700"
                                        onClick={() => {
                                            setIsEditingCustomer(false);
                                            setEditName(selectedCustomer.name);
                                            setEditPhone(selectedCustomer.phone ?? "");
                                        }}
                                        type="button"
                                    >
                                        Cancel
                                    </button>
                                </div>
                            ) : (
                                <button
                                    className="mt-2 rounded-lg border border-slate-300 px-3 py-2 text-sm font-semibold text-slate-700"
                                    onClick={() => setIsEditingCustomer(true)}
                                    type="button"
                                >
                                    Edit Customer
                                </button>
                            )}
                        </div>
                        <div className="rounded-lg border border-slate-200 bg-white px-3 py-2">
                            <p className="text-xs uppercase tracking-wide text-slate-500">
                                Pending Invoices
                            </p>
                            <div className="mt-1 flex items-center justify-between gap-2">
                                <p className="font-semibold text-slate-900">
                                    {sales.isLoading ? "Loading..." : pendingInvoiceSummary.count}
                                </p>
                                {!sales.isLoading && pendingInvoiceSummary.count > 0 ? (
                                    <Link
                                        className="rounded-md border border-amber-200 bg-amber-50 px-2 py-1 text-xs font-semibold text-amber-800 hover:bg-amber-100"
                                        search={{
                                            customerId: selectedCustomer.id,
                                            paymentFilter: "PENDING",
                                        }}
                                        to="/sales"
                                    >
                                        View
                                    </Link>
                                ) : null}
                            </div>
                        </div>
                        <div className="rounded-lg border border-slate-200 bg-white px-3 py-2">
                            <p className="text-xs uppercase tracking-wide text-slate-500">
                                Total Pending Amount
                            </p>
                            <p className="mt-1 font-semibold text-slate-900">
                                {sales.isLoading
                                    ? "Loading..."
                                    : `₹ ${money(pendingInvoiceSummary.total)}`}
                            </p>
                        </div>
                        <div className="rounded-lg border border-slate-200 bg-white px-3 py-2">
                            <p className="text-xs uppercase tracking-wide text-slate-500">
                                Created
                            </p>
                            <p className="mt-1 font-semibold text-slate-900">
                                {new Date(selectedCustomer.createdAt).toLocaleString()}
                            </p>
                        </div>

                        <div className="rounded-lg border border-slate-200 bg-white px-3 py-2">
                            <p className="text-xs uppercase tracking-wide text-slate-500">
                                Wallet Balance
                            </p>
                            <p className="mt-1 font-semibold text-slate-900">
                                {customerWallet.isLoading
                                    ? "Loading..."
                                    : `₹ ${money(customerWallet.data?.balance ?? 0)}`}
                            </p>
                            {!selectedCustomer.isWalkIn ? (
                                <form
                                    className="mt-3 grid grid-cols-1 gap-2"
                                    onSubmit={(e) => {
                                        e.preventDefault();
                                        if (!selectedCustomer) return;
                                        addWalletCredit.mutate({
                                            customerId: selectedCustomer.id,
                                            amount: Number(walletTopupAmount),
                                        });
                                    }}
                                >
                                    <input
                                        className="rounded border border-slate-300 px-2 py-1 text-sm"
                                        inputMode="decimal"
                                        min="0"
                                        placeholder="Credit amount"
                                        value={walletTopupAmount}
                                        onChange={(e) => setWalletTopupAmount(e.target.value)}
                                    />
                                    <button
                                        className="rounded-lg bg-teal-700 px-3 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-60"
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
                                    {addWalletCredit.isError ? (
                                        <p className="text-xs text-rose-700">
                                            {(addWalletCredit.error as Error).message}
                                        </p>
                                    ) : null}
                                </form>
                            ) : null}
                        </div>
                    </div>
                )}
            </div>
        </section>
    );
}
