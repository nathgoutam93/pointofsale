import type { api } from "../../lib/api";

// Shapes used by the Stock screen and its parts.

export type StockModalType = "opening" | "adjustment" | null;

/** The batch stock comes in to or goes out of, for items kept by batch (as typed). */
export type BatchEntry = { batchNo: string; expiryDate: string };
export const emptyBatchEntry: BatchEntry = { batchNo: "", expiryDate: "" };

export type StockItem = Extract<Awaited<ReturnType<typeof api.items.list>>, { status: 200 }>["body"][number];
export type LedgerEntry = Extract<Awaited<ReturnType<typeof api.stock.ledger>>, { status: 200 }>["body"][number];
