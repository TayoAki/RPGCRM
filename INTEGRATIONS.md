# Integrations: what we need, how well the pieces fit, and the path to 8/10

**Date:** 2026-09-16
**Status:** every integration below runs against sample data in `agent/samples/`
today, behind a code seam that a real connector plugs into. The DTN BOL
connector is built and waiting on DTN's onboarding packet. Nothing here needs
a rewrite; it needs credentials, sample files from each vendor, and the
hardening steps in section 4.

Related: [README.md](./README.md) (how each sample is used),
[AUTH_PLAN.md](./AUTH_PLAN.md) (sign-in, now built through Phase 1),
[SAAS_AUDIT.md](./SAAS_AUDIT.md) (Postgres and tenancy).

---

## 1. Where each integration stands

| Integration | Today | Code seam | Connector status |
| --- | --- | --- | --- |
| Supplier electronic BOLs (DTN) | `agent/samples/bol-feed.json` | `BolSource` in `agent/src/integrations/bol/source.ts`; DTN connector in `dtn.ts` (HTTPS pull or directory drop, crosswalk in `agent/config/dtn-bol-map.json`) | **Built**, unconfigured: needs DTN's URL, key, and a real export to finish the crosswalk |
| Supplier rack prices | `agent/samples/rack-feed.json`, or the supplier's own sheet uploaded on the Pricing page | `importRackFeed(store, actor, now, postings?)` in `agent/src/services/pricing.ts`; `agent/src/pricing/rack-sheet.ts` turns CSV, Excel, PDF, or text sheets into postings; idempotent on a content-hash `postingRef` | **Built** for the free path (upload the daily sheet); a DTN or OPIS feed would be a further source |
| Market indexes (NYMEX, Gulf Coast pipeline, spot) | `agent/samples/index-feed.json`, or EIA daily spot prices | `IndexSource` in `agent/src/integrations/market/source.ts`; EIA connector in `eia.ts` with the crosswalk in `agent/config/eia-series.json` | **Built**, unconfigured: needs a free `EIA_API_KEY` (dry run: `scripts/check-eia.ts`) |
| Order inbox (email + attachments) | `agent/samples/emails.json` + `agent/samples/attachments/` | `runEmailIntake` in `agent/src/services/orders.ts` consumes `InboundEmail` records; `agent/src/intake/attachments.ts` parses CSV, XLSX, PDF, text | Seam ready; needs a mailbox connector |
| QuickBooks Online | `agent/samples/quickbooks-invoice-template.json`, `quickbooks-payments.json` | `syncInvoicesToQuickBooks` / `syncPaymentsFromQuickBooks` in `agent/src/services/billing.ts` call `agent/src/integrations/quickbooks/mock.ts` | Mock only; needs an Intuit app and sandbox company |
| Carriers (dispatch, delivery tickets) | manual status changes and delivery entry | `setLoadStatus`, `recordDelivery` in `agent/src/services/loads.ts` | Manual is acceptable for beta; API later |
| Customer portal accounts | built-in accounts (`portalUsers`) | `agent/src/services/portal.ts` | Built; invitations and password reset still open |
| Staff sign-in | built-in accounts (`staff`), sessions, gate | `agent/src/services/staffAuth.ts`, `frontend/proxy.ts` | Built (AUTH_PLAN Phase 1) |

The frontend never talks to a vendor: every connector runs inside the agent,
records an `integrationRuns` row (kind, counts, status, source, summary), and
the UI shows the last run per feed.

## 2. What we need from each vendor

Ask for these in the first email to each vendor; each item is what blocks the
connector from being switched on.

### 2.1 DTN (electronic BOLs)

| Need | Why |
| --- | --- |
| Which product RPG is on: DTN Fuel Suite / TABS BOL delivery over HTTPS, or scheduled file drops (SFTP) | Picks `DTN_BOL_MODE=https` or `directory` |
| Endpoint URL and API key (or SFTP host, user, key) | `DTN_BOL_URL`, `DTN_API_KEY`, or the folder the SFTP mirror writes to |
| One real export covering a week, CSV or JSON | Finishes `agent/config/dtn-bol-map.json`: column names, date format, supplier and terminal control numbers, carrier SCACs, product codes, consignee names |
| The list of terminals and suppliers RPG lifts from, with DTN's codes | Crosswalk values; anything unknown is reported as skipped, never silently dropped |
| Whether corrections and voids arrive as new records with the same BOL number | Decides how `dedupeHash` and the duplicate rule treat re-sent BOLs |
| Delivery cadence (real time, hourly batch, end of day) | Sets the pull schedule and the "missing BOL" exception timing |

