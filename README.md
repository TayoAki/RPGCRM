# RPG Fuel Platform (MVP)

A fuel operations platform for Royalty Petroleums Group, built as a copilot-first
web app. It covers the order-to-cash lifecycle for a fuel distributor:

```
Customer order → Order intake → Pricing → Carrier / load tracking →
Supplier BOL → Customer delivery → Billing → Profitability
```

Staff work in the workspace (boards, tables, drawers) or ask the embedded copilot
("what's today's price for Lone Star on ULSD?", "pull the BOL feed", "prepare
invoices"). Anything that touches money or creates an order goes through a
confirmation card before it happens.

**MVP scope.** Nothing external is wired up yet. QuickBooks, the order inbox,
supplier BOL feeds, and market index feeds are all driven by sample JSON files in
[`agent/samples/`](./agent/samples), so the whole flow can be exercised end to end
without credentials. The seams where the real integrations plug in are listed
[below](#sample-data-instead-of-integrations).

The platform is built on [CopilotKit](https://copilotkit.ai), the
[AG-UI protocol](https://docs.copilotkit.ai/ag-ui), and a TypeScript
[Strands](https://strandsagents.com) agent. It started from CopilotKit's
[`strands-crm` showcase](https://github.com/CopilotKit/CopilotKit/tree/main/examples/showcases/strands-crm)
(MIT, see [LICENSE](./LICENSE)); the requirements it implements are in
[docs/source](./docs/source/RPG_Fuel_Platform_Buildout_Plan_3.md), with the data
model in [RPG_DATA_MODEL.md](./RPG_DATA_MODEL.md) and the build plan in
[RPG_TRANSFORMATION_PLAN.md](./RPG_TRANSFORMATION_PLAN.md).

## What the MVP does

| Plan module                     | Where                             | What works                                                                                                                                                                  |
| ------------------------------- | --------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A. Pricing                      | `/pricing`                        | Daily rack (base) price import from a supplier feed file plus manual entry, pricing rules (rack / index / fixed basis, differential, freight, fees, contract vs spot, effective dates), auto-calculated price board, quotes with a line-by-line explanation, Texas fuel taxes by product category |
| B. Margin & profit tracking     | `/reports`, load drawer           | Expected vs actual gross profit per load and per customer, totals by day, week, and month, profit per gallon, low-margin and cost-variance flags                             |
| C. Fuel market tracker          | `/market`                         | Index history (OPIS, NYMEX), sample feed refresh, next-day direction forecast with a backtested hit rate                                                                     |
| D. Billing & invoicing          | `/billing`                        | Billing board (BOL Received → Pricing Verified → Ready to Invoice → Invoiced → Paid), invoice builder (net or gross gallons, taxes, freight, fees), management approval gate, QuickBooks sync and payment import (mock) |
| E. Load & BOL management        | `/loads`, `/bols`                 | Dispatch board with drag-to-advance statuses, delivery tickets, BOL ingestion from a pluggable source (sample feed, or the DTN connector when configured) with duplicate detection and automatic load matching, manual match for the rest |
| F. Customer portal              | `/portal`                         | Customer sign-in (email + password, httpOnly session cookie, lockout after repeated failures), then a read-only order timeline, deliveries, and invoices scoped to that customer |
| G. Orders                       | `/orders`                         | Manual order entry, milestone tracking (Received → Confirmed → Carrier Confirmed → In Transit → Delivered), credit holds and release                                        |
| H. Email order intake           | `/orders` → Intake queue          | Sample inbox parsed into draft orders with a confidence score and issues; attachments too (CSV and Excel order sheets become one draft per row, PDF purchase orders one draft); human review and approval |
| I. Management dashboard         | `/`                               | Gallons, revenue, gross profit, orders in progress, loads awaiting billing, invoices to approve, exceptions, market movement, customer profitability                       |
| J. Exceptions                   | `/exceptions`                     | Rule-based checkpoints (missing BOL, unpriced order, low margin, gallons variance, overdue invoice, ...) with triage, acknowledge, and resolve                             |

Reference data (customers, delivery locations, contacts, products, suppliers,
terminals, carriers, indexes, tax rates) lives under `/customers` and `/network`.

### Branding

The UI carries the company brand from [royaltypetroleumsgroup.com](https://royaltypetroleumsgroup.com/):
the official logo (color and white lettering) and drop mark under
`frontend/public/brand/`, the palette (navy `#0E2F45`, blue `#3993C0`, sky
`#56B9DE`) as theme tokens in `frontend/app/globals.css`, Poppins headings with
Open Sans body copy, and the company's positioning line and contact details in
the customer portal. Brand strings live in one place, `BRAND` in
`frontend/components/Logo.tsx`.

### The copilot

The sidebar copilot is a Strands agent with tools over the same service layer the
UI uses. Read tools render as cards in chat (price quote, daily brief, market
update, exceptions triage, margin report, customer summary, intake queue, BOL feed,
invoices, QuickBooks sync). Three actions require a person to click:

| Copilot asks for confirmation before | Card               |
| ------------------------------------ | ------------------ |
| creating an order from chat          | `confirm_order`    |
| approving a parsed order email       | `confirm_intake`   |
| approving an invoice                 | `confirm_invoice`  |

The copilot can also open pages and drawers (`navigate_to`, `focus_order`,
`focus_load`). After any change it pushes a fresh snapshot to the UI, so boards and
badges update without a reload.

### Staff sign-in

Staff sign in with email and password ([AUTH_PLAN.md](./AUTH_PLAN.md) Phase 1).
Every page, API route, and the agent endpoint need a session, which lives in an
httpOnly cookie and is checked by the agent on every call; roles gate approvals
(for example, only management can approve an invoice) and every change is
attributed to the signed-in user. Customers sign in separately to the portal.

| Staff account    | Email                    | Role       |
| ---------------- | ------------------------ | ---------- |
| Dana Whitfield   | `dana@rpgfuel.example`   | management |
| Marcus Lee       | `marcus@rpgfuel.example` | dispatch   |
| Priya Natarajan  | `priya@rpgfuel.example`  | pricing    |
| Elena Ortiz      | `elena@rpgfuel.example`  | billing    |
| Sam Carter       | `sam@rpgfuel.example`    | admin      |

The demo password for every staff account is `RPGstaff!2026`; set
`STAFF_BOOTSTRAP_PASSWORD` on the agent before its first start to bootstrap with
your own. Change it from the user menu after signing in (other sessions for the
account are signed out); five failed attempts lock an email for 15 minutes. The
sign-in pages list the demo accounts only when the frontend is built with
`NEXT_PUBLIC_DEMO_ACCOUNTS=1`.

## Sample data instead of integrations

| Integration          | Sample file                                                                | Triggered by                                                        | Real integration would plug into                    |
| -------------------- | -------------------------------------------------------------------------- | ------------------------------------------------------------------- | --------------------------------------------------- |
| Order inbox (email)  | `agent/samples/emails.json` + `agent/samples/attachments/` (CSV, XLSX, PDF) | "Run email intake" (Orders page, copilot) or `POST /ops/intake/run` | `agent/src/services/orders.ts` → `runEmailIntake`; attachment bytes go through `agent/src/intake/attachments.ts` |
| Supplier BOL feed    | `agent/samples/bol-feed.json` (or DTN, see below)                          | "Pull BOL feed" (Loads / BOLs pages, copilot) or `POST /ops/bols/pull` | `agent/src/integrations/bol/` (`BolSource`); DTN connector in `dtn.ts` |
| Supplier rack feed   | `agent/samples/rack-feed.json`, or your supplier's own sheet uploaded on the Pricing page (samples in `agent/samples/rack-sheets/`) | "Import rack feed" / "Upload rack sheet" (Pricing page, copilot) or `POST /ops/rack-prices/import` and `/upload` | `agent/src/services/pricing.ts` → `importRackFeed`; sheets parsed by `agent/src/pricing/rack-sheet.ts` |
| Market index feed    | `agent/samples/index-feed.json`, or EIA daily spot prices when `EIA_API_KEY` is set (see below) | "Refresh feed" (Market page, copilot) or `POST /ops/market/refresh` | `agent/src/integrations/market/` (`IndexSource`); EIA connector in `eia.ts` |
| QuickBooks Online    | `agent/samples/quickbooks-invoice-template.json`, `quickbooks-payments.json` | "Sync QuickBooks" (Billing page, copilot) or `POST /ops/quickbooks/sync-invoices` and `sync-payments` | `agent/src/integrations/quickbooks/mock.ts` |

Sample files use relative time tokens (`{{DATE+1}}`, `{{DATETIME-5h}}`) that are
resolved when the sample is loaded, so the demo stays current. Feeds are
idempotent: pulling the BOL feed twice reports the second batch as duplicates, and
an email whose PO is already queued is flagged instead of creating a second draft.

### Connecting DTN for electronic BOLs

The BOL feed is a pluggable source. With nothing configured it reads the sample
file; set the DTN variables on the agent service and the same pull reads DTN:

| Variable          | Value                                                                                   |
| ----------------- | --------------------------------------------------------------------------------------- |
| `DTN_BOL_MODE`    | `https` to pull from DTN's endpoint, `directory` to read files DTN drops (SFTP mirror or mounted volume), `off` for the sample feed |
| `DTN_BOL_URL`     | the endpoint from your DTN onboarding packet (`https` mode)                             |
| `DTN_API_KEY`     | its credential, sent as a bearer token and `x-api-key` header                           |
| `DTN_BOL_DIR`     | inbox folder for `directory` mode; processed files move to `processed/`                 |
| `DTN_BOL_FORMAT`  | `csv` or `json` (optional; detected otherwise)                                          |
| `DTN_FIELD_MAP`   | path to the crosswalk file (default `agent/config/dtn-bol-map.json`)                    |

DTN exports use their own column names and identifiers (supplier names, terminal
control numbers, carrier SCACs, product codes, consignee names). Those live in
[`agent/config/dtn-bol-map.json`](./agent/config/dtn-bol-map.json), not in code.
Before switching the mode on, dry-run a sample export from DTN:

```bash
cd agent && npx tsx scripts/check-dtn-file.ts ~/Downloads/dtn-export.csv
```

It prints how each BOL maps and what would be skipped and why, so the crosswalk
can be completed with real values. On every pull, BOLs whose codes the platform
does not know are listed as skipped in the run summary rather than dropped; the
BOLs page shows the active source and the last pull. Supplier portals or terminal
exports would be further sources behind the same interface.

### Connecting EIA for market prices

The market feed is a pluggable source too. With nothing configured it reads the
sample file of daily moves; with a free key from the U.S. Energy Information
Administration (EIA) it pulls real daily spot prices:

1. Register for a key at https://www.eia.gov/opendata/register.php (free, instant).
2. Dry-run the crosswalk: `cd agent && EIA_API_KEY=... npx tsx scripts/check-eia.ts`.
   It prints the latest values per index and anything skipped.
3. Set `EIA_API_KEY` on the agent service and redeploy. `MARKET_FEED_MODE=off`
   keeps the sample feed even with a key.

The crosswalk from our index codes to EIA series is
[`agent/config/eia-series.json`](./agent/config/eia-series.json). EIA publishes
no rack averages, so Gulf Coast pipeline spot prices stand in for the Dallas
rack indexes and New York Harbor spot for the NYMEX front months; the index
names on the Market page change to say so once the feed is live. Each refresh
backfills the last 35 days, replaces any stored value for the same date, and
recomputes the day-over-day changes. Values arrive a business day or two
behind; pricing rules keyed on an index use the latest stored value.

### Uploading a supplier's rack sheet

Suppliers publish their daily rack prices as an email attachment, a PDF price
notice, or a portal download. **Upload rack sheet** on the Pricing page takes
the file as it is (CSV, Excel, PDF, or text). Tabular files are read by column
(supplier, terminal, product, price, and optionally a change and an effective
time; header names are matched loosely). Documents are read line by line, where
a line naming a terminal sets the terminal for the product and price lines under
it. Names are matched to the suppliers, terminals, and products in the store;
anything that cannot be placed is reported as skipped in the sheet's own words.
Postings carry a reference built from the file's content hash, so uploading the
same sheet twice imports nothing new. Three sample sheets live in
`agent/samples/rack-sheets/` and are downloadable from the upload form.

## Layout

```
agent/                TypeScript Strands agent served over AG-UI by Express (:8000)
  main.ts             agent, system prompt, tool registration, HTTP server
  src/domain/         types, SQLite document store (node:sqlite), deterministic seed
  src/pricing/        pricing engine, Texas fuel taxes, rack sheet parser
  src/market/         direction forecast
  src/integrations/   pluggable feed sources: BOLs (sample, DTN) and market indexes (sample, EIA)
  src/intake/         order email parser
  src/bols/           BOL dedupe and load matching
  src/billing/        invoice builder
  src/margin/         expected vs actual margin
  src/exceptions/     checkpoint rules
  src/services/       the operations service layer (used by both tools and REST routes); staffAuth.ts and portal.ts hold sign-in
  src/tools/          copilot tools
  src/app.ts          Express app: /ping, the staff auth gate, the agent endpoint, REST routes
  src/routes.ts       REST routes under /ops, /auth, and /portal
  samples/            sample JSON standing in for integrations
frontend/             Next.js (App Router) + CopilotKit UI (:3000); API routes proxy to the agent
  proxy.ts            sign-in gate for pages and API routes
  app/(ops)/          workspace pages (session verified in the layout)   app/login/   staff sign-in   app/portal/   customer portal
  components/cards/   copilot cards             hooks/        ops state, copilot wiring
scripts/sync-types.mjs  copies agent/src/domain/types.ts to frontend/lib/domain.ts
```

```
Next.js + CopilotKit (UI, :3000)
        │  /api/copilotkit → HttpAgent          /api/ops/* → REST proxy
        ▼
TypeScript Strands agent (Express, :8000)
        │  tools: quote_price / daily_brief / run_email_intake / pull_bol_feed /
        │         prepare_invoices / sync_quickbooks / triage_exceptions / …
        ▼
SQLite ops store  ──STATE_SNAPSHOT──▶  boards, drawers, dashboard, portal
```

## Prerequisites

- Node.js 22.13 or newer (the store uses the built-in `node:sqlite` module; see `.nvmrc`)
- An **OpenAI API key**, or an OpenRouter key (see the environment table below)

## Local development

```bash
npm run install:all          # installs root, agent, and frontend deps

cp agent/.env.example agent/.env
# edit agent/.env → set OPENAI_API_KEY (and the OpenRouter lines if you use it)

npm run dev                  # runs the agent (:8000) and the UI (:3000) together
```

Open http://localhost:3000. The frontend's API routes proxy to the agent at
`http://localhost:8000` (override with `AGENT_URL`). On first start the agent
creates `agent/data/rpg.db` and seeds it with the demo dataset (7 customers, 12
orders, 7 loads, invoices, 30 days of index history).

Prefer two terminals? Run `npm --prefix agent run dev` and `npm --prefix frontend run dev`.

### Environment variables

| Variable          | Where    | Purpose                                                                                                    |
| ----------------- | -------- | ---------------------------------------------------------------------------------------------------------- |
| `OPENAI_API_KEY`  | agent    | Key for the LLM provider (required)                                                                        |
| `OPENAI_BASE_URL` | agent    | Optional. `https://openrouter.ai/api/v1` to use OpenRouter                                                 |
| `OPENAI_API_MODE` | agent    | Optional. `chat` selects the Chat Completions API (needed for OpenRouter); default is the Responses API    |
| `OPENAI_MODEL`    | agent    | Optional model id (default `gpt-5.4`; on OpenRouter use e.g. `openai/gpt-5.4`)                             |
| `RPG_DB_PATH`     | agent    | Optional path for the SQLite file (default `agent/data/rpg.db`; on Railway `/data/rpg.db` on the volume)   |
| `PORT`            | both     | Listening port (agent 8000, frontend 3000)                                                                 |
| `AGENT_URL`       | frontend | Where the Next.js API routes reach the agent (default `http://localhost:8000`)                             |

## Try it (a ten-minute walkthrough)

1. **Sign in** at `/login` as `dana@rpgfuel.example` (password `RPGstaff!2026`).
   You land on the **Dashboard** (`/`): today's numbers, 14-day gallons, market
   movement, and what needs attention. The copilot pills on the right run the same flows from chat.
2. **Intake**: on Orders & Intake press **Run email intake**. Nine sample emails
   are parsed into twelve drafts: six from email bodies, three rows from an
   attached CSV schedule, two rows from an attached Excel sheet, and one from an
   attached PDF purchase order (an attached photo is recorded as unsupported).
   Open the queue, fix the one with no matching customer, approve the rest. Each
   approval becomes an order.
3. **Pricing**: press **Import rack feed** to bring in today's supplier postings
   (the feed is idempotent, so pressing it twice imports nothing new), or
   **Upload rack sheet** with one of the sample sheets, then ask
   the copilot *"What's today's price for Lone Star Aggregates on ULSD, 7,500
   gallons?"* and compare with the price board. Add a rule and watch the board
   recalculate.
4. **Dispatch**: on Loads create a load for a confirmed order, then drag it
   Planned → Dispatched → Loading → In Transit. Record the delivery ticket from the
   load drawer.
5. **BOLs**: press **Pull BOL feed**. Three BOLs match loads automatically, one is
   a duplicate, one needs a manual match on the BOLs page.
6. **Billing**: press **Prepare invoices**. Sign out and sign in as Elena Ortiz
   (billing), then try to approve one: it is refused. Sign back in as Dana
   Whitfield (management) and approve, then **Sync QuickBooks**: invoices get
   QuickBooks ids and the sample payments are applied.
7. **Exceptions**: the low-margin load, the missing BOL, and the unpriced order show
   up here (and in the daily brief). Resolve one with a note.
8. **Portal**: open `/portal/login` and sign in as `orders@lonestaraggregates.com`
   with the demo password `RPGportal!2026` to see what Lone Star Aggregates sees.
   Every customer has one seeded account (its ordering contact, same demo
   password); the Customers page shows the account and last sign-in.
9. **Market**: refresh the feed and run the forecast; the hit rate comes from a
   backtest over the stored history.
10. **Reports**: profitability by customer and by load, expected vs actual.

Reset the demo at any time with `POST /ops/admin/reseed` signed in as Sam Carter
(the admin; staff logins and sessions survive the reset) or by deleting the
SQLite file.

## REST API (agent)

Every UI action goes through the same routes the copilot's tools use. Everything
except `/ping`, `/auth/login`, and `/portal/*` needs a staff session:
`Authorization: Bearer <token>` from `/auth/login`, which the frontend keeps in an
httpOnly cookie and attaches server-side (also on copilot requests). The agent
attributes each change to that session's user; identity headers from the caller
are ignored.

| Method | Route                                              | Purpose                                     |
| ------ | -------------------------------------------------- | ------------------------------------------- |
| GET    | `/ping`                                            | Health check (public)                       |
| POST   | `/auth/login`, `/auth/logout`, `/auth/password`; GET `/auth/me` | Staff sign-in, sign-out, password change, who am I |
| GET    | `/ops`                                             | Trimmed operational snapshot for the UI     |
| GET    | `/ops/dashboard`                                   | Dashboard metrics and daily series          |
| GET    | `/ops/reports/rollups?period=week`                 | Totals by day, week, or month               |
| GET    | `/ops/price-board`, POST `/ops/price/quote`        | Prices                                      |
| POST   | `/ops/rack-prices`, `/ops/pricing-rules`           | Pricing inputs                              |
| POST   | `/ops/rack-prices/upload`                          | A supplier's rack sheet (base64 JSON)       |
| GET    | `/ops/integrations/bol-source`, `/ops/integrations/index-source` | Which connector feeds BOLs and indexes |
| GET    | `/ops/market`, POST `/ops/market/refresh`          | Indexes, feed refresh and forecast          |
| POST   | `/ops/intake/run`, `/ops/intake/:id/review`        | Email intake                                |
| POST   | `/ops/orders`, `/ops/orders/:id/status`, `/ops/orders/:id/release-hold` | Orders                 |
| POST   | `/ops/loads`, `/ops/loads/:id/status`, `/ops/loads/:id/delivery`, `/ops/loads/:id/billing-status` | Loads |
| POST   | `/ops/bols/pull`, `/ops/bols`, `/ops/bols/:id/match` | BOLs                                      |
| POST   | `/ops/invoices/prepare`, `/ops/invoices/:id/approve`, `/ops/invoices/:id/reject` | Invoices      |
| POST   | `/ops/quickbooks/sync-invoices`, `/ops/quickbooks/sync-payments` | QuickBooks (mock)             |
| GET    | `/ops/exceptions/triage`, POST `/ops/exceptions/:id/resolve`, `/ops/exceptions/:id/acknowledge` | Exceptions |
| POST   | `/ops/admin/reseed`                                | Reset demo data (admin role only)           |
| POST   | `/portal/login`, `/portal/logout`; GET `/portal/me` (Bearer) | Customer portal sign-in and data      |

## Tests and checks

```bash
npm test                 # agent unit tests (pricing, taxes, parser, matching, invoicing, margin, exceptions, forecast) + frontend tests
npm run typecheck        # tsc for both packages
npm run build            # production build of the frontend
```

The copilot flows were verified end to end against a mock LLM
([aimock](https://github.com/CopilotKit/aimock)) with Playwright: every page
renders without console errors, and scripted prompts exercise the daily brief,
triage, quoting, intake, BOL feed, invoice preparation, navigation, and the
confirm-order card through to a created order. The same setup covers sign-in:
anonymous requests are redirected or refused, a copilot mutation is attributed to
the signed-in user, a forged identity header is ignored, role refusals, password
change, sign-out, and the portal staying public.

## Deploying to Railway

The app is deployed on [Railway](https://railway.com) as project **`rpgcrm`**,
described by [`.railway/railway.ts`](./.railway/railway.ts) (Railway's
infrastructure-as-code; `railway config plan` / `railway config apply`).

| Service    | Root directory | Health check | Notes                                                       |
| ---------- | -------------- | ------------ | ----------------------------------------------------------- |
| `agent`    | `agent`        | `GET /ping`  | private only, port 8000, volume mounted at `/data`          |
| `frontend` | `frontend`     | `GET /api/health` | public domain, port 3000, reaches the agent over private networking (`/` redirects to sign-in) |

Both services build from the Dockerfile in their root directory and deploy on
every push to the configured branch.

| Variable                                          | Service    | Value                                             |
| ------------------------------------------------- | ---------- | ------------------------------------------------- |
| `OPENAI_API_KEY`                                  | `agent`    | your key (kept in Railway, never in the repo)     |
| `OPENAI_BASE_URL` / `OPENAI_API_MODE` / `OPENAI_MODEL` | `agent` | `https://openrouter.ai/api/v1` / `chat` / `openai/gpt-5.4` (or remove all three for OpenAI directly) |
| `RPG_DB_PATH`                                     | `agent`    | `/data/rpg.db`                                    |
| `AGENT_URL`                                       | `frontend` | `http://${{agent.RAILWAY_PRIVATE_DOMAIN}}:8000`   |
| `STAFF_BOOTSTRAP_PASSWORD` (optional)             | `agent`    | password for staff accounts when they are first created; the demo password otherwise |
| `EIA_API_KEY` (optional)                          | `agent`    | free EIA open-data key; switches the market feed from the sample file to daily spot prices |
| `NEXT_PUBLIC_DEMO_ACCOUNTS` (optional, build time) | `frontend` | `1` to list the demo accounts on the sign-in pages; unset in production |

To reset the demo data in production, sign in as the admin (Sam Carter) and call
`POST /api/ops/admin/reseed` with that session, or delete `rpg.db` on the volume
and redeploy.

## Administering the demo

| Task | How |
| --- | --- |
| Staff accounts | The five seeded accounts (table above) with the demo password, or `STAFF_BOOTSTRAP_PASSWORD` if it was set before the first start. Each person changes their own password from the account menu. There is no reset yet: for a forgotten password, clear that user's `passwordHash` in the `staff` row and restart; the migration gives it the bootstrap password again. |
| Customer portal accounts | One per customer for its ordering contact, demo password `RPGportal!2026`. |
| Reset the demo data | Sign in as Sam Carter (admin) and `POST /api/ops/admin/reseed`; staff logins and sessions survive. Or delete `rpg.db` on the volume and redeploy. |
| List demo accounts on the sign-in pages | Build the frontend with `NEXT_PUBLIC_DEMO_ACCOUNTS=1` (unset in production). |
| Switch a feed from sample to live | Rack prices: upload the supplier's sheet on the Pricing page, no configuration. Market indexes: set `EIA_API_KEY` on the agent. BOLs: set the `DTN_*` variables. Email intake and QuickBooks: not yet ([INTEGRATIONS.md](./INTEGRATIONS.md)). |
| Tester guide | The **Start here** panel on the dashboard and `/guide` in the app; [BETA_GUIDE.md](./BETA_GUIDE.md) is the same content as a document. |

## Further reading

- [BETA_GUIDE.md](./BETA_GUIDE.md): the tester guide (sign-in, sample vs live, walkthrough, things to break, reporting, what real data to bring)

- [SAAS_AUDIT.md](./SAAS_AUDIT.md): what it takes to turn this into a multi-tenant SaaS product
- [AUTH_PLAN.md](./AUTH_PLAN.md): the authentication and authorization plan (Phase 1 built)
- [INTEGRATIONS.md](./INTEGRATIONS.md): what each real integration needs, an interoperability assessment, and the path to 8/10 in every readiness area
- [RPG_DATA_MODEL.md](./RPG_DATA_MODEL.md): the data model behind the ops store
- [RPG_TRANSFORMATION_PLAN.md](./RPG_TRANSFORMATION_PLAN.md) and [RPG_PLAN_REVIEW.md](./RPG_PLAN_REVIEW.md): how the plan was scoped and rated
