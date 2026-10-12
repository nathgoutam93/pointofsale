# Checkout

One checkout for every hackd product. A product asks it for a payment, the payer pays on its page,
and it tells the product what happened. The payment provider (Razorpay, when it's added), its keys
and its webhooks live here only, so a new product takes payments without touching any of that,
and changing provider changes no product.

- `apps/checkout/api` (`@hackd/checkout-api`): the service. NestJS, Prisma and its own PostgreSQL
  database, on port 8004 behind the API gateway at `https://api.hackd.in/v1/checkout`.
- `packages/checkout-contracts` (`@hackd/checkout-contracts`): what products and the service send
  each other, and the signatures. Both sides import it, so a change to it is checked against both
  in the same pull request (it runs both workflows).

## How a payment goes

1. **The product starts it:** `POST /sessions` with `Authorization: Bearer <its API key>`:
   ```json
   { "reference": "<the product's own id>", "amount": 117882, "currency": "INR",
     "description": "Growth plan, 1 month", "customer": { "email": "owner@example.com" },
     "returnUrl": null, "metadata": { "businessCode": "H2F36D" } }
   ```
   Amounts are paise, taxes included. The answer is the session, with its `payUrl`
   (`https://api.hackd.in/v1/checkout/pay/ses_…`). The same reference again gives back the same
   session (a product retrying after a timeout), but not for another amount (409).
   `GET /sessions/<id>` reads it again (the product's own only).
2. **The payer pays:** the product sends them to `payUrl`, which goes on to the provider's page.
   An attempt that fails (a declined card) leaves the session open, so the payer can try again
   there, as Razorpay allows on one order.
3. **The provider tells the service:** `POST /webhooks/<provider>`, checked against the
   provider's signature, each event once. A payment counts only for an open session's full
   amount; any other money taken is kept to refund, with an alert (below).
4. **Or the session expires:** its link stops leading to the provider a day after it was made, and
   30 minutes later (for a payment already under way) it closes unpaid (`failed`). Paid and
   failed are final: the page takes no more payments, and the payer starts again from the product.
5. **The service tells the product how it ended**, once: `payment.succeeded` when paid, or
   `payment.failed` when it expired (`reason` says so, with the last attempt's failure if there
   was one). A `POST` of the notice to the product's notify URL:
   ```json
   { "id": "evt_…", "type": "payment.succeeded", "sessionId": "ses_…", "product": "pos",
     "reference": "<the product's id>", "amount": 117882, "currency": "INR", "reason": null,
     "metadata": { "businessCode": "H2F36D" }, "occurredAt": "2026-10-09T15:42:31.000Z" }
   ```
   signed in `X-Checkout-Signature: t=<unix time>,v1=<HMAC-SHA256 of "<t>.<body>">` with the
   product's notify secret. `verifyNotification` in the contracts package checks it, and refuses
   one more than 5 minutes old. Until the product answers 2xx it's sent again (after 30 s,
   doubling to at most 6 hours, 20 times in all) with the same `id`, so the product must count
   an `id` once. The POS does all this in `apps/pos/api/src/billing/checkout-gateway.ts`.

`GET /meta` says `{"service":"checkout","provider":"…"}`.

## Alerts

Some things only a person can fix, so the service emails `CHECKOUT_ALERT_EMAIL` about them:
- **Money to refund:** the provider took a payment that no session counted (it arrived after the
  session closed, for the wrong amount, or for a payment the service doesn't know). It's kept in
  the `UncountedPayment` table; refund it with the provider, then set its `refundedAt` (the email
  has the SQL).
- **A product that never took a notice:** after 20 attempts over about two and a half days, the
  product's record of that payment is out of date until someone acts (the email has the SQL to
  send it again).

Each alert is stored with what it's about before it's emailed, and sent again until it goes out,
so a mail server that's down only delays it. It's also in the log (`journalctl -u checkout-api`).
A real provider won't start without `CHECKOUT_ALERT_EMAIL` and a way to send it.

## Settings

In `apps/checkout/api/.env` (see `.env.example`):
- `DATABASE_URL`: its own database.
- `CHECKOUT_PUBLIC_URL`: its address as payers reach it, `https://api.hackd.in/v1/checkout`.
- `CHECKOUT_PROVIDER`: `dummy` for now (a test page with Pay and Fail buttons; no money moves).
  Anyone with a payment link can mark it paid there, so the dummy only runs with
  `CHECKOUT_ALLOW_TEST_PAYMENTS=true`: in development, never where real customers pay.
- `CHECKOUT_PRODUCTS`: the products, e.g. `pos`, each with
  `CHECKOUT_<PRODUCT>_API_KEY`, `CHECKOUT_<PRODUCT>_NOTIFY_SECRET` (at least 32 characters each)
  and `CHECKOUT_<PRODUCT>_NOTIFY_URL`. The product gets the same key and secret: for the POS,
  `CHECKOUT_API_KEY` and `CHECKOUT_NOTIFY_SECRET`, with `BILLING_GATEWAY=checkout` and
  `CHECKOUT_URL`.
- `CHECKOUT_ALERT_EMAIL`, `SMTP_URL` and `MAIL_FROM`: where alerts go and how (the POS's SMTP
  account works). `MAIL_TRANSPORT=log` prints them to the log instead, for development.
- `CHECKOUT_TIMER_SECONDS`: how often timed work runs (default 30): closing expired sessions,
  sending again the notices and alerts that didn't go out.

The service checks them all when it starts, and won't start without them.

## Running it

```bash
cp apps/checkout/api/.env.example apps/checkout/api/.env      # then fill it in: for development,
                                                               # CHECKOUT_PROVIDER=dummy, CHECKOUT_ALLOW_TEST_PAYMENTS=true,
                                                               # MAIL_TRANSPORT=log
pnpm --filter "@hackd/checkout-api^..." build                  # the contracts package
pnpm --filter @hackd/checkout-api prisma:generate
pnpm --filter @hackd/checkout-api prisma:migrate               # creates its tables
pnpm --filter @hackd/checkout-api dev
```

Tests start the real app against `checkout_test` (dropped and migrated at the start of each run;
PostgreSQL at `postgres:postgres@localhost:5432`, or set `CHECKOUT_TEST_DATABASE_URL`), with a
stand-in product that records the notices it's sent:

```bash
pnpm --filter @hackd/checkout-contracts --filter @hackd/checkout-api test
```

To try a payment end to end with the POS, run both with the same key and secret: the POS with
`POS_HOSTING=managed BILLING_GATEWAY=checkout CHECKOUT_URL=http://127.0.0.1:8004`, the service with
`CHECKOUT_POS_NOTIFY_URL=http://127.0.0.1:3001/billing/webhooks/checkout`. Paying from the POS's
Settings → Billing goes through the service's page and back.

## Running it on the server

On the same VPS as the POS, from the same checkout (`/opt/pos`):

1. **Its database:**
   ```bash
   cd /tmp
   sudo -u postgres psql -c "CREATE USER checkout WITH PASSWORD '<db-password>';"
   sudo -u postgres psql -c "CREATE DATABASE checkout OWNER checkout;"
   ```
2. **Its settings:** `cp apps/checkout/api/.env.example apps/checkout/api/.env`, then set
   `DATABASE_URL=postgresql://checkout:<db-password>@localhost:5432/checkout`, a new API key and
   notify secret for the POS, `CHECKOUT_PROVIDER` (a real one: the dummy refuses to start here
   unless test payments are allowed, and must not be), and `CHECKOUT_ALERT_EMAIL`, `SMTP_URL` and
   `MAIL_FROM`. Put the same key and secret in the POS's `.env` (`CHECKOUT_API_KEY`,
   `CHECKOUT_NOTIFY_SECRET`) with `CHECKOUT_URL=http://127.0.0.1:8004`; on the same server the
   two talk directly, not through the gateway.