Dry run before switching on: `cd agent && npx tsx scripts/check-dtn-file.ts <export>`.
Effort once the packet arrives: 1 to 2 days, mostly crosswalk values and one
scheduled pull.

### 2.2 Rack prices (supplier postings)

Options, in order of preference:

1. **DTN FastRacks / a rack price feed** (same vendor relationship): a daily
   file or API with supplier, terminal, product, effective time, price.
2. **Supplier portals** (Marathon, Valero, Motiva): most publish a daily rack
   sheet as email, PDF, or portal download; a small parser per supplier.
3. **OPIS rack** as an independent benchmark alongside the supplier postings.

| Need | Why |
| --- | --- |
| Sample daily posting per supplier, one week's worth | Maps to `RackFeedPosting` (`supplierCode`, `terminalCode`, `productCode`, `effectiveAt`, `pricePerGallon` or `move`, `postingRef`) |
| Product code list per supplier (ULSD, dyed, 87, 93, DEF) | Product crosswalk, same pattern as the DTN map |
| Whether intraday moves are posted | Whether the import runs once a day or on a schedule |

Effort: half a day per source once a sample is in hand; the import, idempotency,
and price recalculation already exist.

### 2.3 Market indexes

| Need | Why |
| --- | --- |
| A data license: CME Group (NYMEX ULSD, RBOB) via a redistributor, OPIS or Argus for Gulf Coast pipeline and spot, an ethanol assessment | Legal use of the numbers in customer pricing rules |
| The vendor's API credentials and symbol list | Maps symbols to `priceIndexes.code` |
| Settlement time and timezone | Which value is "today's" for `IndexPrice.date` |

Effort: one day for a REST vendor. The forecast and the stale-index exception
already work off the stored history.

### 2.4 Order inbox

| Need | Why |
| --- | --- |
| Which mailbox receives orders (`orders@…`) and its platform: Microsoft 365 (Graph API) or Google Workspace (Gmail API) | Picks the connector |
| An app registration with read access to that one mailbox (Graph `Mail.Read` on the shared mailbox, or a Gmail service account with domain-wide delegation) | Credentials |
| A label or folder convention for "processed" | Idempotency across restarts (`messageId` is already stored per intake) |
| 20 to 50 real order emails and attachments, anonymized if needed | Tunes the parser's customer, location, and product matching and the attachment header synonyms |

Effort: 2 to 3 days including the poll loop, retries, and moving processed
mail. Parsing improvements are ongoing and data-driven.

### 2.5 QuickBooks Online

| Need | Why |
| --- | --- |
| An Intuit developer account and app (OAuth 2.0 client id and secret) | API access |
| A sandbox company, then production company consent from RPG's QuickBooks admin | Testing without touching the books |
| Chart of accounts and item list: which QuickBooks items and accounts each product, freight, fee, and tax line posts to | Invoice line mapping; taxes as line items or as QuickBooks sales tax |
| Customer list export with QuickBooks customer ids | Fills `Customer.quickbooksCustomerId` |
| Payment terms and invoice numbering policy | Whether QuickBooks or the platform owns the number |

Effort: 3 to 5 days: OAuth with refresh tokens stored encrypted, invoice create,
payment query, error mapping, and a reconciliation report.

### 2.6 Carriers

| Need | Why |
| --- | --- |
| Per carrier: whether they have a dispatch API or TMS (many small fuel haulers do not) | Decides API vs. email/SMS dispatch |
| Delivery ticket format (paper, photo, PDF) | Delivery capture path (today: manual entry from the load drawer) |
| Lane rate sheets | `carrierRates` |

Effort: none required for beta (manual works); 2 days per carrier with an API.

