# Point Of Sale (POS)

Monorepo POS system with multi-branch inventory + sales workflow.

## Stack
- Backend: NestJS + Prisma + PostgreSQL
- API contracts: ts-rest + zod
- Frontend: React + TanStack Router + TanStack Query + ts-rest client
- Monorepo: Turborepo + pnpm workspaces

## Apps and Packages
- `apps/api`: POS backend API
- `apps/web`: POS frontend
- `apps/desktop`: desktop app (Electron) that runs the web app, offline or online
- `packages/contracts`: Shared ts-rest API contracts
- `packages/types`: Shared domain enums/types

## Quick Start
Needs Node 22.12 or later and PostgreSQL.

1. Install dependencies:
```bash
pnpm install
```

2. Configure environment:
```bash
cp apps/api/.env.example apps/api/.env
cp apps/web/.env.example apps/web/.env
```
Set `AUTH_SECRET` in `apps/api/.env` (at least 32 characters; the file shows how to generate one). The API won't start without it.
For a quick local start set `POS_MODE=offline` too.

3. Generate the Prisma clients (business data and the hosted server's control schema):
```bash
pnpm --filter @pos/api prisma:generate
```
Then prepare the database for the mode you run (see **Businesses and the first admin**).

4. Build the shared packages, then run both apps:
```bash
pnpm --filter @pos/types --filter @pos/contracts build
pnpm dev
```

- Frontend: `http://localhost:3000`
- Backend: `http://localhost:3001`

## Businesses and the first admin
The API runs in one of two modes (`POS_MODE` in `apps/api/.env`):

- **`offline`**: one business on one computer, as the desktop app runs it. On first start the
  web app shows a setup screen that creates the business and its admin. This is also the simplest
  way to run the app locally.
- **`online`** (default): the hosted server, many businesses with one PostgreSQL schema each,
  listed in a `control` schema. Prepare the database and create a business:
  ```bash
  pnpm --filter @pos/api build
  pnpm --filter @pos/api migrate:all       # control schema + every business; run at every deploy
  pnpm --filter @pos/api business:create -- --name "My Shop" --admin admin --password <password> --code DEV
  ```
  Staff sign in with the business code, their username and password. Owners can also create
  businesses with `POST /businesses` (email and password for their owner account).
  `POS_HOSTING` says which kind of online server it is: `managed` on our hosted service,
  `self` (the default) on a business's own server. `GET /meta` reports it as `hosting`.

There are no default passwords; create cashiers from Settings → Cashiers & Access.

## Tests
```bash
pnpm test
```
- `packages/contracts`: unit tests for the shared pricing maths (tax, discounts, order-discount
  split, returns) and the receipt CSS sanitizer.
- `apps/api`: tests that start the real API against a separate database, `pos_test`, which is
  dropped and re-migrated at the start of every run (the setup refuses any database whose name
  doesn't contain `test`). They need PostgreSQL at `postgres:postgres@localhost:5432`, or set
  `TEST_DATABASE_URL`. They cover sign-in and tokens, branch isolation, validation, pricing and
  the cashier discount limit, settling and wallets, returns, stock under concurrency, checkout
  idempotency, reports, register balancing, customer sharing and time zones.

CI (`.github/workflows/ci.yml`) runs on every push and pull request: typecheck, the contracts
tests, the API tests against PostgreSQL 16, and a web app build.

## Local demo data
Run the API with `POS_MODE=offline` against the `pos_pr_auth_test` database
(`DATABASE_URL=…/pos_pr_auth_test?schema=public`, then `npx prisma migrate deploy` in
`apps/api`), finish the setup screen with an admin called `admin`, then run
`pnpm --filter @pos/api seed:demo` to populate the
isolated `pos_pr_auth_test` database with three branches, ten everyday products,
four GST scenario products, placeholder images, and 12 months of regular sales.
It also adds an earlier composition quarter and GST examples in the last completed
month: intra and inter-state B2C, B2CL, nil/exempt/non-GST supplies, returns and
credit notes, and a cancelled invoice. The GSTINs are synthetic demo identifiers;
the export is for software testing only. The seed refuses other database names and
can be rerun without duplicating sales. Sign in as `admin` to browse it (the seed writes
its three branches directly, past the one-branch limit of offline mode).

## Desktop app
`apps/desktop` packages the POS as a desktop app (Electron). On first launch the owner picks a
business type:
- **One shop, one billing counter:** works without internet. The app runs its own PostgreSQL and
  the API on this computer, and a setup screen creates the business and its admin.
- **More than one counter or branch:** connects to a hosted server (online mode).

Run it from source (Linux needs a desktop session; Postgres won't run as root):
```bash
pnpm build
pnpm --filter @pos/desktop start
```
Build an installer for the current OS (output in `apps/desktop/release/`):
```bash
pnpm --filter @pos/desktop dist
```
Releases: push a `v<version>` tag after setting the same version in `package.json`,
`apps/desktop/package.json` and `packages/contracts/src/version.ts`. The workflow publishes the
installers to GitHub Releases, and installed apps check there for updates every day.
Release order: deploy the server first, then publish the desktop release. When a release
changes the API or database in a way older apps can't handle, set `MIN_CLIENT_VERSION` on the
server: older desktop apps are then turned away (426), download the update and ask to restart.
Otherwise updates install when the app closes, and a note offers to restart sooner.
In offline mode the app backs up the business every day and before each update, keeping
the last 2–5 days (Settings → Backups, where admins can also restore). Backups can also be copied
to a second folder (a USB drive or a synced cloud folder). On a new computer, the welcome
screen's "Restore from a backup" brings a business back from a backup file. A forgotten admin
password is reset with the recovery code shown at setup ("Forgot your password?").
Each branch picks its receipt layout under Settings → Receipts, with a preview: the paper (58 or
80 mm, normal, small or large text), a layout (classic, detailed GST, compact columns or minimal)
and which parts print (logo, HSN codes, GST summary, savings, bill-number barcode and more). What a
GST bill needs always prints. The layout is `renderReceipt` in `packages/contracts`, so the POS,
Sales and Returns screens and the printer all print the same thing.
In either mode, each computer can have a receipt printer (Settings → Printer): receipts then
print in one click with no dialog, sized for the branch's paper (or this computer's, when its
printer takes other paper), and optionally as soon as a sale is paid. A cash drawer plugged into that printer opens (ESC/POS
drawer kick) when cash is taken or refunded. Without a printer, Print opens the system dialog
as in a browser. Code: `apps/desktop/src/printing.ts`, `apps/web/src/lib/printing.ts`. The app's
data and logs are in the OS's app-data folder under "Point of Sale". See
`desktop-offline-online-plan.md` for the design and what's left.

## Hosting the online server
How the hosted server (online mode) was set up on a VPS. It's one machine: PostgreSQL, the API
(a systemd service on `127.0.0.1:3001`) and nginx in front of it for HTTPS. The steps assume
Ubuntu 24.04 and a login user `ubuntu` (Oracle Cloud's default); replace `pos.example.com` with
the server's domain. The current server is `pos.hackd.in`, on Oracle Cloud.

1. **DNS:** an A record for the domain pointing at the VPS's public IP address. Set it first, as
   the HTTPS certificate (step 8) needs it.

2. **Software:**
   ```bash
   curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
   sudo apt update
   sudo apt install -y nodejs postgresql postgresql-contrib nginx certbot python3-certbot-nginx git
   sudo npm install -g pnpm@9.12.1        # the version in package.json's packageManager
   node -v                                # 22.12 or later
   ```

   On a small machine (1 GB of memory, such as Oracle's free one), add swap first: building the
   API needs about 450 MB, and without swap the server freezes while it builds.
   ```bash
   sudo fallocate -l 4G /swapfile && sudo chmod 600 /swapfile
   sudo mkswap /swapfile && sudo swapon /swapfile
   echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab   # keep it after a reboot
   free -h                                                       # Swap: 4.0Gi
   ```

3. **Firewall:** ports 80 and 443 must be reachable from the internet; otherwise certbot fails
   with a "connection" error.
   - In the provider's console: on Oracle Cloud, Instance → Subnet → Security List → Add Ingress
     Rules, TCP 80 and TCP 443 from `0.0.0.0/0`. Other providers call it a firewall or a
     security group.
   - Oracle's Ubuntu images also have iptables rules that reject everything but SSH (a `REJECT`
     line in `sudo iptables -L INPUT -n --line-numbers`). Allow 80 and 443 before that line and
     keep the rules across reboots:
     ```bash
     sudo iptables -I INPUT 5 -p tcp -m multiport --dports 80,443 -m state --state NEW -j ACCEPT
     sudo apt install -y iptables-persistent   # answer Yes to saving the rules
     sudo netfilter-persistent save
     ```
     (5 is the `REJECT` line's number; check yours.) Check it was saved, or a reboot brings back
     "connection refused": `grep 80,443 /etc/iptables/rules.v4`. ufw is left off.

4. **Database:** a user and a database for the API. Run from `/tmp`, as the `postgres` user
   can't enter your home folder. Use letters and digits in the password: it goes into a URL.
   ```bash
   cd /tmp
   sudo -u postgres psql -c "CREATE USER pos WITH PASSWORD '<db-password>';"
   sudo -u postgres psql -c "CREATE DATABASE pos OWNER pos;"
   ```

5. **Code and build:**
   ```bash
   sudo mkdir -p /opt/pos /var/lib/pos/uploads /var/backups/pos
   sudo chown ubuntu:ubuntu /opt/pos /var/lib/pos/uploads /var/backups/pos
   git clone -b fix/auth-hardening https://github.com/nathgoutam93/pointofsale.git /opt/pos
   cd /opt/pos && pnpm install --frozen-lockfile --filter "@pos/api..." --filter point-of-sale
   pnpm --filter @pos/types --filter @pos/contracts build
   pnpm --filter @pos/api prisma:generate
   pnpm --filter @pos/api build
   ```
   A private repository needs a GitHub token (or a deploy key) to clone.

6. **Settings**, in `/opt/pos/apps/api/.env` (git-ignored; the API and its CLI read it from
   their working folder). `apps/api/.env.example` explains every setting.
   ```bash
   cd /opt/pos/apps/api
   SECRET=$(node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))")
   cat > .env <<EOF
   POS_MODE=online
   POS_HOSTING=managed
   HOST=127.0.0.1
   PORT=3001
   DATABASE_URL=postgresql://pos:<db-password>@localhost:5432/pos?schema=public
   AUTH_SECRET=$SECRET
   UPLOADS_DIR=/var/lib/pos/uploads
   SESSION_COOKIE_SECURE=true
   OWNER_EMAIL_VERIFICATION=off
   EOF
   chmod 600 .env
   node dist/tenancy/cli.js migrate        # creates the control schema
   ```
   - Never change `AUTH_SECRET` afterwards: it would sign everyone out.
   - `POS_HOSTING=managed` marks our hosted service (sign-up and, later, subscriptions). The apps
     go by what `/meta` says, not by the domain, so leave it out on any other server: a
     business's own server is `self`, the default.
   - `OWNER_EMAIL_VERIFICATION=off` is only until email works. Then set `SMTP_URL` and
     `MAIL_FROM` (e.g. `MAIL_FROM="POS <no-reply@example.com>"`), remove that line and restart.
     Add the mail provider's SPF and DKIM records to the domain, or mail lands in spam.
   - Quick check: `node dist/main.js`, then `curl http://127.0.0.1:3001/meta` from a second
     terminal answers JSON. Stop it with Ctrl+C.

7. **Service:** `deploy/pos-api.service` runs `node dist/main.js` as `ubuntu`, starts it at boot
   and restarts it if it stops. Check `which node` matches its `ExecStart`.
   ```bash
   sudo cp /opt/pos/deploy/pos-api.service /etc/systemd/system/
   sudo systemctl daemon-reload
   sudo systemctl enable --now pos-api
   systemctl status pos-api --no-pager     # active (running)
   journalctl -u pos-api -f                # its log
   ```

8. **nginx and HTTPS:** `deploy/nginx-pos.conf` passes requests to the API with
   `X-Forwarded-Proto` (the sign-in cookie is `Secure` behind HTTPS), allows uploads up to 2 GB
   (business imports) and waits up to 10 minutes for them. certbot then adds the certificate to
   it and renews it by itself.
   ```bash
   sudo sed 's/pos\.example\.com/<your domain>/' /opt/pos/deploy/nginx-pos.conf | sudo tee /etc/nginx/sites-available/pos > /dev/null
   sudo ln -sf /etc/nginx/sites-available/pos /etc/nginx/sites-enabled/pos
   sudo rm -f /etc/nginx/sites-enabled/default
   sudo nginx -t && sudo systemctl reload nginx
   sudo certbot --nginx -d <your domain>
   sudo certbot renew --dry-run            # renewal works
   ```
   `https://<your domain>/meta` now answers JSON.

9. **Desktop apps:** on first launch choose the online option and enter `https://<your domain>`,
   or build the app with `"posServerUrl"` set to it in `apps/desktop/package.json`.

10. **Backups:** see below; set them up before a real shop uses the server.

11. **Monitoring:** an uptime check (UptimeRobot or similar) on `https://<your domain>/meta`.

### Deploying an update
On the server, as `ubuntu`:
```bash
/opt/pos/deploy/deploy.sh                 # the checked-out branch, or: deploy.sh <branch>
```
It pulls the branch, installs and builds, runs the migrations (control schema and every
business), restarts the service and waits for `/meta` to answer. Migrations always run before
the new API starts. Deploy the server before publishing a desktop release, and set
`MIN_CLIENT_VERSION` in `.env` when older apps can't work with the new server.

### Backups
`deploy/backup.sh` dumps the whole database (the control schema and every business's schema)
with `pg_dump` and archives `UPLOADS_DIR` (logos and item images) into `/var/backups/pos`, and
deletes backups older than 14 days. Run it once by hand, then nightly from cron (server time is
UTC; 21:30 UTC is 3:00 in India):
```bash
/opt/pos/deploy/backup.sh && ls -lh /var/backups/pos
(crontab -l 2>/dev/null; echo "30 21 * * * /opt/pos/deploy/backup.sh >> /var/backups/pos/backup.log 2>&1") | crontab -
```
Settings, in `.env` or the environment: `POS_BACKUP_DIR` (default `/var/backups/pos`),
`POS_BACKUP_KEEP_DAYS` (default 14), and `POS_BACKUP_RCLONE_REMOTE`: an rclone remote such as
`oci:pos-backups` to copy each backup off the server (install and `rclone config` it first).
Backups that stay on the VPS are lost with it, so set up the off-server copy.

Restore (practise this on a scratch database first):
```bash
cd /tmp
sudo -u postgres createdb -O pos pos_restore_test
pg_restore --no-owner -d "postgresql://pos:<db-password>@localhost:5432/pos_restore_test" /var/backups/pos/db-<stamp>.dump
```
For the real database, stop the API, re-create the database, restore it and the uploads, then
migrate and start:
```bash
sudo systemctl stop pos-api
cd /tmp
sudo -u postgres psql -c "DROP DATABASE pos;" -c "CREATE DATABASE pos OWNER pos;"
pg_restore --no-owner -d "postgresql://pos:<db-password>@localhost:5432/pos" /var/backups/pos/db-<stamp>.dump
sudo rm -rf /var/lib/pos/uploads && sudo tar -xzf /var/backups/pos/uploads-<stamp>.tar.gz -C /var/lib/pos
sudo chown -R ubuntu:ubuntu /var/lib/pos/uploads
cd /opt/pos/apps/api && node dist/tenancy/cli.js migrate
sudo systemctl start pos-api
```

## Subscriptions (managed hosting)
On our managed hosting (`POS_HOSTING=managed`) businesses pay a subscription. Nothing is charged
or enforced until a payment gateway is set (`BILLING_GATEWAY`), and never on a self-hosted server.
- **Plans:** `PLANS` in `packages/contracts/src/billing.ts` (prices in paise before GST, and the
  branches and active counters each allows; placeholders until pricing is decided), with the trial
  (14 days on Growth) and the grace period (7 days).
- **A business's state:** on trial, paid, past due (the trial or paid time has ended; everything
  works for the grace period) or read-only (changes refused with 402 until it pays; reading,
  sign-in, closing the register, a fallback counter's sync and paying still work). Owners get
  emails before the end, at the start of the grace period and when it turns read-only.
- **Paying:** Settings → Billing (admins) starts a checkout; the app opens `/billing/pay/<id>` on
  the server in the system browser, which sends it on to the gateway. A payment counts only from
  the gateway's signed webhook (`POST /billing/webhooks/<gateway>`), once per event, for the
  checkout's full amount. Paying for the current plan adds to the time already paid (after any
  trial); another plan starts at once, with paid time left carried over at the new plan's price.
- **Invoices:** one per payment, numbered per financial year (`POS/26-27/00001`), with the
  seller details from `BILLING_SELLER_*` (with a GSTIN: 18% GST, CGST and SGST or IGST by the
  buyer's state). Emailed to the owners and listed under Settings → Billing.
- **Trying it:** `POS_HOSTING=managed BILLING_GATEWAY=dummy` on a local online API. The dummy
  gateway's checkout page has buttons to pay or fail; no money moves.
- **A real gateway** (code in `apps/api/src/billing/`): write a class implementing
  `PaymentGateway` (`payment-gateway.ts`): `createCheckout` creates the payment with the
  gateway and answers its id and payment page, `parseWebhook` checks the gateway's signature over
  the raw body and turns its events into `payment.succeeded` or `payment.failed`. List it in
  `GATEWAYS` (`gateways.ts`), read its keys from the environment, and point the gateway's webhook
  at `https://<server>/billing/webhooks/<name>`. Nothing else changes.

## Auth Model
A sign-in is a token signed with `AUTH_SECRET` that expires after `AUTH_TOKEN_TTL_HOURS`
(default 12). Every request is re-checked against the database (user active, same role, branch
access, register still open, password not changed since). It travels in one of two ways:
- **The web app (browser and desktop):** an httpOnly cookie the API sets, which page scripts
  can't read. The app sends `x-pos-session: cookie` with every request, and only then does the
  API read the cookie (another site's form or link can't add that header), and it puts tokens
  in the cookie instead of the answer. `POST /auth/logout` clears it. The desktop app reaches
  the API through `app://pos/api`, which forwards to the local API or the online server and
  keeps the cookie in the app's own cookie store.
- **API clients and scripts:** `Authorization: Bearer <token>`, with the token from
  `/auth/login` (sent without the header above).

A browser deployment should serve the web app and API from the same site (for example
`pos.example.com` and `api.pos.example.com`, or one host with the API under a path) and list the
web app's origin in `CORS_ORIGINS`: only listed origins may send the cookie. Behind HTTPS the
cookie is `Secure` (set `SESSION_COOKIE_SECURE=true` if the proxy doesn't send
`X-Forwarded-Proto`).

Who may do what, where (`apps/api/src/common/access.service.ts`):
- **Selling** (POS checkout, returns, taking payments) happens at the branch of the open register.
- **Managing a branch** (inventory, customers, sales and returns history, branch settings,
  cashiers): admins manage any branch they have access to, with or without a register open, and
  pick it with the Branch selector on those screens. Cashiers see only their register's branch.
- **Cashier permissions** (Settings → Cashiers & Access, "Also allowed to"): adjust stock, manage
  items, record purchases, send transfers, top up wallets, cancel unpaid bills. Admins can always
  do all of these; a change applies from the cashier's next action.
- **Transfers:** anyone with access to the receiving branch receives a transfer; sending and
  calling one back need "Send transfers".

Returns on a bill not yet paid in full (a credit or part-paid sale) first lower what the customer
still owes; only the rest is refunded. A credit sale returned in full owes nothing and gets
nothing back. The register expects only the cash actually handed back, and the return receipt
shows both parts.

Fallback counter: on an online business, one counter per branch can keep selling on its own
computer when the server can't be reached (Settings → Counters → "Use as fallback here", in the
desktop app). That computer keeps an offline copy, refreshed every 10 minutes, with the item
pictures (each fetched once). Every online computer checks the server every 30 seconds, so when it
is down a banner says so before a sale fails, and on the fallback counter offers "Keep selling on
this computer" (cash and card only). When it's back, "Send offline sales and go back online" adds
the sales to the server, invoice numbers and stock included. If the server refuses them (a number
already used online, say), nothing is added: the banner lists each clash and can save the offline
sales to a file for support. A register the offline one replaced is closed with its expected cash
and shown as not counted. See Phase 7 in `desktop-offline-online-plan.md`.

Passwords:
- **Anyone** can change their own password (click your name at the top). Their other sessions end.
- **An admin** can give a cashier a new password (Settings → Cashiers & Access). By default the
  cashier must choose their own at next sign-in, and is signed out everywhere until then.
- **A forgotten admin password:** offline, the recovery code from setup resets it; online, the
  business's owner resets it with the owner account ("Forgot your password?" on sign-in).
- **A forgotten owner password** (online): an 8-digit code is emailed to the owner.

Email (online server: `SMTP_URL` and `MAIL_FROM`; `MAIL_TRANSPORT=log` prints emails in development):
- **Owner verification:** the first time an email address creates a business or moves one online,
  the server emails it a code and the app asks for it. A verified address isn't asked again.
  `OWNER_EMAIL_VERIFICATION=off` turns this off.
- **Owner notices:** the business code when a business is created or moved online, and a notice
  when the owner password changes. A failed notice is logged; it never stops what it reports.
- **Receipts:** "Email the receipt" on the POS (after a sale) and on Sales (any sale). The server
  builds it from the invoice with the branch's receipt layout, in the business's time zone; 30
  an hour per user. Offline it shows "Online only".

## Implemented Modules
- Customers + walk-in customer + wallet topup/balance
- Item master (create/list/update)
- Stock opening + adjustment + on-hand + ledger
- Sales invoice creation with tax/discount and stock deduction
- Split settlement (cash/card/wallet) with wallet debit and receipt creation
- Returns against original invoice with stock reversal and wallet refund support
- Receipt fetch by id or invoice
- Counters per branch (set up by admins in Settings → Branches): each counter runs its own register and cash drawer, so several cashiers can sell in a branch at once
- GST invoice and credit note numbers per counter: `{branch code}/{counter}/{YY}/{count}`, e.g. `MAI/1/26/00001` and credit notes `MAIR/1/26/00001` (branch codes are exactly 3 letters or digits; the count restarts every April)

## UI Flow
- If no active session: login screen is shown.
- If active session exists: app opens directly to `/pos`.
- POS is the primary screen with product grid (left) and order summary/customer/payment (right).
- Other modules are in the left sidebar (collapsible; a drawer on small screens).
