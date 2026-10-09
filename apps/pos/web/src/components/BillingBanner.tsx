import { Link } from "@tanstack/react-router";
import { daysUntil, longDate, useBillingStatus } from "../lib/billing";
import { getSession } from "../lib/session";

/**
 * Managed hosting: the trial or the paid time ending soon (admins), ended and in its grace
 * period, or ended and read-only (everyone). Admins get a link to pay.
 */
export function BillingBanner() {
  const status = useBillingStatus().data;
  const admin = getSession()?.role === "ADMIN";
  if (!status?.enforced) return null;

  const payLink = admin ? (
    <Link to="/settings" search={{ tab: "billing" }} className="ml-2 font-semibold underline">
      {status.state === "trial" ? "Choose a plan" : "Pay now"}
    </Link>
  ) : (
    <span className="ml-1">Ask an admin to pay under Settings → Billing.</span>
  );

  if (status.state === "read_only") {
    return (
      <div className="border-b border-rose-200 bg-rose-50 px-6 py-3 text-sm text-rose-900 print:hidden" role="alert">
        The subscription has ended, so this business is read-only: sales and changes are off until it is paid. Everything is still here.
        {payLink}
      </div>
    );
  }
  if (status.state === "past_due" && status.endsAt && status.graceEndsAt) {
    return (
      <div className="border-b border-amber-200 bg-amber-50 px-6 py-3 text-sm text-amber-900 print:hidden" role="status">
        The subscription ended on {longDate(status.endsAt)}. Everything works until {longDate(status.graceEndsAt)}; then sales and
        changes stop until it is paid.
        {payLink}
      </div>
    );
  }
  if (admin && status.endsAt && daysUntil(status.endsAt) <= 3) {
    const days = daysUntil(status.endsAt);
    return (
      <div className="border-b border-amber-200 bg-amber-50 px-6 py-3 text-sm text-amber-900 print:hidden" role="status">
        The {status.state === "trial" ? "free trial" : "subscription"} ends{" "}
        {days === 0 ? "today" : `in ${days} day${days === 1 ? "" : "s"}`} ({longDate(status.endsAt)}).
        {payLink}
      </div>
    );
  }
  return null;
}
