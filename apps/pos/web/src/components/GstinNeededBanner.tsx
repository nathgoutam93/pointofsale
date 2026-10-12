import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { api, authHeaders } from "../lib/api";
import { getSession } from "../lib/session";

/**
 * A registered (regular or composition) business can't bill from a branch without a GSTIN.
 * Admins see every such branch and where to fix it: enter the GSTIN, or turn the business
 * Unregistered. Cashiers see it only for their own branch, and who to ask.
 */
export function GstinNeededBanner() {
  const session = getSession();
  const settings = useQuery({
    queryKey: ["business-settings"],
    queryFn: async () => {
      const res = await api.business.get({ extraHeaders: authHeaders() });
      if (res.status !== 200) throw new Error("Failed to load business settings");
      return res.body;
    },
    enabled: !!session,
  });
  if (!session || !settings.data) return null;
  const admin = session.role === "ADMIN";
  const missing = settings.data.branchesMissingGstin.filter((branch) => admin || branch.id === session.branchId);
  if (missing.length === 0) return null;

  const type = settings.data.taxpayerType === "COMPOSITION" ? "composition" : "regular";
  const where = admin ? missing.map((branch) => branch.name).join(", ") : "This branch";
  return (
    <div className="border-b border-rose-200 bg-rose-50 px-6 py-3 text-sm text-rose-900 print:hidden" role="alert">
      {where} {admin && missing.length > 1 ? "have" : "has"} no GSTIN, so {missing.length > 1 ? "they" : "it"} can't bill as a {type}{" "}
      GST business. Enter the GSTIN, or set the business to Unregistered (no GST on bills) to keep billing.
      {admin ? (
        <Link to="/settings" className="ml-2 font-semibold underline">
          Open Settings
        </Link>
      ) : (
        <span className="ml-1">Ask an admin to fix it under Settings.</span>
      )}
    </div>
  );
}
