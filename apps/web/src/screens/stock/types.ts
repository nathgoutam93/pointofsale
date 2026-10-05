import type { api } from "../../lib/api";

// Shapes used by the Stock screen and its parts.

export type StockModalType = "opening" | "adjustment" | null;

export type StockItem = Extract<Awaited<ReturnType<typeof api.items.list>>, { status: 200 }>["body"][number];
export type LedgerEntry = Extract<Awaited<ReturnType<typeof api.stock.ledger>>, { status: 200 }>["body"][number];
