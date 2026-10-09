# hackd

Every hackd product in one repository. Each product lives in its own folder under `apps/`, has
its own CI workflow that runs only when that product changes, and deploys on its own. They meet in
three places: code they share (`packages/`), the API gateway in front of them all
(`https://api.hackd.in/v1/<product>`), and the checkout service that takes payments for every one
of them.

## Products

| Folder | What | API |
| --- | --- | --- |
| `apps/pos` | Point of Sale: desktop app (offline or online), web app and the online server. See [`apps/pos/README.md`](apps/pos/README.md). | `/v1/pos` |
| `apps/checkout` | Checkout: payments for every product, with one payment provider and one payer's page. See [`apps/checkout/README.md`](apps/checkout/README.md). | `/v1/checkout` |

## Layout

```
apps/<product>/<app>     a product's apps and its own libraries (apps/pos/api, apps/pos/web,
                         apps/pos/contracts…); nothing outside the product imports them
packages/<name>          code more than one product uses (packages/checkout-contracts)
deploy/<product>/        how a product runs on the server (service, deploy script, nginx)
deploy/gateway/          the API gateway in front of every product
.github/workflows/       one workflow per product (pos.yml, checkout.yml), plus releases
```

Shared by everything: the root `package.json` (pnpm, TypeScript, ESLint, Turborepo),
`tsconfig.base.json`, `eslint.config.mjs` and `pnpm-lock.yaml`.

## Working in it

Needs Node 22.12 or later, pnpm 9 and PostgreSQL.

```bash
pnpm install                                   # every product
pnpm --filter "./apps/pos/*" test              # one product's packages
pnpm --filter @hackd/checkout-api dev          # one app
pnpm --filter "@pos/api..." build              # an app and everything it uses
pnpm lint                                      # everything; or: pnpm exec eslint apps/pos
```

Each product's README has its own setup. Package names say whose they are: `@pos/…` for the POS,
`@hackd/…` for the checkout service and shared packages.

## CI: each product on its own