### 2.7 Platform services (not vendors, but needed for a real beta)

| Need | Why |
| --- | --- |
| Transactional email (Postmark, SES, Resend) | Staff password reset, portal invitations, exception alerts |
| Error and uptime monitoring (Sentry; a health-check pinger) | Know before the customer does |
| Object storage (Railway bucket or S3) | Original BOL files, delivery ticket images, invoice PDFs |
| Backups of the SQLite volume, then Postgres (see SAAS_AUDIT.md) | Durability |

## 3. Interoperability assessment

How well the platform's pieces fit with each other and with outside systems,
scored 1 to 10.

| Area | Score | Why |
| --- | --- | --- |
| Normalized data shapes | 8 | One domain model (`agent/src/domain/types.ts`) shared with the UI by `sync-types`; every feed lands in the same `Bol`, `RackPrice`, `IndexPrice`, `EmailIntake` records regardless of source |
| Pluggable sources | 7.5 | BOLs (`BolSource`: sample, DTN) and market indexes (`IndexSource`: sample, EIA) have real interfaces; rack prices accept postings from the feed or an uploaded sheet; the mailbox and QuickBooks still read samples directly and need the same treatment |
| Idempotency | 8 | BOLs dedupe on a content hash, rack postings on `postingRef`, emails on `messageId`, index values on date; re-running any feed is safe |
| Crosswalks (vendor codes to ours) | 7 | Done for DTN in a config file with a dry-run tool; the same pattern is needed for supplier product codes and QuickBooks items |
| Run tracking and observability | 6 | Every feed records an `integrationRuns` row with counts, status, source, and skipped reasons; no alerting, no retry queue, no metrics endpoint |
| Inbound API | 6 | REST under `/ops` for everything the UI does, now behind staff sessions; no API keys for machine callers, no OpenAPI description, no rate limits |
| Outbound events | 3 | Nothing emits webhooks or events when an order, load, or invoice changes; another system has to poll `/ops` |
| Exports | 4 | The UI shows everything; there is no CSV export of orders, loads, margins, or invoices |
| Identity | 7 | Staff and portal accounts, sessions, roles, and audit attribution work; no SSO, no password reset email, no invitations |
| Deployment | 7 | Two Railway services from Dockerfiles, IaC in `.railway/railway.ts`, health checks on both; single region, one replica, SQLite on a volume |

Overall: **6.5/10**. The inside is consistent (one model, one service layer,
idempotent feeds, audit trail). The outside is thin: two connectors are real
interfaces, the rest are sample readers, and nothing flows out.

## 4. How to get every area to at least 8

Readiness areas from the MVP rating, with the current score, the target, and
the concrete work. Effort is for one engineer.

### 4.1 Staff security: 3 → 8 (Phase 1 done; now 7)

Done today: sign-in with scrypt-hashed passwords, server-side sessions in an
httpOnly cookie, a gate on every page, API route, and the agent endpoint,
lockout, password change, audit attribution to the signed-in user.

Remaining for 8 (2 to 3 days):

1. Password reset by email and admin-issued invitations (needs the
   transactional email provider in 2.7).
2. Admin screen: add, disable, and re-role staff; force a reset.
3. Security headers (CSP, HSTS, `frame-ancestors`) in `next.config.ts`;
   rate limit `/api/auth/login` per IP.
4. Move the lockout counter into the store so it survives restarts and
   multiple replicas.
5. Optional: Clerk or another provider for SSO and MFA. The seam is the
   `/api/auth/*` routes and the agent's `staffAuthGate`; the rest of the app
   only ever sees a verified `{ id, name, email, role }`.

### 4.2 Customer security: 7 → 8 (1 to 2 days)

1. Portal password reset and invitation email (same provider as above).
2. Invite from the Customers page; disable from the same place.
3. Per-account rate limit on `/api/portal/login`.

### 4.3 Data durability: 5 → 8 (2 to 4 days)

1. Nightly copy of `rpg.db` to object storage with 30-day retention, and a
   documented restore drill. SQLite's online backup API makes this one
   command; do it first.
