import {
  Link,
  Outlet,
  createRootRoute,
  createRoute,
  createRouter,
  redirect,
  useNavigate,
  useRouterState
} from '@tanstack/react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { FormEvent, useMemo, useState } from 'react';
import { api, authHeaders } from './lib/api';
import { clearSession, getSession, setSession } from './lib/session';

function money(n: number | string | null | undefined) {
  const value = Number(n);
  if (!Number.isFinite(value)) return '0.00';
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
    return (
      <main className="min-h-screen grid place-items-center bg-[radial-gradient(circle_at_20%_20%,#fcebd7_0%,#eff4ff_45%,#f6f8fc_100%)] p-4">
        <Outlet />
      </main>
    );
  }

  return (
    <div className="min-h-screen bg-slate-100">
      <button
        className="fixed left-3 top-3 z-40 h-11 w-11 rounded-lg border border-slate-300 bg-white text-lg"
        onClick={() => setOpen((v) => !v)}
      >
        ☰
      </button>
      <aside
        className={`fixed left-0 top-0 z-30 h-screen w-60 bg-slate-900 p-4 pt-16 text-white transition-transform ${open ? 'translate-x-0' : '-translate-x-full'}`}
      >
        <h2 className="mb-4 text-lg font-semibold">Modules</h2>
        <nav className="grid gap-2">
          <Link className="rounded-lg border border-slate-700 bg-slate-800 px-3 py-2" to="/pos" onClick={() => setOpen(false)}>
            POS
          </Link>
          <Link className="rounded-lg border border-slate-700 bg-slate-800 px-3 py-2" to="/sales" onClick={() => setOpen(false)}>
            Sales
          </Link>
          <Link className="rounded-lg border border-slate-700 bg-slate-800 px-3 py-2" to="/items" onClick={() => setOpen(false)}>
            Items
          </Link>
          <Link className="rounded-lg border border-slate-700 bg-slate-800 px-3 py-2" to="/customers" onClick={() => setOpen(false)}>
            Customers
          </Link>
          <Link className="rounded-lg border border-slate-700 bg-slate-800 px-3 py-2" to="/stock" onClick={() => setOpen(false)}>
            Stock
          </Link>
          <Link className="rounded-lg border border-slate-700 bg-slate-800 px-3 py-2" to="/receipts" onClick={() => setOpen(false)}>
            Receipts
          </Link>
          <button
            className="rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-left"
            onClick={() => {
              clearSession();
              window.location.href = '/';
            }}
          >
            Logout
          </button>
        </nav>
      </aside>
      <main className="p-4 md:p-5">
        <Outlet />
      </main>
    </div>
  );
}

function LoginPage() {
  const navigate = useNavigate();
  const [username, setUsername] = useState('admin');
  const [password, setPassword] = useState('password');

  const login = useMutation({
    mutationFn: async () => {
      const res = await api.auth.login({ body: { username, password } });
      if (res.status !== 200) throw new Error('Login failed');
      return res.body;
    }
  });

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    const data = await login.mutateAsync();
    setSession(data);
    navigate({ to: '/pos' });
  };

  return (
    <section className="w-full max-w-md rounded-2xl border border-slate-300 bg-white p-7 shadow-xl">
      <h1 className="text-2xl font-bold text-slate-900">Point Of Sale</h1>
      <p className="mt-1 text-sm text-slate-600">Sign in to continue</p>
      <form onSubmit={onSubmit} className="mt-4 grid gap-3">
        <input
          className="rounded-lg border border-slate-300 px-3 py-2"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          placeholder="Username"
        />
        <input
          className="rounded-lg border border-slate-300 px-3 py-2"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="Password"
          type="password"
        />
        <button className="rounded-lg bg-teal-700 px-3 py-2 font-semibold text-white" type="submit" disabled={login.isPending}>
          Login
        </button>
      </form>
      <small className="mt-3 block text-xs text-slate-500">Default: admin/password, cashier/password</small>
      {login.error ? <p className="mt-2 text-sm text-red-700">{(login.error as Error).message}</p> : null}
    </section>
  );
}

type CartLine = {
  itemId: string;
  name: string;
  qty: number;
  rate: number;
  discountAmount: number;
  taxRate: number;
};

