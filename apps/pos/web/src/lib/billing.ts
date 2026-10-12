import { useQuery } from '@tanstack/react-query';
import { api, API_BASE_URL, authHeaders } from './api';
import { desktop } from './desktop';
import { useIsManagedHosting } from './mode';
import { getSession } from './session';

/** Managed hosting, signed in: where the subscription stands (for the banner and Settings → Billing). */
export function useBillingStatus() {
  const managed = useIsManagedHosting();
  return useQuery({
    queryKey: ['billing-status'],
    queryFn: async () => {
      const res = await api.billing.status({ extraHeaders: authHeaders() });
      if (res.status !== 200) throw new Error('Failed to load the subscription');
      return res.body;
    },
    enabled: managed && !!getSession(),
    // A payment made in the browser shows when the person comes back to the app.
    refetchOnWindowFocus: true,
    staleTime: 60_000
  });
}

/** The payment page of a checkout (payPath on the API): the system browser from the desktop app, else a new tab. */
export async function openPayment(payPath: string) {
  if (desktop) {
    if (!desktop.openPayment) throw new Error('Update the app to pay from it.');
    await desktop.openPayment(payPath);
    return;
  }
  window.open(`${API_BASE_URL.replace(/\/$/, '')}${payPath}`, '_blank', 'noopener');
}

export const rupees = (paise: number) =>
  new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: paise % 100 ? 2 : 0 }).format(paise / 100);

/** In India's time, as our invoices and billing emails are. */
export const longDate = (iso: string | null) =>
  iso ? new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Asia/Kolkata' }) : '';

/** Whole days from now until `iso` (0 on the day itself). */
export const daysUntil = (iso: string) => Math.max(0, Math.ceil((new Date(iso).getTime() - Date.now()) / 86_400_000));