2. Postgres behind the same `DocStore` interface (the SaaS audit's Phase 1),
   with Railway's managed Postgres and point-in-time recovery. The document
   store is one table, so the migration is a driver swap plus a data copy.
3. Keep original vendor files (BOL exports, emails, attachments) in object
   storage keyed by run id, so any import can be replayed.

### 4.4 Integrations: 5 → 8

1. **DTN live** (1 to 2 days once the packet arrives): finish the crosswalk
   from a real export, schedule the pull, watch the skipped list to zero.
2. **Rack prices from the supplier's sheet**: built. Staff upload the daily
   sheet on the Pricing page; a subscribed feed (DTN, OPIS) would be a further
   source behind `importRackFeed` (half a day per source).
3. **EIA market feed**: built. Register the free key, dry-run
   `scripts/check-eia.ts`, set `EIA_API_KEY`.
4. **Mailbox connector** (2 to 3 days): Graph or Gmail poll into the existing
   intake, processed-folder convention, retry on transient errors.
5. **QuickBooks sandbox** (3 to 5 days): OAuth, invoice create, payment pull,
   reconciliation report, then production consent.
6. **Same interface for the remaining feeds** (half a day): `MailSource` and
   `LedgerClient` like `BolSource` and `IndexSource`, each with a sample
   implementation, a `describe()` for the UI, and the run record.
7. **Scheduler** (half a day): a small in-process cron for pulls (BOLs hourly,
   indexes daily, mailbox every few minutes) with manual "pull now" kept.

Two live connectors plus the interfaces and scheduler is an 8. QuickBooks in
production is a 9.

### 4.5 Operability: 6 → 8 (2 days)

1. Error tracking (Sentry) on both services; uptime pinger on `/api/health`
   and `/ping`.
2. Alert on a failed or partial integration run, and on critical exceptions
   older than a threshold (email or Slack; reuse the transactional email
   provider).
3. `/ops/health` with feed freshness (last successful run per kind) shown on
   the dashboard.
4. Structured request logs with the acting user, route, and duration.
5. Runbook in the README: restore from backup, rotate keys, reset a password.

### 4.6 Interoperability: 6.5 → 8 (3 to 4 days)

1. **Outbound webhooks**: `order.status_changed`, `load.status_changed`,
   `bol.received`, `invoice.approved`, `invoice.paid`, signed with a shared
   secret, with retries and a delivery log. This turns the platform from a
   sink into a source for carriers, accounting, and customer systems.
2. **API keys for machine callers**: a second credential type next to staff
   sessions (`Authorization: Bearer rpg_key_…`) with a role and an audit
   identity, so a supplier portal script or a BI tool can call `/ops` without
   a browser session.
3. **OpenAPI description** of `/ops`, `/auth`, and `/portal`, generated from
   the route table, served at `/openapi.json`.
4. **CSV export** endpoints for orders, loads, BOLs, invoices, and margins with
   the same filters the pages use.
5. **Crosswalk files** for supplier product codes and QuickBooks items,
   managed like the DTN map, with a dry-run tool each.

### 4.7 Tests: 8 → 9 (1 day)

1. Commit the Playwright flows that were run ad hoc during development
   (sign-in, copilot via `aimock` fixtures, approvals, portal) under
   `frontend/e2e/` and run them in CI.
2. Contract tests per connector interface against recorded vendor samples.

### 4.8 Functionality: 9 (hold)

Nothing blocking. The items above (exports, alerts, invitations) are what
beta testers will ask for first.

## 5. Suggested order

| Week | Work | Outcome |
| --- | --- | --- |
| 1 | Backups and restore drill; transactional email; password reset and invitations (staff and portal); Sentry and uptime | Security 8, durability 6, operability 8 |
| 2 | Feed interfaces and scheduler; DTN live when the packet lands; one rack source | Integrations 7 |
| 3 | Mailbox connector; QuickBooks sandbox | Integrations 8 |
| 4 | Webhooks, API keys, OpenAPI, CSV exports; Playwright in CI | Interoperability 8, tests 9 |
| 5+ | Postgres move (with the SaaS audit's tenancy work); QuickBooks production | Durability 8+ |

Vendor lead times (DTN onboarding, Intuit app review, a market data license)
are the long poles, so the first emails in section 2 should go out this week.
