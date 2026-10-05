import type { api } from "../../lib/api";

// Shapes used by the Customers screen and its parts.

export type Customer = Extract<Awaited<ReturnType<typeof api.customers.list>>, { status: 200 }>["body"][number];
export type AccountSummary = Extract<Awaited<ReturnType<typeof api.customers.account>>, { status: 200 }>["body"];
export type Wallet = Extract<Awaited<ReturnType<typeof api.customers.getWallet>>, { status: 200 }>["body"];
export type OwedRow = Extract<Awaited<ReturnType<typeof api.customers.ageing>>, { status: 200 }>["body"]["rows"][number];