function PosPage() {
  const session = requireSession();
  const queryClient = useQueryClient();
  const [customerId, setCustomerId] = useState('');
  const [cart, setCart] = useState<CartLine[]>([]);
  const [search, setSearch] = useState('');
  const [activeCategory, setActiveCategory] = useState('All');
  const [customerModalOpen, setCustomerModalOpen] = useState(false);
  const [customerPhoneQuery, setCustomerPhoneQuery] = useState('');
  const [newCustomerName, setNewCustomerName] = useState('');
  const [customerModalError, setCustomerModalError] = useState('');
  const [cashAmount, setCashAmount] = useState('0');
  const [cardAmount, setCardAmount] = useState('0');
  const [walletAmount, setWalletAmount] = useState('0');
  const [activeInput, setActiveInput] = useState<'cash' | 'card' | 'wallet'>('cash');
  const [message, setMessage] = useState('');

  const items = useQuery({
    queryKey: ['items-pos'],
    queryFn: async () => {
      const res = await api.items.list({ query: { activeOnly: true } });
      if (res.status !== 200) throw new Error('Failed to load items');
      return res.body;
    }
  });

  const customers = useQuery({
    queryKey: ['customers-pos', session.branchId],
    queryFn: async () => {
      const res = await api.customers.list({ query: { branchId: session.branchId } });
      if (res.status !== 200) throw new Error('Failed to load customers');
      return res.body;
    }
  });

  const walkIn = useQuery({
    queryKey: ['walk-in', session.branchId],
    queryFn: async () => {
      const res = await api.customers.getWalkIn({ params: { branchId: session.branchId } });
      if (res.status !== 200) throw new Error('Failed to load walk-in customer');
      return res.body;
    }
  });

  const addItem = (item: { id: string; name: string; sellPrice: number | string; taxRate: number | string }) => {
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
    const set = new Set<string>();
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
      const textMatch =
        keyword.length === 0 ||
        item.name.toLowerCase().includes(keyword) ||
        item.code.toLowerCase().includes(keyword) ||
        category.toLowerCase().includes(keyword);
      return categoryMatch && textMatch;
    });
  }, [items.data, search, activeCategory]);

  const matchingCustomers = useMemo(() => {
    const q = customerPhoneQuery.trim();
    if (!q) return [];
    return (customers.data ?? []).filter((c) => (c.phone ?? '').includes(q));
  }, [customers.data, customerPhoneQuery]);

  const selectedCustomer = useMemo(() => {
    if (!customerId) return walkIn.data;
    return (customers.data ?? []).find((c) => c.id === customerId) ?? walkIn.data;
  }, [customerId, customers.data, walkIn.data]);

  const withValue = (value: string, update: (next: string) => void) => {
    update(value);
  };

  const updateActiveAmount = (nextValue: string) => {
    if (activeInput === 'cash') withValue(nextValue, setCashAmount);
    if (activeInput === 'card') withValue(nextValue, setCardAmount);
    if (activeInput === 'wallet') withValue(nextValue, setWalletAmount);
  };

  const getActiveAmount = () => {
    if (activeInput === 'cash') return cashAmount;
    if (activeInput === 'card') return cardAmount;
    return walletAmount;
  };

  const keypadPress = (key: string) => {
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
      if (current === '0') return;
      updateActiveAmount(current.startsWith('-') ? current.slice(1) : `-${current}`);
      return;
    }
    if (key === '.') {
      if (current.includes('.')) return;
      updateActiveAmount(`${current}.`);
      return;
    }

    const next = current === '0' ? key : `${current}${key}`;
    updateActiveAmount(next);
  };

  const createInvoice = async () => {
    if (cart.length === 0) throw new Error('Cart is empty');

    const selected = customerId || walkIn.data?.id;
    if (!selected) throw new Error('Customer not resolved');

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
        { mode: 'CASH' as const, amount: Number(cashAmount) },
        { mode: 'CARD' as const, amount: Number(cardAmount) },
        { mode: 'WALLET' as const, amount: Number(walletAmount) }
      ].filter((p) => p.amount > 0);

      const finalPayments = payments.length > 0 ? payments : [{ mode: 'CASH' as const, amount: Number(invoice.grandTotal) }];

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
      if (!phone) throw new Error('Phone number is required');

      const res = await api.customers.create({
        body: { branchId: session.branchId, name, phone },
        extraHeaders: authHeaders()
      });
      if (res.status !== 201) throw new Error('Failed to create customer');
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
      setCustomerModalError((error as Error).message);
    }
  });

  return (
    <section className="grid min-h-[calc(100vh-32px)] grid-cols-1 gap-3 xl:grid-cols-[390px_1fr]">
      <aside className="flex min-h-[78vh] flex-col overflow-hidden rounded-md border border-slate-300 bg-white">
        <div className="h-[340px] overflow-auto border-b border-slate-200">
          {cart.length === 0 ? <p className="p-4 text-sm text-slate-500">Add products from the right to start an order.</p> : null}
          {cart.map((line) => {
            const lineNet = line.qty * line.rate - line.discountAmount + ((line.qty * line.rate - line.discountAmount) * line.taxRate) / 100;
            return (
              <div className="flex items-start justify-between border-b border-slate-100 px-3 py-2" key={line.itemId}>
                <div>
                  <p className="text-[20px] font-semibold leading-tight text-slate-800">{line.name}</p>
                  <p className="text-base text-slate-500">
                    {line.qty.toFixed(3)} x {money(line.rate)} / unit
                  </p>
                </div>
                <div className="text-right">
                  <p className="text-[26px] font-bold leading-none text-slate-800">{money(lineNet)} ₹</p>
                  <div className="mt-1 flex justify-end gap-1">
                    <button
                      className="h-7 w-7 rounded bg-slate-200 p-0 text-sm text-slate-700"
                      onClick={() =>
                        setCart((prev) =>
                          prev
                            .map((x) => (x.itemId === line.itemId ? { ...x, qty: Math.max(1, x.qty - 1) } : x))
                            .filter((x) => x.qty > 0)
                        )
                      }
                    >
                      -
                    </button>
                    <button
                      className="h-7 w-7 rounded bg-slate-200 p-0 text-sm text-slate-700"
                      onClick={() => setCart((prev) => prev.map((x) => (x.itemId === line.itemId ? { ...x, qty: x.qty + 1 } : x)))}
                    >
                      +
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        <div className="border-b border-slate-200 px-3 py-4 text-center">
          <p className="text-[44px] font-bold leading-none text-slate-700">Total: {money(total)} ₹</p>
          <p className="text-2xl text-slate-500">Taxes: {money(totalTax)} ₹</p>
          <p className="mt-2 text-3xl italic text-sky-700">Total Items: {totalItems}</p>
        </div>

        <div className="grid grid-cols-2 gap-2 border-b border-slate-200 p-2">
          <button className="rounded bg-slate-200 px-2 py-2 text-lg font-semibold text-slate-700">Coupon</button>
          <button className="rounded bg-emerald-500 px-2 py-2 text-lg font-semibold text-white">Bag</button>
          <button className="rounded bg-blue-600 px-2 py-2 text-lg font-semibold text-white" onClick={() => saveDraft.mutate()}>
            Save Draft
          </button>
          <Link className="rounded bg-indigo-500 px-2 py-2 text-center text-lg font-semibold text-white" to="/sales">
            Orders
          </Link>
        </div>

        <div className="grid grid-cols-2 gap-2 p-2">
          <div className="rounded border border-slate-200 p-2">
            <label className="text-sm text-slate-600">Customer</label>
            <button
              className="mt-1 w-full rounded border border-slate-300 bg-slate-50 px-2 py-2 text-left text-sm font-semibold text-slate-700"
              onClick={() => {
                setCustomerModalOpen(true);
                setCustomerModalError('');
              }}
            >
              {selectedCustomer ? `${selectedCustomer.name} (${selectedCustomer.phone ?? 'No phone'})` : 'Select Customer'}
            </button>

            <div className="mt-2 space-y-1">
              <input
                className={`w-full rounded border px-2 py-1 text-right text-sm ${activeInput === 'cash' ? 'border-emerald-500 bg-emerald-50' : 'border-slate-300'}`}
                value={cashAmount}
                onChange={(e) => setCashAmount(e.target.value)}
                onFocus={() => setActiveInput('cash')}
                placeholder="Cash"
              />
              <input
                className={`w-full rounded border px-2 py-1 text-right text-sm ${activeInput === 'card' ? 'border-emerald-500 bg-emerald-50' : 'border-slate-300'}`}
                value={cardAmount}
                onChange={(e) => setCardAmount(e.target.value)}
                onFocus={() => setActiveInput('card')}
                placeholder="Card"
              />
              <input
                className={`w-full rounded border px-2 py-1 text-right text-sm ${activeInput === 'wallet' ? 'border-emerald-500 bg-emerald-50' : 'border-slate-300'}`}
                value={walletAmount}
                onChange={(e) => setWalletAmount(e.target.value)}
                onFocus={() => setActiveInput('wallet')}
                placeholder="Wallet"
              />
            </div>

            <button
              className="mt-2 w-full rounded bg-emerald-600 px-2 py-2 text-xl font-bold text-white disabled:bg-emerald-300"
              onClick={() => checkout.mutate()}
              disabled={checkout.isPending || saveDraft.isPending}
            >
              Confirm Order
            </button>
          </div>

          <div className="grid grid-cols-3 gap-1">
            {['1', '2', '3', '4', '5', '6', '7', '8', '9', '+/-', '0', '.', 'C', '<'].map((key) => (
              <button
                key={key}
                className={`rounded px-2 py-3 text-lg font-semibold ${key === 'C' ? 'bg-rose-200 text-rose-800' : key === '<' ? 'bg-amber-200 text-amber-800' : 'bg-slate-100 text-slate-800'}`}
                onClick={() => keypadPress(key)}
              >
                {key}
              </button>
            ))}
          </div>
        </div>

        {saveDraft.error ? <p className="px-3 pb-1 text-sm text-red-700">{(saveDraft.error as Error).message}</p> : null}
        {checkout.error ? <p className="px-3 pb-1 text-sm text-red-700">{(checkout.error as Error).message}</p> : null}
        {message ? <p className="px-3 pb-2 text-sm text-emerald-700">{message}</p> : null}
      </aside>

      <div className="rounded-md border border-slate-300 bg-white">
        <div className="flex items-center justify-between gap-2 border-b border-slate-200 p-2">
          <div className="flex flex-wrap gap-1">
            {categories.map((category) => (
              <button
                key={category}
                className={`rounded px-3 py-2 text-sm font-semibold ${activeCategory === category ? 'bg-emerald-600 text-white' : 'bg-slate-100 text-slate-700'}`}
                onClick={() => setActiveCategory(category)}
              >
                {category}
              </button>
            ))}
          </div>
          <input
            className="w-full max-w-72 rounded-full border border-slate-300 px-4 py-2 text-sm"
            placeholder="Search Products"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>

        <div className="grid max-h-[calc(100vh-150px)] grid-cols-2 gap-2 overflow-auto p-2 sm:grid-cols-3 lg:grid-cols-4 2xl:grid-cols-6">
          {filteredItems.map((item) => (
            <button key={item.id} className="rounded border border-slate-200 bg-white p-2 text-left hover:bg-slate-50" onClick={() => addItem(item)}>
              <div className="mb-2 h-16 rounded bg-slate-100" />
              <p className="truncate text-sm font-semibold text-slate-800">{item.name}</p>
              <p className="truncate text-xs text-slate-500">{item.code}</p>
              <p className="text-xs font-semibold text-indigo-700">{money(item.sellPrice)} ₹</p>
            </button>
          ))}
        </div>
      </div>

      {customerModalOpen ? (
        <div className="fixed inset-0 z-50 grid place-items-center bg-slate-900/40 p-4">
          <div className="w-full max-w-xl rounded-xl border border-slate-300 bg-white p-4 shadow-2xl">
            <div className="mb-3 flex items-center justify-between">
              <h3 className="text-xl font-semibold text-slate-900">Select or Create Customer</h3>
              <button
                className="rounded bg-slate-200 px-2 py-1 text-sm text-slate-700"
                onClick={() => {
                  setCustomerModalOpen(false);
                  setCustomerModalError('');
                }}
              >
                Close
              </button>
            </div>

            <label className="text-sm text-slate-600">Phone Number</label>
            <input
              className="mt-1 w-full rounded border border-slate-300 px-3 py-2"
              value={customerPhoneQuery}
              onChange={(e) => setCustomerPhoneQuery(e.target.value)}
              placeholder="Enter phone number"
            />

            <div className="mt-3 max-h-52 space-y-2 overflow-auto rounded border border-slate-200 p-2">
              {matchingCustomers.length === 0 ? <p className="text-sm text-slate-500">No matching customer found.</p> : null}
              {matchingCustomers.map((c) => (
                <button
                  key={c.id}
                  className="w-full rounded border border-slate-200 bg-slate-50 px-3 py-2 text-left hover:bg-slate-100"
                  onClick={() => {
                    setCustomerId(c.id);
                    setCustomerModalOpen(false);
                    setCustomerPhoneQuery('');
                    setNewCustomerName('');
                    setCustomerModalError('');
                  }}
                >
                  <p className="font-semibold text-slate-800">{c.name}</p>
                  <p className="text-xs text-slate-500">
                    {c.phone ?? 'No phone'} | {c.code}
                  </p>
                </button>
              ))}
            </div>

            {customerPhoneQuery.trim() && matchingCustomers.length === 0 ? (
              <div className="mt-3 rounded border border-emerald-200 bg-emerald-50 p-3">
                <p className="text-sm font-semibold text-emerald-800">Create new customer</p>
                <input
                  className="mt-2 w-full rounded border border-slate-300 px-3 py-2"
                  value={newCustomerName}
                  onChange={(e) => setNewCustomerName(e.target.value)}
                  placeholder="Customer name (optional)"
                />
                <button
                  className="mt-2 rounded bg-emerald-600 px-3 py-2 text-sm font-semibold text-white"
                  onClick={() => createCustomerFromModal.mutate()}
                  disabled={createCustomerFromModal.isPending}
                >
                  Create Customer
                </button>
              </div>
            ) : null}

            {customerModalError ? <p className="mt-2 text-sm text-red-700">{customerModalError}</p> : null}
          </div>
        </div>
      ) : null}
    </section>
  );
}
function SalesPage() {
  const session = requireSession();
  const queryClient = useQueryClient();

  const sales = useQuery({
    queryKey: ['sales-module', session.branchId],
    queryFn: async () => {
      const res = await api.sales.list({ query: { branchId: session.branchId } });
      if (res.status !== 200) throw new Error('Failed to load sales');
      return res.body;
    }
  });

  const settleFullCash = useMutation({
    mutationFn: async (invoice: { id: string; grandTotal: number; paidTotal: number; invoiceNo: string }) => {
      const pending = Number(invoice.grandTotal) - Number(invoice.paidTotal);
      if (pending <= 0) {
        throw new Error(`Invoice ${invoice.invoiceNo} is already fully paid`);
      }

      const res = await api.sales.settle({
        params: { id: invoice.id },
        body: { payments: [{ mode: 'CASH', amount: pending }] },
        extraHeaders: authHeaders()
      });

      if (res.status !== 200) throw new Error('Failed to settle invoice');
      return res.body;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['sales-module', session.branchId] });
    }
  });

  return (
    <section className="rounded-xl border border-slate-200 bg-white p-4">
      <h2 className="text-xl font-semibold">Sales</h2>
      <p className="mb-3 mt-1 text-sm text-slate-600">All drafts and partial invoices are listed here. Use settle to generate a receipt.</p>
      <div className="overflow-auto">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="border-b border-slate-200 text-left">
              <th className="p-2">Invoice</th>
              <th className="p-2">Status</th>
              <th className="p-2">Total</th>
              <th className="p-2">Paid</th>
              <th className="p-2">Pending</th>
              <th className="p-2">Action</th>
            </tr>
          </thead>
          <tbody>
            {sales.data?.map((invoice) => {
              const pending = Number(invoice.grandTotal) - Number(invoice.paidTotal);
              return (
                <tr className="border-b border-slate-100" key={invoice.id}>
                  <td className="p-2">{invoice.invoiceNo}</td>
                  <td className="p-2">{invoice.status}</td>
                  <td className="p-2">{money(Number(invoice.grandTotal))}</td>
                  <td className="p-2">{money(Number(invoice.paidTotal))}</td>
                  <td className="p-2">{money(pending)}</td>
                  <td className="p-2">
                    <button
                      className="rounded-md bg-teal-700 px-2 py-1 text-xs font-semibold text-white disabled:bg-slate-400"
                      disabled={pending <= 0 || settleFullCash.isPending}
                      onClick={() => settleFullCash.mutate(invoice)}
                    >
                      Settle Cash
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {settleFullCash.error ? <p className="mt-2 text-sm text-red-700">{(settleFullCash.error as Error).message}</p> : null}
    </section>
  );
}

function ItemsPage() {
  requireSession();
  const queryClient = useQueryClient();
  const [form, setForm] = useState({ code: '', name: '', category: '', uom: 'PCS', sellPrice: '0', taxRate: '0' });

  const items = useQuery({
    queryKey: ['items-module'],
    queryFn: async () => {
      const res = await api.items.list({ query: { activeOnly: true } });
      if (res.status !== 200) throw new Error('Failed to fetch items');
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
      if (res.status !== 201) throw new Error('Failed to create item');
      return res.body;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['items-module'] });
      setForm({ code: '', name: '', category: '', uom: 'PCS', sellPrice: '0', taxRate: '0' });
    }
  });

  return (
    <section className="rounded-xl border border-slate-200 bg-white p-4">
      <h2 className="text-xl font-semibold">Items</h2>
      <form
        className="mb-3 mt-3 grid grid-cols-1 gap-2 md:grid-cols-3"
        onSubmit={(e) => {
          e.preventDefault();
          createItem.mutate();
        }}
      >
        <input className="rounded-lg border border-slate-300 px-3 py-2" placeholder="Code" value={form.code} onChange={(e) => setForm((s) => ({ ...s, code: e.target.value }))} />
        <input className="rounded-lg border border-slate-300 px-3 py-2" placeholder="Name" value={form.name} onChange={(e) => setForm((s) => ({ ...s, name: e.target.value }))} />
        <input
          className="rounded-lg border border-slate-300 px-3 py-2"
          placeholder="Category"
          value={form.category}
          onChange={(e) => setForm((s) => ({ ...s, category: e.target.value }))}
        />
        <input className="rounded-lg border border-slate-300 px-3 py-2" placeholder="UOM" value={form.uom} onChange={(e) => setForm((s) => ({ ...s, uom: e.target.value }))} />
        <input
          className="rounded-lg border border-slate-300 px-3 py-2"
          placeholder="Price"
          type="number"
          value={form.sellPrice}
          onChange={(e) => setForm((s) => ({ ...s, sellPrice: e.target.value }))}
        />
        <input
          className="rounded-lg border border-slate-300 px-3 py-2"
          placeholder="Tax %"
          type="number"
          value={form.taxRate}
          onChange={(e) => setForm((s) => ({ ...s, taxRate: e.target.value }))}
        />
        <button className="rounded-lg bg-teal-700 px-3 py-2 font-semibold text-white md:col-span-3" type="submit">
          Create Item
        </button>
      </form>
      <div className="overflow-auto">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="border-b border-slate-200 text-left">
              <th className="p-2">Code</th>
              <th className="p-2">Name</th>
              <th className="p-2">Price</th>
              <th className="p-2">Tax%</th>
            </tr>
          </thead>
          <tbody>
            {items.data?.map((item) => (
              <tr className="border-b border-slate-100" key={item.id}>
                <td className="p-2">{item.code}</td>
                <td className="p-2">{item.name}</td>
                <td className="p-2">{item.sellPrice}</td>
                <td className="p-2">{item.taxRate}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
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
      if (res.status !== 200) throw new Error('Failed to fetch customers');
      return res.body;
    }
  });

  const createCustomer = useMutation({
    mutationFn: async () => {
      const res = await api.customers.create({
        body: { branchId: session.branchId, name, phone: phone || undefined },
        extraHeaders: authHeaders()
      });
      if (res.status !== 201) throw new Error('Failed to create customer');
      return res.body;
    },
    onSuccess: () => {
      setName('');
      setPhone('');
      queryClient.invalidateQueries({ queryKey: ['customers-module', session.branchId] });
    }
  });

  return (
    <section className="rounded-xl border border-slate-200 bg-white p-4">
      <h2 className="text-xl font-semibold">Customers</h2>
      <form
        className="mb-3 mt-3 grid grid-cols-1 gap-2 md:grid-cols-3"
        onSubmit={(e) => {
          e.preventDefault();
          createCustomer.mutate();
        }}
      >
        <input className="rounded-lg border border-slate-300 px-3 py-2" placeholder="Customer name" value={name} onChange={(e) => setName(e.target.value)} />
        <input className="rounded-lg border border-slate-300 px-3 py-2" placeholder="Phone" value={phone} onChange={(e) => setPhone(e.target.value)} />
        <button className="rounded-lg bg-teal-700 px-3 py-2 font-semibold text-white" type="submit">
          Create Customer
        </button>
      </form>
      <div className="overflow-auto">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="border-b border-slate-200 text-left">
              <th className="p-2">Code</th>
              <th className="p-2">Name</th>
              <th className="p-2">Walk In</th>
            </tr>
          </thead>
          <tbody>
            {customers.data?.map((customer) => (
              <tr className="border-b border-slate-100" key={customer.id}>
                <td className="p-2">{customer.code}</td>
                <td className="p-2">{customer.name}</td>
                <td className="p-2">{customer.isWalkIn ? 'Yes' : 'No'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
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
      if (res.status !== 200) throw new Error('Failed to fetch stock');
      return res.body;
    }
  });

  const opening = useMutation({
    mutationFn: async () => {
      const res = await api.stock.opening({
        body: { branchId: session.branchId, itemId, qty: Number(qty), reason },
        extraHeaders: authHeaders()
      });
      if (res.status !== 201) throw new Error('Failed to post opening');
      return res.body;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['stock-module', session.branchId] })
  });

  return (
    <section className="rounded-xl border border-slate-200 bg-white p-4">
      <h2 className="text-xl font-semibold">Stock</h2>
      <form
        className="mb-3 mt-3 grid grid-cols-1 gap-2 md:grid-cols-4"
        onSubmit={(e) => {
          e.preventDefault();
          opening.mutate();
        }}
      >
        <input className="rounded-lg border border-slate-300 px-3 py-2" value={itemId} onChange={(e) => setItemId(e.target.value)} placeholder="Item ID/Code" />
        <input className="rounded-lg border border-slate-300 px-3 py-2" value={qty} onChange={(e) => setQty(e.target.value)} type="number" placeholder="Qty" />
        <input className="rounded-lg border border-slate-300 px-3 py-2" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Reason" />
        <button className="rounded-lg bg-teal-700 px-3 py-2 font-semibold text-white" type="submit">
          Add Opening
        </button>
      </form>
      <div className="overflow-auto">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="border-b border-slate-200 text-left">
              <th className="p-2">Item ID</th>
              <th className="p-2">On Hand</th>
            </tr>
          </thead>
          <tbody>
            {onHand.data?.map((row) => (
              <tr className="border-b border-slate-100" key={row.itemId}>
                <td className="p-2">{row.itemId}</td>
                <td className="p-2">{row.onHand}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function ReceiptsPage() {
  requireSession();
  const [invoiceId, setInvoiceId] = useState('');

  const receipt = useQuery({
    queryKey: ['receiptByInvoice', invoiceId],
    enabled: !!invoiceId,
    queryFn: async () => {
      const res = await api.receipts.getByInvoice({ params: { invoiceId } });
      if (res.status !== 200) throw new Error('Receipt not found');
      return res.body;
    }
  });

  return (
    <section className="rounded-xl border border-slate-200 bg-white p-4">
      <h2 className="text-xl font-semibold">Receipts</h2>
      <input
        className="mt-3 w-full rounded-lg border border-slate-300 px-3 py-2 md:max-w-md"
        placeholder="Invoice ID or Invoice No"
        value={invoiceId}
        onChange={(e) => setInvoiceId(e.target.value)}
      />
      {receipt.data ? (
        <article className="mt-3 max-w-md rounded-lg border border-dashed border-slate-400 p-3">
          <p>
            Receipt No: <strong>{receipt.data.receiptNo}</strong>
          </p>
          <p>Invoice ID: {receipt.data.invoiceId}</p>
          <p>Amount: {receipt.data.amount}</p>
          <p>Date: {new Date(receipt.data.createdAt).toLocaleString()}</p>
        </article>
      ) : null}
    </section>
  );
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

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router;
  }
}
