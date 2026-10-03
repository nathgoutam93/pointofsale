import { useMutation } from "@tanstack/react-query";
import { FormEvent, useState } from "react";
import { api, apiErrorMessage, authHeaders } from "../lib/api";
import { useIsOffline } from "../lib/mode";
import { IconSend } from "./icons";
import { OnlineOnlyBadge } from "./OnlineOnly";

/**
 * Emails a sale's receipt to the customer. The server builds it from the invoice with the
 * branch's receipt layout. Online only: an offline install has no way to send email.
 */
export function EmailReceipt({ invoiceId }: { invoiceId: string }) {
  const offline = useIsOffline();
  const [email, setEmail] = useState("");
  const send = useMutation({
    mutationFn: async (to: string) => {
      const res = await api.sales.emailReceipt({ params: { id: invoiceId }, body: { email: to }, extraHeaders: authHeaders() });
      if (res.status !== 202) throw new Error(apiErrorMessage(res.body, "The receipt couldn't be sent."));
      return to;
    },
  });

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    send.mutate(email.trim());
  };

  return (
    <form onSubmit={onSubmit} className="print:hidden">
      <label className="field-label flex items-center gap-2" htmlFor={`email-receipt-${invoiceId}`}>
        Email the receipt
        {offline ? <OnlineOnlyBadge /> : null}
      </label>
      <div className="flex gap-2">
        <input
          id={`email-receipt-${invoiceId}`}
          className="field"
          type="email"
          placeholder="customer@example.com"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          disabled={offline || send.isPending}
          required
        />
        <button className="btn-secondary shrink-0" type="submit" disabled={offline || send.isPending} aria-label="Email the receipt">
          <IconSend width={16} height={16} />
          {send.isPending ? "Sending…" : "Send"}
        </button>
      </div>
      {offline ? (
        <p className="mt-1 text-xs text-slate-500">Emailing receipts needs the business online.</p>
      ) : send.isSuccess ? (
        <p className="mt-1 text-xs text-emerald-700" role="status">
          Sent to {send.data}.
        </p>
      ) : send.error ? (
        <p className="mt-1 text-xs text-rose-700" role="alert">
          {(send.error as Error).message}
        </p>
      ) : null}
    </form>
  );
}