3. **Its service:**
   ```bash
   sudo cp /opt/pos/deploy/checkout/checkout-api.service /etc/systemd/system/
   sudo systemctl daemon-reload && sudo systemctl enable checkout-api
   /opt/pos/deploy/checkout/deploy.sh      # builds, migrates, starts and waits for /meta
   ```
4. **The gateway** already sends `/v1/checkout/` to port 8004 (`deploy/gateway/nginx-api-gateway.conf`).
5. **Backups:** below. Set them up before real money moves through it.
6. **The POS** turns payments on with `BILLING_GATEWAY=checkout` in its `.env` and a restart (see
   "Before turning billing on" in `apps/pos/docs/remaining-work-plan.md`, item 14).

Deploy updates with `/opt/pos/deploy/checkout/deploy.sh`; it touches the checkout service only.

### Backups
`deploy/checkout/backup.sh` dumps the service's database with `pg_dump` into
`/var/backups/checkout` and deletes backups older than 30 days. Run it once by hand, then nightly
from cron, after the POS's (21:30 UTC):
```bash
sudo mkdir -p /var/backups/checkout && sudo chown ubuntu:ubuntu /var/backups/checkout
/opt/pos/deploy/checkout/backup.sh && ls -lh /var/backups/checkout
(crontab -l 2>/dev/null; echo "45 21 * * * /opt/pos/deploy/checkout/backup.sh >> /var/backups/checkout/backup.log 2>&1") | crontab -
```
Settings, in `.env` or the environment: `CHECKOUT_BACKUP_DIR` (default `/var/backups/checkout`),
`CHECKOUT_BACKUP_KEEP_DAYS` (default 30), and `CHECKOUT_BACKUP_RCLONE_REMOTE`: an rclone remote
such as `oci:checkout-backups` to copy each backup off the server. Backups that stay on the VPS
are lost with it, so set up the off-server copy.

