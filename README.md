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
| A. Pricing                      | `/pricing`                        | Rack price entry, pricing rules (rack / index / fixed basis, differential, freight, fees, contract vs spot, effective dates), auto-calculated price board, quotes with a line-by-line explanation, Texas fuel taxes by product category |
| B. Margin & profit tracking     | `/reports`, load drawer           | Expected vs actual gross profit per load and per customer, totals by day, week, and month, profit per gallon, low-margin and cost-variance flags                             |
| C. Fuel market tracker          | `/market`                         | Index history (OPIS, NYMEX), sample feed refresh, next-day direction forecast with a backtested hit rate                                                                     |
| D. Billing & invoicing          | `/billing`                        | Billing board (BOL Received → Pricing Verified → Ready to Invoice → Invoiced → Paid), invoice builder (net or gross gallons, taxes, freight, fees), management approval gate, QuickBooks sync and payment import (mock) |
| E. Load & BOL management        | `/loads`, `/bols`                 | Dispatch board with drag-to-advance statuses, delivery tickets, BOL feed ingestion with duplicate detection and automatic load matching, manual match for the rest          |
| F. Customer portal              | `/portal/<token>`                 | Read-only order timeline, deliveries, and invoices for one customer                                                                                                        |
| G. Orders                       | `/orders`                         | Manual order entry, milestone tracking (Received → Confirmed → Carrier Confirmed → In Transit → Delivered), credit holds and release                                        |
| H. Email order intake           | `/orders` → Intake queue          | Sample inbox parsed into draft orders with a confidence score and issues, human review and approval                                                                        |
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

There is no sign-in yet (see [AUTH_PLAN.md](./AUTH_PLAN.md)). The **acting user**
dropdown in the top bar stands in for a session; roles gate approvals (for
example, only management can approve an invoice).

| Acting user      | Role       |
| ---------------- | ---------- |
| Dana Whitfield   | management |
| Marcus Lee       | dispatch   |
| Priya Natarajan  | pricing    |
| Elena Ortiz      | billing    |
| Sam Carter       | admin      |

## Sample data instead of integrations

| Integration          | Sample file                                                                | Triggered by                                                        | Real integration would plug into                    |
| -------------------- | -------------------------------------------------------------------------- | ------------------------------------------------------------------- | --------------------------------------------------- |
| Order inbox (email)  | `agent/samples/emails.json`                                                | "Run email intake" (Orders page, copilot) or `POST /ops/intake/run` | `agent/src/services/orders.ts` → `runEmailIntake`   |
| Supplier BOL feed    | `agent/samples/bol-feed.json`                                              | "Pull BOL feed" (Loads / BOLs pages, copilot) or `POST /ops/bols/pull` | `agent/src/services/loads.ts` → `pullBolFeed`    |
| Market index feed    | `agent/samples/index-feed.json`                                            | "Refresh feed" (Market page, copilot) or `POST /ops/market/refresh` | `agent/src/services/market.ts` → `refreshIndexFeed` |
| QuickBooks Online    | `agent/samples/quickbooks-invoice-template.json`, `quickbooks-payments.json` | "Sync QuickBooks" (Billing page, copilot) or `POST /ops/quickbooks/sync-invoices` and `sync-payments` | `agent/src/integrations/quickbooks/mock.ts` |

Sample files use relative time tokens (`{{DATE+1}}`, `{{DATETIME-5h}}`) that are
resolved when the sample is loaded, so the demo stays current. Feeds are
idempotent: pulling the BOL feed twice reports the second batch as duplicates, and
an email whose PO is already queued is flagged instead of creating a second draft.

## Layout

