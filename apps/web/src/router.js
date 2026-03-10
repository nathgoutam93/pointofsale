import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { Link, Outlet, createRootRoute, createRoute, createRouter, redirect, useNavigate, useRouterState } from '@tanstack/react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { api, authHeaders } from './lib/api';
import { clearSession, getSession, setSession } from './lib/session';
function money(n) {
    const value = Number(n);
    if (!Number.isFinite(value))
        return '0.00';
    return value.toFixed(2);
}
function requireSession() {
    const session = getSession();
    if (!session) {
        throw redirect({ to: '/' });
    }
    return session;
}
function AppLayout() {
    const location = useRouterState({ select: (s) => s.location.pathname });
    const session = getSession();
    const [open, setOpen] = useState(false);
    if (!session && location === '/') {
        return (_jsx("main", { className: "min-h-screen grid place-items-center bg-[radial-gradient(circle_at_20%_20%,#fcebd7_0%,#eff4ff_45%,#f6f8fc_100%)] p-4", children: _jsx(Outlet, {}) }));
    }
    return (_jsxs("div", { className: "min-h-screen bg-slate-100", children: [_jsx("button", { className: "fixed left-3 top-3 z-40 h-11 w-11 rounded-lg border border-slate-300 bg-white text-lg", onClick: () => setOpen((v) => !v), children: "\u2630" }), _jsxs("aside", { className: `fixed left-0 top-0 z-30 h-screen w-60 bg-slate-900 p-4 pt-16 text-white transition-transform ${open ? 'translate-x-0' : '-translate-x-full'}`, children: [_jsx("h2", { className: "mb-4 text-lg font-semibold", children: "Modules" }), _jsxs("nav", { className: "grid gap-2", children: [_jsx(Link, { className: "rounded-lg border border-slate-700 bg-slate-800 px-3 py-2", to: "/pos", onClick: () => setOpen(false), children: "POS" }), _jsx(Link, { className: "rounded-lg border border-slate-700 bg-slate-800 px-3 py-2", to: "/sales", onClick: () => setOpen(false), children: "Sales" }), _jsx(Link, { className: "rounded-lg border border-slate-700 bg-slate-800 px-3 py-2", to: "/items", onClick: () => setOpen(false), children: "Items" }), _jsx(Link, { className: "rounded-lg border border-slate-700 bg-slate-800 px-3 py-2", to: "/customers", onClick: () => setOpen(false), children: "Customers" }), _jsx(Link, { className: "rounded-lg border border-slate-700 bg-slate-800 px-3 py-2", to: "/stock", onClick: () => setOpen(false), children: "Stock" }), _jsx(Link, { className: "rounded-lg border border-slate-700 bg-slate-800 px-3 py-2", to: "/receipts", onClick: () => setOpen(false), children: "Receipts" }), _jsx("button", { className: "rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-left", onClick: () => {
                                    clearSession();
                                    window.location.href = '/';
                                }, children: "Logout" })] })] }), _jsx("main", { className: "p-4 md:p-5", children: _jsx(Outlet, {}) })] }));
}
function LoginPage() {
    const navigate = useNavigate();
    const [username, setUsername] = useState('admin');
    const [password, setPassword] = useState('password');
    const login = useMutation({
        mutationFn: async () => {
            const res = await api.auth.login({ body: { username, password } });
            if (res.status !== 200)
                throw new Error('Login failed');
            return res.body;
        }
    });
    const onSubmit = async (e) => {
        e.preventDefault();
        const data = await login.mutateAsync();
        setSession(data);
        navigate({ to: '/pos' });
    };
    return (_jsxs("section", { className: "w-full max-w-md rounded-2xl border border-slate-300 bg-white p-7 shadow-xl", children: [_jsx("h1", { className: "text-2xl font-bold text-slate-900", children: "Point Of Sale" }), _jsx("p", { className: "mt-1 text-sm text-slate-600", children: "Sign in to continue" }), _jsxs("form", { onSubmit: onSubmit, className: "mt-4 grid gap-3", children: [_jsx("input", { className: "rounded-lg border border-slate-300 px-3 py-2", value: username, onChange: (e) => setUsername(e.target.value), placeholder: "Username" }), _jsx("input", { className: "rounded-lg border border-slate-300 px-3 py-2", value: password, onChange: (e) => setPassword(e.target.value), placeholder: "Password", type: "password" }), _jsx("button", { className: "rounded-lg bg-teal-700 px-3 py-2 font-semibold text-white", type: "submit", disabled: login.isPending, children: "Login" })] }), _jsx("small", { className: "mt-3 block text-xs text-slate-500", children: "Default: admin/password, cashier/password" }), login.error ? _jsx("p", { className: "mt-2 text-sm text-red-700", children: login.error.message }) : null] }));
}
function PosPage() {
    const session = requireSession();
    const queryClient = useQueryClient();
    const [customerId, setCustomerId] = useState('');
    const [cart, setCart] = useState([]);
    const [search, setSearch] = useState('');
    const [activeCategory, setActiveCategory] = useState('All');
    const [customerModalOpen, setCustomerModalOpen] = useState(false);
    const [customerPhoneQuery, setCustomerPhoneQuery] = useState('');
    const [newCustomerName, setNewCustomerName] = useState('');
    const [customerModalError, setCustomerModalError] = useState('');
    const [cashAmount, setCashAmount] = useState('0');
    const [cardAmount, setCardAmount] = useState('0');
    const [walletAmount, setWalletAmount] = useState('0');
    const [activeInput, setActiveInput] = useState('cash');
    const [message, setMessage] = useState('');
    const items = useQuery({
        queryKey: ['items-pos'],
        queryFn: async () => {
            const res = await api.items.list({ query: { activeOnly: true } });
            if (res.status !== 200)
                throw new Error('Failed to load items');
            return res.body;
        }
    });
    const customers = useQuery({
        queryKey: ['customers-pos', session.branchId],
        queryFn: async () => {
            const res = await api.customers.list({ query: { branchId: session.branchId } });
            if (res.status !== 200)
                throw new Error('Failed to load customers');
            return res.body;
        }
    });
    const walkIn = useQuery({
        queryKey: ['walk-in', session.branchId],
        queryFn: async () => {
            const res = await api.customers.getWalkIn({ params: { branchId: session.branchId } });
            if (res.status !== 200)
                throw new Error('Failed to load walk-in customer');
            return res.body;
        }
    });
    const addItem = (item) => {
        const rate = Number(item.sellPrice) || 0;
        const taxRate = Number(item.taxRate) || 0;
        setCart((prev) => {
            const idx = prev.findIndex((l) => l.itemId === item.id);
            if (idx === -1) {
                return [...prev, { itemId: item.id, name: item.name, qty: 1, rate, discountAmount: 0, taxRate }];
            }
            const next = [...prev];
            next[idx] = { ...next[idx], qty: next[idx].qty + 1 };
            return next;
        });
    };
    const total = useMemo(() => {
        return cart.reduce((acc, line) => {
            const gross = line.qty * line.rate;
            const taxable = gross - line.discountAmount;
            const tax = (taxable * line.taxRate) / 100;
            return acc + taxable + tax;
        }, 0);
    }, [cart]);
    const totalTax = useMemo(() => {
        return cart.reduce((acc, line) => {
            const gross = line.qty * line.rate;
            const taxable = gross - line.discountAmount;
            return acc + (taxable * line.taxRate) / 100;
        }, 0);
    }, [cart]);
    const totalItems = useMemo(() => cart.reduce((acc, line) => acc + line.qty, 0), [cart]);
    const categories = useMemo(() => {
        const set = new Set();
        for (const item of items.data ?? []) {
            set.add(item.category || 'Uncategorized');
        }
        return ['All', ...Array.from(set)];
    }, [items.data]);
    const filteredItems = useMemo(() => {
        const keyword = search.trim().toLowerCase();
        return (items.data ?? []).filter((item) => {
            const category = item.category || 'Uncategorized';
            const categoryMatch = activeCategory === 'All' || category === activeCategory;
            const textMatch = keyword.length === 0 ||
                item.name.toLowerCase().includes(keyword) ||
                item.code.toLowerCase().includes(keyword) ||
                category.toLowerCase().includes(keyword);
            return categoryMatch && textMatch;
        });
    }, [items.data, search, activeCategory]);
    const matchingCustomers = useMemo(() => {
        const q = customerPhoneQuery.trim();
        if (!q)
            return [];
        return (customers.data ?? []).filter((c) => (c.phone ?? '').includes(q));
    }, [customers.data, customerPhoneQuery]);
    const selectedCustomer = useMemo(() => {
        if (!customerId)
            return walkIn.data;
        return (customers.data ?? []).find((c) => c.id === customerId) ?? walkIn.data;
    }, [customerId, customers.data, walkIn.data]);
    const withValue = (value, update) => {
        update(value);
    };
    const updateActiveAmount = (nextValue) => {
        if (activeInput === 'cash')
            withValue(nextValue, setCashAmount);
        if (activeInput === 'card')
            withValue(nextValue, setCardAmount);
        if (activeInput === 'wallet')
            withValue(nextValue, setWalletAmount);
    };
    const getActiveAmount = () => {
        if (activeInput === 'cash')
            return cashAmount;
        if (activeInput === 'card')
            return cardAmount;
        return walletAmount;
    };
    const keypadPress = (key) => {
        const current = getActiveAmount();
        if (key === 'C') {
            updateActiveAmount('0');
            return;
        }
        if (key === '<') {
            const next = current.length <= 1 ? '0' : current.slice(0, -1);
            updateActiveAmount(next);
            return;
        }
        if (key === '+/-') {
            if (current === '0')
                return;
            updateActiveAmount(current.startsWith('-') ? current.slice(1) : `-${current}`);
            return;
        }
        if (key === '.') {
            if (current.includes('.'))
                return;
            updateActiveAmount(`${current}.`);
            return;
        }
        const next = current === '0' ? key : `${current}${key}`;
        updateActiveAmount(next);
    };
    const createInvoice = async () => {
        if (cart.length === 0)
            throw new Error('Cart is empty');
        const selected = customerId || walkIn.data?.id;
        if (!selected)
            throw new Error('Customer not resolved');
        const createRes = await api.sales.create({
            body: {
                branchId: session.branchId,
                customerId: selected,
                lines: cart.map((line) => ({
                    itemId: line.itemId,
                    qty: line.qty,
                    rate: line.rate,
                    discountAmount: line.discountAmount,
                    taxRate: line.taxRate
                }))
            },
            extraHeaders: authHeaders()
        });
        if (createRes.status !== 201) {
            throw new Error('Failed to create invoice');
        }
        return createRes.body;
    };
    const saveDraft = useMutation({
        mutationFn: async () => createInvoice(),
        onSuccess: (invoice) => {
            setCart([]);
            setCashAmount('0');
            setCardAmount('0');
            setWalletAmount('0');
            setMessage(`Draft saved: ${invoice.invoiceNo}. Open Sales module to settle later.`);
            queryClient.invalidateQueries({ queryKey: ['sales-module', session.branchId] });
        }
    });
    const checkout = useMutation({
        mutationFn: async () => {
            const invoice = await createInvoice();
            const payments = [
                { mode: 'CASH', amount: Number(cashAmount) },
                { mode: 'CARD', amount: Number(cardAmount) },
                { mode: 'WALLET', amount: Number(walletAmount) }
            ].filter((p) => p.amount > 0);
            const finalPayments = payments.length > 0 ? payments : [{ mode: 'CASH', amount: Number(invoice.grandTotal) }];
            const settleRes = await api.sales.settle({
                params: { id: invoice.id },
                body: { payments: finalPayments },
                extraHeaders: authHeaders()
            });
            if (settleRes.status !== 200) {
                throw new Error(`Invoice ${invoice.invoiceNo} created but settlement failed`);
            }
            return {
                invoiceNo: settleRes.body.invoice.invoiceNo,
                receiptNo: settleRes.body.receipt.receiptNo,
                status: settleRes.body.invoice.status
            };
        },
        onSuccess: (result) => {
            setCart([]);
            setCashAmount('0');
            setCardAmount('0');
            setWalletAmount('0');
            setMessage(`Done: ${result.invoiceNo}, Receipt: ${result.receiptNo}, Status: ${result.status}`);
            queryClient.invalidateQueries({ queryKey: ['sales-module', session.branchId] });
            queryClient.invalidateQueries({ queryKey: ['stock-module', session.branchId] });
        }
    });
    const createCustomerFromModal = useMutation({
        mutationFn: async () => {
            const phone = customerPhoneQuery.trim();
            const name = newCustomerName.trim() || `Customer ${phone}`;
            if (!phone)
                throw new Error('Phone number is required');
            const res = await api.customers.create({
                body: { branchId: session.branchId, name, phone },
                extraHeaders: authHeaders()
            });
            if (res.status !== 201)
                throw new Error('Failed to create customer');
            return res.body;
        },
        onSuccess: (customer) => {
            queryClient.invalidateQueries({ queryKey: ['customers-pos', session.branchId] });
            setCustomerId(customer.id);
            setCustomerModalOpen(false);
            setCustomerPhoneQuery('');
            setNewCustomerName('');
            setCustomerModalError('');
        },
        onError: (error) => {
            setCustomerModalError(error.message);
        }
    });
    return (_jsxs("section", { className: "grid min-h-[calc(100vh-32px)] grid-cols-1 gap-3 xl:grid-cols-[390px_1fr]", children: [_jsxs("aside", { className: "flex min-h-[78vh] flex-col overflow-hidden rounded-md border border-slate-300 bg-white", children: [_jsxs("div", { className: "h-[340px] overflow-auto border-b border-slate-200", children: [cart.length === 0 ? _jsx("p", { className: "p-4 text-sm text-slate-500", children: "Add products from the right to start an order." }) : null, cart.map((line) => {
                                const lineNet = line.qty * line.rate - line.discountAmount + ((line.qty * line.rate - line.discountAmount) * line.taxRate) / 100;
                                return (_jsxs("div", { className: "flex items-start justify-between border-b border-slate-100 px-3 py-2", children: [_jsxs("div", { children: [_jsx("p", { className: "text-[20px] font-semibold leading-tight text-slate-800", children: line.name }), _jsxs("p", { className: "text-base text-slate-500", children: [line.qty.toFixed(3), " x ", money(line.rate), " / unit"] })] }), _jsxs("div", { className: "text-right", children: [_jsxs("p", { className: "text-[26px] font-bold leading-none text-slate-800", children: [money(lineNet), " \u20B9"] }), _jsxs("div", { className: "mt-1 flex justify-end gap-1", children: [_jsx("button", { className: "h-7 w-7 rounded bg-slate-200 p-0 text-sm text-slate-700", onClick: () => setCart((prev) => prev
                                                                .map((x) => (x.itemId === line.itemId ? { ...x, qty: Math.max(1, x.qty - 1) } : x))
                                                                .filter((x) => x.qty > 0)), children: "-" }), _jsx("button", { className: "h-7 w-7 rounded bg-slate-200 p-0 text-sm text-slate-700", onClick: () => setCart((prev) => prev.map((x) => (x.itemId === line.itemId ? { ...x, qty: x.qty + 1 } : x))), children: "+" })] })] })] }, line.itemId));
                            })] }), _jsxs("div", { className: "border-b border-slate-200 px-3 py-4 text-center", children: [_jsxs("p", { className: "text-[44px] font-bold leading-none text-slate-700", children: ["Total: ", money(total), " \u20B9"] }), _jsxs("p", { className: "text-2xl text-slate-500", children: ["Taxes: ", money(totalTax), " \u20B9"] }), _jsxs("p", { className: "mt-2 text-3xl italic text-sky-700", children: ["Total Items: ", totalItems] })] }), _jsxs("div", { className: "grid grid-cols-2 gap-2 border-b border-slate-200 p-2", children: [_jsx("button", { className: "rounded bg-slate-200 px-2 py-2 text-lg font-semibold text-slate-700", children: "Coupon" }), _jsx("button", { className: "rounded bg-emerald-500 px-2 py-2 text-lg font-semibold text-white", children: "Bag" }), _jsx("button", { className: "rounded bg-blue-600 px-2 py-2 text-lg font-semibold text-white", onClick: () => saveDraft.mutate(), children: "Save Draft" }), _jsx(Link, { className: "rounded bg-indigo-500 px-2 py-2 text-center text-lg font-semibold text-white", to: "/sales", children: "Orders" })] }), _jsxs("div", { className: "grid grid-cols-2 gap-2 p-2", children: [_jsxs("div", { className: "rounded border border-slate-200 p-2", children: [_jsx("label", { className: "text-sm text-slate-600", children: "Customer" }), _jsx("button", { className: "mt-1 w-full rounded border border-slate-300 bg-slate-50 px-2 py-2 text-left text-sm font-semibold text-slate-700", onClick: () => {
                                            setCustomerModalOpen(true);
                                            setCustomerModalError('');
                                        }, children: selectedCustomer ? `${selectedCustomer.name} (${selectedCustomer.phone ?? 'No phone'})` : 'Select Customer' }), _jsxs("div", { className: "mt-2 space-y-1", children: [_jsx("input", { className: `w-full rounded border px-2 py-1 text-right text-sm ${activeInput === 'cash' ? 'border-emerald-500 bg-emerald-50' : 'border-slate-300'}`, value: cashAmount, onChange: (e) => setCashAmount(e.target.value), onFocus: () => setActiveInput('cash'), placeholder: "Cash" }), _jsx("input", { className: `w-full rounded border px-2 py-1 text-right text-sm ${activeInput === 'card' ? 'border-emerald-500 bg-emerald-50' : 'border-slate-300'}`, value: cardAmount, onChange: (e) => setCardAmount(e.target.value), onFocus: () => setActiveInput('card'), placeholder: "Card" }), _jsx("input", { className: `w-full rounded border px-2 py-1 text-right text-sm ${activeInput === 'wallet' ? 'border-emerald-500 bg-emerald-50' : 'border-slate-300'}`, value: walletAmount, onChange: (e) => setWalletAmount(e.target.value), onFocus: () => setActiveInput('wallet'), placeholder: "Wallet" })] }), _jsx("button", { className: "mt-2 w-full rounded bg-emerald-600 px-2 py-2 text-xl font-bold text-white disabled:bg-emerald-300", onClick: () => checkout.mutate(), disabled: checkout.isPending || saveDraft.isPending, children: "Confirm Order" })] }), _jsx("div", { className: "grid grid-cols-3 gap-1", children: ['1', '2', '3', '4', '5', '6', '7', '8', '9', '+/-', '0', '.', 'C', '<'].map((key) => (_jsx("button", { className: `rounded px-2 py-3 text-lg font-semibold ${key === 'C' ? 'bg-rose-200 text-rose-800' : key === '<' ? 'bg-amber-200 text-amber-800' : 'bg-slate-100 text-slate-800'}`, onClick: () => keypadPress(key), children: key }, key))) })] }), saveDraft.error ? _jsx("p", { className: "px-3 pb-1 text-sm text-red-700", children: saveDraft.error.message }) : null, checkout.error ? _jsx("p", { className: "px-3 pb-1 text-sm text-red-700", children: checkout.error.message }) : null, message ? _jsx("p", { className: "px-3 pb-2 text-sm text-emerald-700", children: message }) : null] }), _jsxs("div", { className: "rounded-md border border-slate-300 bg-white", children: [_jsxs("div", { className: "flex items-center justify-between gap-2 border-b border-slate-200 p-2", children: [_jsx("div", { className: "flex flex-wrap gap-1", children: categories.map((category) => (_jsx("button", { className: `rounded px-3 py-2 text-sm font-semibold ${activeCategory === category ? 'bg-emerald-600 text-white' : 'bg-slate-100 text-slate-700'}`, onClick: () => setActiveCategory(category), children: category }, category))) }), _jsx("input", { className: "w-full max-w-72 rounded-full border border-slate-300 px-4 py-2 text-sm", placeholder: "Search Products", value: search, onChange: (e) => setSearch(e.target.value) })] }), _jsx("div", { className: "grid max-h-[calc(100vh-150px)] grid-cols-2 gap-2 overflow-auto p-2 sm:grid-cols-3 lg:grid-cols-4 2xl:grid-cols-6", children: filteredItems.map((item) => (_jsxs("button", { className: "rounded border border-slate-200 bg-white p-2 text-left hover:bg-slate-50", onClick: () => addItem(item), children: [_jsx("div", { className: "mb-2 h-16 rounded bg-slate-100" }), _jsx("p", { className: "truncate text-sm font-semibold text-slate-800", children: item.name }), _jsx("p", { className: "truncate text-xs text-slate-500", children: item.code }), _jsxs("p", { className: "text-xs font-semibold text-indigo-700", children: [money(item.sellPrice), " \u20B9"] })] }, item.id))) })] }), customerModalOpen ? (_jsx("div", { className: "fixed inset-0 z-50 grid place-items-center bg-slate-900/40 p-4", children: _jsxs("div", { className: "w-full max-w-xl rounded-xl border border-slate-300 bg-white p-4 shadow-2xl", children: [_jsxs("div", { className: "mb-3 flex items-center justify-between", children: [_jsx("h3", { className: "text-xl font-semibold text-slate-900", children: "Select or Create Customer" }), _jsx("button", { className: "rounded bg-slate-200 px-2 py-1 text-sm text-slate-700", onClick: () => {
                                        setCustomerModalOpen(false);
                                        setCustomerModalError('');
                                    }, children: "Close" })] }), _jsx("label", { className: "text-sm text-slate-600", children: "Phone Number" }), _jsx("input", { className: "mt-1 w-full rounded border border-slate-300 px-3 py-2", value: customerPhoneQuery, onChange: (e) => setCustomerPhoneQuery(e.target.value), placeholder: "Enter phone number" }), _jsxs("div", { className: "mt-3 max-h-52 space-y-2 overflow-auto rounded border border-slate-200 p-2", children: [matchingCustomers.length === 0 ? _jsx("p", { className: "text-sm text-slate-500", children: "No matching customer found." }) : null, matchingCustomers.map((c) => (_jsxs("button", { className: "w-full rounded border border-slate-200 bg-slate-50 px-3 py-2 text-left hover:bg-slate-100", onClick: () => {
                                        setCustomerId(c.id);
                                        setCustomerModalOpen(false);
                                        setCustomerPhoneQuery('');
                                        setNewCustomerName('');
                                        setCustomerModalError('');
                                    }, children: [_jsx("p", { className: "font-semibold text-slate-800", children: c.name }), _jsxs("p", { className: "text-xs text-slate-500", children: [c.phone ?? 'No phone', " | ", c.code] })] }, c.id)))] }), customerPhoneQuery.trim() && matchingCustomers.length === 0 ? (_jsxs("div", { className: "mt-3 rounded border border-emerald-200 bg-emerald-50 p-3", children: [_jsx("p", { className: "text-sm font-semibold text-emerald-800", children: "Create new customer" }), _jsx("input", { className: "mt-2 w-full rounded border border-slate-300 px-3 py-2", value: newCustomerName, onChange: (e) => setNewCustomerName(e.target.value), placeholder: "Customer name (optional)" }), _jsx("button", { className: "mt-2 rounded bg-emerald-600 px-3 py-2 text-sm font-semibold text-white", onClick: () => createCustomerFromModal.mutate(), disabled: createCustomerFromModal.isPending, children: "Create Customer" })] })) : null, customerModalError ? _jsx("p", { className: "mt-2 text-sm text-red-700", children: customerModalError }) : null] }) })) : null] }));
}
function SalesPage() {
    const session = requireSession();
    const queryClient = useQueryClient();
    const sales = useQuery({
        queryKey: ['sales-module', session.branchId],
        queryFn: async () => {
            const res = await api.sales.list({ query: { branchId: session.branchId } });
            if (res.status !== 200)
                throw new Error('Failed to load sales');
            return res.body;
        }
    });
    const settleFullCash = useMutation({
        mutationFn: async (invoice) => {
            const pending = Number(invoice.grandTotal) - Number(invoice.paidTotal);
            if (pending <= 0) {
                throw new Error(`Invoice ${invoice.invoiceNo} is already fully paid`);
            }
            const res = await api.sales.settle({
                params: { id: invoice.id },
                body: { payments: [{ mode: 'CASH', amount: pending }] },
                extraHeaders: authHeaders()
            });
            if (res.status !== 200)
                throw new Error('Failed to settle invoice');
            return res.body;
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['sales-module', session.branchId] });
        }
    });
    return (_jsxs("section", { className: "rounded-xl border border-slate-200 bg-white p-4", children: [_jsx("h2", { className: "text-xl font-semibold", children: "Sales" }), _jsx("p", { className: "mb-3 mt-1 text-sm text-slate-600", children: "All drafts and partial invoices are listed here. Use settle to generate a receipt." }), _jsx("div", { className: "overflow-auto", children: _jsxs("table", { className: "w-full border-collapse text-sm", children: [_jsx("thead", { children: _jsxs("tr", { className: "border-b border-slate-200 text-left", children: [_jsx("th", { className: "p-2", children: "Invoice" }), _jsx("th", { className: "p-2", children: "Status" }), _jsx("th", { className: "p-2", children: "Total" }), _jsx("th", { className: "p-2", children: "Paid" }), _jsx("th", { className: "p-2", children: "Pending" }), _jsx("th", { className: "p-2", children: "Action" })] }) }), _jsx("tbody", { children: sales.data?.map((invoice) => {
                                const pending = Number(invoice.grandTotal) - Number(invoice.paidTotal);
                                return (_jsxs("tr", { className: "border-b border-slate-100", children: [_jsx("td", { className: "p-2", children: invoice.invoiceNo }), _jsx("td", { className: "p-2", children: invoice.status }), _jsx("td", { className: "p-2", children: money(Number(invoice.grandTotal)) }), _jsx("td", { className: "p-2", children: money(Number(invoice.paidTotal)) }), _jsx("td", { className: "p-2", children: money(pending) }), _jsx("td", { className: "p-2", children: _jsx("button", { className: "rounded-md bg-teal-700 px-2 py-1 text-xs font-semibold text-white disabled:bg-slate-400", disabled: pending <= 0 || settleFullCash.isPending, onClick: () => settleFullCash.mutate(invoice), children: "Settle Cash" }) })] }, invoice.id));
                            }) })] }) }), settleFullCash.error ? _jsx("p", { className: "mt-2 text-sm text-red-700", children: settleFullCash.error.message }) : null] }));
}
function ItemsPage() {
    requireSession();
    const queryClient = useQueryClient();
    const [form, setForm] = useState({ code: '', name: '', category: '', uom: 'PCS', sellPrice: '0', taxRate: '0' });
    const items = useQuery({
        queryKey: ['items-module'],
        queryFn: async () => {
            const res = await api.items.list({ query: { activeOnly: true } });
            if (res.status !== 200)
                throw new Error('Failed to fetch items');
            return res.body;
        }
    });
    const createItem = useMutation({
        mutationFn: async () => {
            const res = await api.items.create({
                body: {
                    code: form.code,
                    name: form.name,
                    category: form.category || undefined,
                    uom: form.uom,
                    sellPrice: Number(form.sellPrice),
                    taxRate: Number(form.taxRate)
                },
                extraHeaders: authHeaders()
            });
            if (res.status !== 201)
                throw new Error('Failed to create item');
            return res.body;
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['items-module'] });
            setForm({ code: '', name: '', category: '', uom: 'PCS', sellPrice: '0', taxRate: '0' });
        }
    });
    return (_jsxs("section", { className: "rounded-xl border border-slate-200 bg-white p-4", children: [_jsx("h2", { className: "text-xl font-semibold", children: "Items" }), _jsxs("form", { className: "mb-3 mt-3 grid grid-cols-1 gap-2 md:grid-cols-3", onSubmit: (e) => {
                    e.preventDefault();
                    createItem.mutate();
                }, children: [_jsx("input", { className: "rounded-lg border border-slate-300 px-3 py-2", placeholder: "Code", value: form.code, onChange: (e) => setForm((s) => ({ ...s, code: e.target.value })) }), _jsx("input", { className: "rounded-lg border border-slate-300 px-3 py-2", placeholder: "Name", value: form.name, onChange: (e) => setForm((s) => ({ ...s, name: e.target.value })) }), _jsx("input", { className: "rounded-lg border border-slate-300 px-3 py-2", placeholder: "Category", value: form.category, onChange: (e) => setForm((s) => ({ ...s, category: e.target.value })) }), _jsx("input", { className: "rounded-lg border border-slate-300 px-3 py-2", placeholder: "UOM", value: form.uom, onChange: (e) => setForm((s) => ({ ...s, uom: e.target.value })) }), _jsx("input", { className: "rounded-lg border border-slate-300 px-3 py-2", placeholder: "Price", type: "number", value: form.sellPrice, onChange: (e) => setForm((s) => ({ ...s, sellPrice: e.target.value })) }), _jsx("input", { className: "rounded-lg border border-slate-300 px-3 py-2", placeholder: "Tax %", type: "number", value: form.taxRate, onChange: (e) => setForm((s) => ({ ...s, taxRate: e.target.value })) }), _jsx("button", { className: "rounded-lg bg-teal-700 px-3 py-2 font-semibold text-white md:col-span-3", type: "submit", children: "Create Item" })] }), _jsx("div", { className: "overflow-auto", children: _jsxs("table", { className: "w-full border-collapse text-sm", children: [_jsx("thead", { children: _jsxs("tr", { className: "border-b border-slate-200 text-left", children: [_jsx("th", { className: "p-2", children: "Code" }), _jsx("th", { className: "p-2", children: "Name" }), _jsx("th", { className: "p-2", children: "Price" }), _jsx("th", { className: "p-2", children: "Tax%" })] }) }), _jsx("tbody", { children: items.data?.map((item) => (_jsxs("tr", { className: "border-b border-slate-100", children: [_jsx("td", { className: "p-2", children: item.code }), _jsx("td", { className: "p-2", children: item.name }), _jsx("td", { className: "p-2", children: item.sellPrice }), _jsx("td", { className: "p-2", children: item.taxRate })] }, item.id))) })] }) })] }));
}
function CustomersPage() {
    const session = requireSession();
    const queryClient = useQueryClient();
    const [name, setName] = useState('');
    const [phone, setPhone] = useState('');
    const customers = useQuery({
        queryKey: ['customers-module', session.branchId],
        queryFn: async () => {
            const res = await api.customers.list({ query: { branchId: session.branchId } });
            if (res.status !== 200)
                throw new Error('Failed to fetch customers');
            return res.body;
        }
    });
    const createCustomer = useMutation({
        mutationFn: async () => {
            const res = await api.customers.create({
                body: { branchId: session.branchId, name, phone: phone || undefined },
                extraHeaders: authHeaders()
            });
            if (res.status !== 201)
                throw new Error('Failed to create customer');
            return res.body;
        },
        onSuccess: () => {
            setName('');
            setPhone('');
            queryClient.invalidateQueries({ queryKey: ['customers-module', session.branchId] });
        }
    });
    return (_jsxs("section", { className: "rounded-xl border border-slate-200 bg-white p-4", children: [_jsx("h2", { className: "text-xl font-semibold", children: "Customers" }), _jsxs("form", { className: "mb-3 mt-3 grid grid-cols-1 gap-2 md:grid-cols-3", onSubmit: (e) => {
                    e.preventDefault();
                    createCustomer.mutate();
                }, children: [_jsx("input", { className: "rounded-lg border border-slate-300 px-3 py-2", placeholder: "Customer name", value: name, onChange: (e) => setName(e.target.value) }), _jsx("input", { className: "rounded-lg border border-slate-300 px-3 py-2", placeholder: "Phone", value: phone, onChange: (e) => setPhone(e.target.value) }), _jsx("button", { className: "rounded-lg bg-teal-700 px-3 py-2 font-semibold text-white", type: "submit", children: "Create Customer" })] }), _jsx("div", { className: "overflow-auto", children: _jsxs("table", { className: "w-full border-collapse text-sm", children: [_jsx("thead", { children: _jsxs("tr", { className: "border-b border-slate-200 text-left", children: [_jsx("th", { className: "p-2", children: "Code" }), _jsx("th", { className: "p-2", children: "Name" }), _jsx("th", { className: "p-2", children: "Walk In" })] }) }), _jsx("tbody", { children: customers.data?.map((customer) => (_jsxs("tr", { className: "border-b border-slate-100", children: [_jsx("td", { className: "p-2", children: customer.code }), _jsx("td", { className: "p-2", children: customer.name }), _jsx("td", { className: "p-2", children: customer.isWalkIn ? 'Yes' : 'No' })] }, customer.id))) })] }) })] }));
}
function StockPage() {
    const session = requireSession();
    const queryClient = useQueryClient();
    const [itemId, setItemId] = useState('');
    const [qty, setQty] = useState('0');
    const [reason, setReason] = useState('Opening');
    const onHand = useQuery({
        queryKey: ['stock-module', session.branchId],
        queryFn: async () => {
            const res = await api.stock.onHand({ query: { branchId: session.branchId } });
            if (res.status !== 200)
                throw new Error('Failed to fetch stock');
            return res.body;
        }
    });
    const opening = useMutation({
        mutationFn: async () => {
            const res = await api.stock.opening({
                body: { branchId: session.branchId, itemId, qty: Number(qty), reason },
                extraHeaders: authHeaders()
            });
            if (res.status !== 201)
                throw new Error('Failed to post opening');
            return res.body;
        },
        onSuccess: () => queryClient.invalidateQueries({ queryKey: ['stock-module', session.branchId] })
    });
    return (_jsxs("section", { className: "rounded-xl border border-slate-200 bg-white p-4", children: [_jsx("h2", { className: "text-xl font-semibold", children: "Stock" }), _jsxs("form", { className: "mb-3 mt-3 grid grid-cols-1 gap-2 md:grid-cols-4", onSubmit: (e) => {
                    e.preventDefault();
                    opening.mutate();
                }, children: [_jsx("input", { className: "rounded-lg border border-slate-300 px-3 py-2", value: itemId, onChange: (e) => setItemId(e.target.value), placeholder: "Item ID/Code" }), _jsx("input", { className: "rounded-lg border border-slate-300 px-3 py-2", value: qty, onChange: (e) => setQty(e.target.value), type: "number", placeholder: "Qty" }), _jsx("input", { className: "rounded-lg border border-slate-300 px-3 py-2", value: reason, onChange: (e) => setReason(e.target.value), placeholder: "Reason" }), _jsx("button", { className: "rounded-lg bg-teal-700 px-3 py-2 font-semibold text-white", type: "submit", children: "Add Opening" })] }), _jsx("div", { className: "overflow-auto", children: _jsxs("table", { className: "w-full border-collapse text-sm", children: [_jsx("thead", { children: _jsxs("tr", { className: "border-b border-slate-200 text-left", children: [_jsx("th", { className: "p-2", children: "Item ID" }), _jsx("th", { className: "p-2", children: "On Hand" })] }) }), _jsx("tbody", { children: onHand.data?.map((row) => (_jsxs("tr", { className: "border-b border-slate-100", children: [_jsx("td", { className: "p-2", children: row.itemId }), _jsx("td", { className: "p-2", children: row.onHand })] }, row.itemId))) })] }) })] }));
}
function ReceiptsPage() {
    requireSession();
    const [invoiceId, setInvoiceId] = useState('');
    const receipt = useQuery({
        queryKey: ['receiptByInvoice', invoiceId],
        enabled: !!invoiceId,
        queryFn: async () => {
            const res = await api.receipts.getByInvoice({ params: { invoiceId } });
            if (res.status !== 200)
                throw new Error('Receipt not found');
            return res.body;
        }
    });
    return (_jsxs("section", { className: "rounded-xl border border-slate-200 bg-white p-4", children: [_jsx("h2", { className: "text-xl font-semibold", children: "Receipts" }), _jsx("input", { className: "mt-3 w-full rounded-lg border border-slate-300 px-3 py-2 md:max-w-md", placeholder: "Invoice ID or Invoice No", value: invoiceId, onChange: (e) => setInvoiceId(e.target.value) }), receipt.data ? (_jsxs("article", { className: "mt-3 max-w-md rounded-lg border border-dashed border-slate-400 p-3", children: [_jsxs("p", { children: ["Receipt No: ", _jsx("strong", { children: receipt.data.receiptNo })] }), _jsxs("p", { children: ["Invoice ID: ", receipt.data.invoiceId] }), _jsxs("p", { children: ["Amount: ", receipt.data.amount] }), _jsxs("p", { children: ["Date: ", new Date(receipt.data.createdAt).toLocaleString()] })] })) : null] }));
}
const rootRoute = createRootRoute({ component: AppLayout });
const loginRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/',
    beforeLoad: () => {
        if (getSession()) {
            throw redirect({ to: '/pos' });
        }
    },
    component: LoginPage
});
const posRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/pos',
    beforeLoad: () => requireSession(),
    component: PosPage
});
const salesRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/sales',
    beforeLoad: () => requireSession(),
    component: SalesPage
});
const itemsRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/items',
    beforeLoad: () => requireSession(),
    component: ItemsPage
});
const customersRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/customers',
    beforeLoad: () => requireSession(),
    component: CustomersPage
});
const stockRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/stock',
    beforeLoad: () => requireSession(),
    component: StockPage
});
const receiptsRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/receipts',
    beforeLoad: () => requireSession(),
    component: ReceiptsPage
});
const routeTree = rootRoute.addChildren([loginRoute, posRoute, salesRoute, itemsRoute, customersRoute, stockRoute, receiptsRoute]);
export const router = createRouter({ routeTree });
//# sourceMappingURL=router.js.map