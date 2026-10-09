import { useCallback, useState } from "react";
import { getSession } from "./session";

const KEY = "pos_managed_branch";

/**
 * The branch a management screen (inventory, customers, sales, purchases, transfers) shows.
 * Cashiers: their open register's. Admins: the one they last picked on any of these screens,
 * at first their register's (or their first branch).
 */
export function managedBranchId(): string | null {
  const session = getSession();
  if (!session) return null;
  if (session.role !== "ADMIN") return session.branchId;
  let picked: string | null = null;
  try {
    picked = localStorage.getItem(KEY);
  } catch {
    // Not remembered; fall back below.
  }
  if (picked && session.branches.some((branch) => branch.id === picked)) return picked;
  return session.branchId ?? session.branches[0]?.id ?? null;
}

/** [branch shown, pick another (admins)], shared across the management screens. */
export function useManagedBranch(): [string | null, (branchId: string) => void] {
  const [branchId, setBranchId] = useState(managedBranchId);
  const pick = useCallback((next: string) => {
    try {
      localStorage.setItem(KEY, next);
    } catch {
      // Still switches for this screen.
    }
    setBranchId(next);
  }, []);
  return [branchId, pick];
}
