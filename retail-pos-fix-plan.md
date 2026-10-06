# Retail POS fixes

## Scope and order

Address the priority correctness findings from `retail-pos-review.md` first. Broader additions such as promotions, stocktake, purchase orders and loyalty remain follow-up work.

1. **Payment retries:** add durable settlement operation IDs and request fingerprints, return the same receipt for a retry, reject reuse with another request, and retain pending operation IDs in the browser.
2. **Return rounding:** reverse invoice round-off proportionally as goods are returned; the final return consumes the remaining adjustment. Preserve GST line amounts and reconcile paid, partial-credit and unpaid bills. Show the same amount in the return screen and documents.
3. **Offline inventory:** copy batches, branch batch quantities and variant groups. Preserve actual batch movements on sync, validate their ownership and expiry, and keep expired stock blocked when negative stock is allowed.
4. **Offline register cash:** carry the snapshot's register totals as a baseline, exclude copied refunds from new movements, and recompute register closing totals on the server after sync.
5. **Fallback cancellation:** verify the existing HTTP restriction and correct the audit. Keep cancellation unavailable during fallback until a complete cancellation sync workflow is introduced.
6. **Unregistered shops:** introduce explicit unregistered tax/document behavior, expose it in setup/settings, enforce registered seller details, and preserve historical documents. Review default/migration behavior before applying a migration.
7. **Verification and release:** run focused regressions, contracts/web/API checks and builds. Document database migration and minimum-client-version requirements. Verify compatibility of offline exports and retries.

## Verification targets

- Lost response and concurrent retries create one payment and one receipt, including wallet/overpayment behavior.
- Full and repeated partial returns of rounded-up/down bills reverse exactly the amount billed; GST is reversed only from the original lines.
- Expired batches cannot sell online or offline, including when negative stock is allowed.
- Batch returns and variant catalog reads work after loading a fallback snapshot; repeated sync does not move stock twice.
- Online cash activity followed by an outage and offline close yields the same expected drawer cash after sync.
- HTTP cancellation in fallback answers the existing fallback restriction and changes neither invoice nor stock.
- Unregistered shops charge no GST and print ordinary invoices; registered shops retain GST behavior and historical registration snapshots.

## Status

- [x] Rechecked priority findings against request middleware.
- [x] Payment retries.
- [x] Return rounding.
- [x] Offline inventory.
- [x] Offline register cash.
- [x] Fallback cancellation regression and audit correction.
- [x] Unregistered-shop behavior.
- [x] Verification and release notes.

## Implemented behavior

| Area | Changes |
| --- | --- |
| Settlement retries | `/sales/:id/settle` requires a UUID operation ID. Transactions serialize that ID, persist a request fingerprint on the receipt, and replay the original receipt without adding payments or wallet movements. Changed requests cannot reuse an ID. The web app saves pending IDs before sending and retains them across reloads and uncertain responses. |
| Rounded returns | Return documents store their share of the original invoice round-off. Cumulative allocation makes the final return consume the remaining adjustment, while preserving original GST components. Paid, partly paid and unpaid bills reconcile. The screen, printed documents, reports and CSV exports include the adjustment. |
| Offline inventory | Snapshots carry item groups, batches, branch batch quantities and copied invoice/return stock provenance. Sync preserves the selected batches, validates ownership and sale-time expiry, and applies stock changes once. Conflicting batch shortages require reconciliation. Negative-stock permission cannot substitute expired goods for available stock. The obsolete server reassignment helper was removed. |
| Offline drawer | A consistent snapshot stores existing register cash, card and UPI totals. Local calculations add new transactions without counting copied refunds again. Sync recomputes expected cash and differences from the server's ledgers, keeping the cashier's actual count. |
| Fallback cancellation | An HTTP regression confirms the existing `403 FALLBACK_UNAVAILABLE` restriction, with no invoice or stock change. |
| Registration | Setup and settings support `UNREGISTERED`, ordinary invoices and zero collected GST without changing item tax classifications. Regular and composition sales require a seller GSTIN. Existing document snapshots and historical defaults remain intact. CLI-created shops start unregistered. |
| Report dates | Verification exposed raw SQL date comparisons that depended on PostgreSQL's timezone. Summary and detailed reports now compare explicit UTC bounds with UTC timestamp columns. |