```
agent/                TypeScript Strands agent served over AG-UI by Express (:8000)
  main.ts             agent, system prompt, tool registration, HTTP server
  src/domain/         types, SQLite document store (node:sqlite), deterministic seed
  src/pricing/        pricing engine and Texas fuel taxes
  src/market/         index feed and direction forecast
  src/intake/         order email parser
  src/bols/           BOL dedupe and load matching
  src/billing/        invoice builder
  src/margin/         expected vs actual margin
  src/exceptions/     checkpoint rules
  src/services/       the operations service layer (used by both tools and REST routes)
  src/tools/          copilot tools
  src/routes.ts       REST routes under /ops and /portal
  samples/            sample JSON standing in for integrations
frontend/             Next.js (App Router) + CopilotKit UI (:3000); API routes proxy to the agent
  app/(ops)/          workspace pages           app/portal/   customer portal
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

1. **Dashboard** (`/`): today's numbers, 14-day gallons, market movement, and what
   needs attention. The copilot pills on the right run the same flows from chat.
2. **Intake**: on Orders & Intake press **Run email intake**. Eight sample emails
   are parsed; open the queue, fix the one with no matching customer, approve the
   rest. Each approval becomes an order.
3. **Pricing**: ask the copilot *"What's today's price for Lone Star Aggregates on
   ULSD, 7,500 gallons?"* and compare with the price board. Add a rack price or a
   rule and watch the board recalculate.
4. **Dispatch**: on Loads create a load for a confirmed order, then drag it
   Planned → Dispatched → Loading → In Transit. Record the delivery ticket from the
   load drawer.
5. **BOLs**: press **Pull BOL feed**. Three BOLs match loads automatically, one is
   a duplicate, one needs a manual match on the BOLs page.
6. **Billing**: press **Prepare invoices**. Switch the acting user to Elena Ortiz
   (billing) and try to approve one: it is refused. Switch to Dana Whitfield
   (management) and approve, then **Sync QuickBooks**: invoices get QuickBooks ids
   and the sample payments are applied.
7. **Exceptions**: the low-margin load, the missing BOL, and the unpriced order show
   up here (and in the daily brief). Resolve one with a note.
8. **Portal**: open `/portal/lsa-7f3a9c` to see what Lone Star Aggregates sees.
9. **Market**: refresh the feed and run the forecast; the hit rate comes from a
   backtest over the stored history.
10. **Reports**: profitability by customer and by load, expected vs actual.

Reset the demo at any time with `POST /ops/admin/reseed` (acting user Sam Carter,
admin) or by deleting the SQLite file.

## REST API (agent)

Every UI action goes through the same routes the copilot's tools use, with the
acting user in the `x-actor-id` header.

| Method | Route                                              | Purpose                                     |
| ------ | -------------------------------------------------- | ------------------------------------------- |
| GET    | `/ping`                                            | Health check                                |
| GET    | `/ops`                                             | Trimmed operational snapshot for the UI     |
| GET    | `/ops/dashboard`                                   | Dashboard metrics and daily series          |
| GET    | `/ops/reports/rollups?period=week`                 | Totals by day, week, or month               |
| GET    | `/ops/price-board`, POST `/ops/price/quote`        | Prices                                      |
| POST   | `/ops/rack-prices`, `/ops/pricing-rules`           | Pricing inputs                              |
| GET    | `/ops/market`, POST `/ops/market/refresh`          | Indexes, feed refresh and forecast          |
| POST   | `/ops/intake/run`, `/ops/intake/:id/review`        | Email intake                                |
| POST   | `/ops/orders`, `/ops/orders/:id/status`, `/ops/orders/:id/release-hold` | Orders                 |
| POST   | `/ops/loads`, `/ops/loads/:id/status`, `/ops/loads/:id/delivery`, `/ops/loads/:id/billing-status` | Loads |
| POST   | `/ops/bols/pull`, `/ops/bols`, `/ops/bols/:id/match` | BOLs                                      |
| POST   | `/ops/invoices/prepare`, `/ops/invoices/:id/approve`, `/ops/invoices/:id/reject` | Invoices      |
| POST   | `/ops/quickbooks/sync-invoices`, `/ops/quickbooks/sync-payments` | QuickBooks (mock)             |
| GET    | `/ops/exceptions/triage`, POST `/ops/exceptions/:id/resolve`, `/ops/exceptions/:id/acknowledge` | Exceptions |
| POST   | `/ops/admin/reseed`                                | Reset demo data (admin)                     |
| GET    | `/portal/:token`                                   | Customer portal data                        |

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
confirm-order card through to a created order.

## Deploying to Railway

The app is deployed on [Railway](https://railway.com) as project **`rpgcrm`**,
described by [`.railway/railway.ts`](./.railway/railway.ts) (Railway's
infrastructure-as-code; `railway config plan` / `railway config apply`).

| Service    | Root directory | Health check | Notes                                                       |
| ---------- | -------------- | ------------ | ----------------------------------------------------------- |
| `agent`    | `agent`        | `GET /ping`  | private only, port 8000, volume mounted at `/data`          |
| `frontend` | `frontend`     | `GET /`      | public domain, port 3000, reaches the agent over private networking |

Both services build from the Dockerfile in their root directory and deploy on
every push to the configured branch.

| Variable                                          | Service    | Value                                             |
| ------------------------------------------------- | ---------- | ------------------------------------------------- |
| `OPENAI_API_KEY`                                  | `agent`    | your key (kept in Railway, never in the repo)     |
| `OPENAI_BASE_URL` / `OPENAI_API_MODE` / `OPENAI_MODEL` | `agent` | `https://openrouter.ai/api/v1` / `chat` / `openai/gpt-5.4` (or remove all three for OpenAI directly) |
| `RPG_DB_PATH`                                     | `agent`    | `/data/rpg.db`                                    |
| `AGENT_URL`                                       | `frontend` | `http://${{agent.RAILWAY_PRIVATE_DOMAIN}}:8000`   |

To reset the demo data in production, call `POST /ops/admin/reseed` through the
frontend proxy (`/api/ops/admin/reseed` with `x-actor-id: u-sam`) or delete
`rpg.db` on the volume and redeploy.

## Further reading

- [SAAS_AUDIT.md](./SAAS_AUDIT.md): what it takes to turn this into a multi-tenant SaaS product
- [AUTH_PLAN.md](./AUTH_PLAN.md): the authentication and authorization plan
- [RPG_DATA_MODEL.md](./RPG_DATA_MODEL.md): the data model behind the ops store
- [RPG_TRANSFORMATION_PLAN.md](./RPG_TRANSFORMATION_PLAN.md) and [RPG_PLAN_REVIEW.md](./RPG_PLAN_REVIEW.md): how the plan was scoped and rated