A pull request runs a product's workflow only when it changes something that product is built
from (each workflow's `paths`):
- the product's folder (`apps/pos/**` runs `pos.yml`, `apps/checkout/**` runs `checkout.yml`);
- a shared package it uses (`packages/checkout-contracts/**` runs both);
- the workspace's own setup: root `package.json`, `pnpm-lock.yaml`, `pnpm-workspace.yaml`,
  `tsconfig.base.json`, `eslint.config.mjs`, `turbo.json` (these run every product's, as a
  dependency change can break any of them);
- its own workflow file.

Changes to Markdown alone, or to `deploy/`, run none. If branch protection requires a check, add
each product's check (`POS / check`, `Checkout / check`) and allow it to be skipped: GitHub
treats a workflow that didn't run because of `paths` as pending, which would hold up pull
requests for other products.

## Adding a product

1. **Its folder:** `apps/<product>/<app>` (e.g. `apps/inventory/api`), with a `package.json`
   named `@hackd/<product>-<app>` and a `tsconfig.json` that extends `../../../tsconfig.base.json`.
   `pnpm install` picks it up (`pnpm-workspace.yaml` lists `apps/*/*`). The checkout service is
   a small, complete example: NestJS, Prisma, tests against PostgreSQL.
2. **Its own database client:** with Prisma, give the schema's generator its own `output`
   (`../node_modules/.prisma/<product>-client`, as `apps/checkout/api/prisma/schema.prisma`
   does). `@prisma/client` is one copy shared by the workspace, so two products generating into
   its default place overwrite each other.
3. **Its CI:** copy `.github/workflows/checkout.yml` to `<product>.yml` and change the paths, the
   filters and the database name. List every shared package it uses in its `paths`, and add the
   new product to the `paths` of shared packages' other users only if they use what it adds.
4. **Shared code** goes in `packages/<name>` (`@hackd/<name>`), never imported from another
   product's folder.
5. **On the server:** `deploy/<product>/` with its systemd unit and deploy script (copy
   `deploy/checkout/`), and an `upstream` and `location` in `deploy/gateway/nginx-api-gateway.conf`.
6. **Taking payments:** add it to the checkout service's `CHECKOUT_PRODUCTS` with its own API key,
   notify secret and notify URL (`apps/checkout/README.md`), and use `packages/checkout-contracts`
   to start sessions and check notices, as `apps/pos/api/src/billing/checkout-gateway.ts` does.

## The server

Every product runs on one VPS (Oracle Cloud, Ubuntu 24.04) from one checkout of this repository
at `/opt/pos` (its name from before it held more than the POS). Each product's service listens on
its own local port, nginx's API gateway puts them under `https://api.hackd.in/v1/<product>`, and
each deploys with its own script:

```bash
/opt/pos/deploy/pos/deploy.sh         # the POS (apps/pos/README.md, "Hosting the online server")
/opt/pos/deploy/checkout/deploy.sh    # the checkout service (apps/checkout/README.md)
```

### One API gateway for every product
One domain carries every product's API under its own path: `https://api.example.com/v1/pos`,
`/v1/checkout`, `/v1/auth`, `/v1/inventory`, and so on. `deploy/gateway/nginx-api-gateway.conf`
does this. Each product's service runs on its own local port; the gateway strips the path before
passing a request on, so a service never needs to know its prefix. A new product is one
`upstream` and one `location` in that file.

What the gateway does for the POS API:
- It sends `X-Forwarded-Proto`, which the sign-in cookie needs to be `Secure`.
- It keeps the POS sign-in cookie to `/v1/pos/`, so the other services never receive it.
- It allows business imports up to 2 GB.
- It leaves CORS to the API (`CORS_ORIGINS`). For the other products, the gateway answers CORS
  for any `https://` page on the domain.

1. **The snippets and the site:**
   ```bash
   sudo cp /opt/pos/deploy/gateway/nginx-gateway-proxy.conf /etc/nginx/snippets/gateway-proxy.conf
   sudo cp /opt/pos/deploy/gateway/nginx-gateway-cors.conf /etc/nginx/snippets/gateway-cors.conf
   # e.g. gateway api.hackd.in, domain hackd.in. The CORS pattern needs the domain with \. for dots.
   sudo sed -e 's/api\.example\.com/api.hackd.in/g' -e 's/example\\\.com/hackd\\.in/g' \
     -e 's/example\.com/hackd.in/g' \
     /opt/pos/deploy/gateway/nginx-api-gateway.conf | sudo tee /etc/nginx/sites-available/api-gateway > /dev/null
   sudo ln -sf /etc/nginx/sites-available/api-gateway /etc/nginx/sites-enabled/api-gateway
   sudo nginx -t && sudo systemctl reload nginx
   ```
   Check that the certificate paths match yours (`ls /etc/letsencrypt/live/`), and the upstream
   ports your services: the POS API on 3001 (`deploy/pos/pos-api.service`), the checkout service
   on 8004 (`deploy/checkout/checkout-api.service`). `https://<gateway domain>/v1/pos/meta` and
   `/v1/checkout/meta` now answer JSON.
2. **Keep the old POS domain working.** Installed desktop apps keep the server address they were
   set up with, and their fallback counters are tied to it. Leave `deploy/pos/nginx-pos.conf` in
   place: both domains reach the same API.
3. **New installs and the web app** use `https://api.hackd.in/v1/pos`. The desktop app's
   `"posServerUrl"` (`apps/pos/desktop/package.json`) already names it. On the server:
   - Set `VITE_API_BASE_URL=https://api.hackd.in/v1/pos` in `/opt/pos/apps/pos/web/.env`, then
     `deploy/pos/deploy.sh` to rebuild the web app.
   - Install the web app's nginx file again ("The web app in a browser", step 5, in
     `apps/pos/README.md`), with `api.hackd.in` as the API gateway domain, so its CSP lets the
     page reach the gateway.
   - Keep the web app's domain in the POS API's `CORS_ORIGINS`.
4. **Payments** go through the checkout service at `/v1/checkout`. The payment provider's
   webhooks point at it (e.g. `https://api.hackd.in/v1/checkout/webhooks/razorpay`), never at a
   product.