Restore (practise on a scratch database first: `createdb -O checkout checkout_restore_test`):
```bash
sudo systemctl stop checkout-api
cd /tmp
sudo -u postgres psql -c "DROP DATABASE checkout;" -c "CREATE DATABASE checkout OWNER checkout;"
pg_restore --no-owner -d "postgresql://checkout:<db-password>@localhost:5432/checkout" /var/backups/checkout/db-<stamp>.dump
cd /opt/pos && pnpm --filter @hackd/checkout-api migrate && sudo systemctl start checkout-api
```
A restore loses what happened since the backup. Payments the provider took meanwhile come back
as its webhooks are retried or replayed from its dashboard; check the provider's list of payments
for the gap.

## Adding Razorpay

A class implementing `PaymentProvider` (`src/providers/payment-provider.ts`), like
`DummyProvider`: `createPayment` creates the order and answers its id and the page to send the
payer to; `parseWebhook` checks Razorpay's signature over the raw body and turns its events into
`payment.succeeded` (`payment.captured` or `order.paid`, with the order id as `providerRef`) and
`payment.failed` (one per failed attempt; the session stays open for the next). Stop Razorpay's
page by the session's `expiresAt` (Checkout's `timeout`), so a payment doesn't land after the
session closes. List it in `PROVIDERS` (`src/providers/providers.ts`), read its keys from the
environment, point Razorpay's webhook at `https://api.hackd.in/v1/checkout/webhooks/razorpay`,
and set `CHECKOUT_PROVIDER=razorpay`. No product changes. Automatic renewals (UPI AutoPay) arrive
the same way, as more payments.

## Not done yet

- **A real provider** (Razorpay, above).
- **Refunds through the provider's API:** money to refund is recorded and alerted (see Alerts),
  then refunded by hand in the provider's dashboard.