## Verification results — 6 October 2026

- Complete API suite: **356 tests passed across 65 files**, using an isolated PostgreSQL database. The database ran in `Asia/Kolkata`, exercising report comparisons with a non-UTC server timezone.
- Shared contracts: **173 tests passed across 12 files**, including randomized pricing/return invariants, setup registration rules and receipt rendering.
- Web: **34 tests passed across 5 files**, including settlement storage, uncertain outcomes, reloads and retry identity retention.
- API, web and desktop TypeScript checks passed. Repository ESLint and `git diff --check` passed.
- Shared packages, API and web production builds passed. Vite reports the existing large main-bundle warning; bundle splitting remains a performance follow-up.
- The API suite exercised new-schema provisioning, all-tenant migrations, backup restoration through migrations, fallback snapshot/sync, concurrent settlements, wallet effects and rounded returns. Production data was not touched.
- Packaged desktop installation, browser end-to-end workflows and physical scanner/printer checks have not been performed in this change set; retain those release checks below.

## Release procedure

These changes have been applied and tested locally. No production database was migrated and no release was deployed.

1. **Finish and sync existing fallback outboxes before upgrading.** Save a backup and retain any exported outbox files. Outbox sync requires an exact schema-version match; an old pending outbox cannot simply be sent to the migrated server.
2. Back up the hosted businesses and local installations. Include these four migrations in the release:
   - `20261022100000_settlement_retry_identity`
   - `20261022110000_return_round_off`
   - `20261022120000_fallback_register_baseline`
   - `20261022130000_unregistered_taxpayer`
3. The product version is now `0.1.6` (root package, desktop package and `APP_VERSION`). Release it through a pull request so CI, including the browser end-to-end job, runs before it reaches main; it has not been tagged or packaged yet.
4. Deploy the rebuilt API and run `node dist/tenancy/cli.js migrate` from `apps/api`, using the deployment's existing environment, before starting the new API. This migrates control and all business schemas. Local desktop installations use their existing startup migration process.
5. Ship the corresponding web/desktop clients and set `MIN_CLIENT_VERSION=0.1.6` in the API deployment's environment. Settlement callers now need `idempotencyKey`; custom integrations must retain it until the payment is confirmed. Reload browser clients and refresh fallback snapshots after the upgrade.
6. Existing shops without a GSTIN that still have the legacy regular classification can't bill until the owner enters the GSTIN or chooses Unregistered in Settings. Every screen shows a notice naming the branches without a GSTIN (cashiers see it for their own branch), with a link to Settings for admins. Fallback counters can't change settings, so resolve this while online and refresh fallback snapshots afterwards. Switching to Regular or Composition is refused while no branch has a GSTIN. The migration does not reclassify existing businesses or rewrite historical invoices.
7. Smoke-test a packaged desktop with the shop's scanner and printer; exercise an outage, reconnect, drawer close and restore on a spare installation before the pilot.

### Historical data and remaining scope

- Historical receipts retain nullable retry fields; only new settlements receive operation identities. Checkout retains its existing separate idempotency mechanism.
- Historical returns keep their original amounts and start with zero stored reversed round-off. A later return allocates any remaining original adjustment. Already completed historical returns are not rewritten; a legacy partial return that would make a subsequent return negative requires manual reconciliation.
- Replay returns the original receipt and the current invoice state. It still requires an authorized session and the normal register access.
- Follow-up work from the review remains: return disposition/exchanges, duplicate supplier-invoice protection, request idempotency for other money operations, consistent drawer payouts, historical business identity, stocktake, promotions and payment reconciliation. These are separate phases after the correctness fixes.

## Audit correction

The original cancellation finding missed `configureApp`'s fallback middleware: its write allowlist excludes cancellation. The verifier rejects a manually constructed cancelled outbox, but normal API clients cannot produce that outbox by cancelling a bill. Treat this as an existing product restriction to cover with a regression, not an exposed cancellation/sync bug.
