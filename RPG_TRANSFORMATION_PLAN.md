# From Northstar Demo to the RPG Fuel Platform — Transformation Plan

**Inputs:** the [RPG build-out plan](./docs/source/RPG_Fuel_Platform_Buildout_Plan_3.md),
the [data model](./RPG_DATA_MODEL.md) derived from it, the
[SaaS audit](./SAAS_AUDIT.md), and the [auth plan](./AUTH_PLAN.md).
**Question answered:** what has to change in this repository, which today is
the vendored CopilotKit "Northstar" hardware-sales CRM demo, to become
Royalty Petroleums Group's fuel operations platform.

---

## 1. Summary

The demo and the target share a shape: a workspace with a board, dashboards,
reports, and an AI copilot that drives the UI through tools, cards, and
approval steps. That shell, the agent framework, and the deployment carry
over. Everything domain-specific does not: the entities, the seed data, the
tools, the system prompt, the pricing logic, and most pages are about
selling laptops and must be rebuilt around fuel orders, loads, bills of
lading, pricing rules, and invoices.

| Layer | Keep | Adapt | Replace |
| --- | --- | --- | --- |
| Frontend shell | `AppChrome`, `NavRail`, `TopBar`, sidebar assistant, drawer pattern, SVG chart components, reports browser | navigation keys, page list, branding | hardware pages (products, quotes) |
| Copilot wiring | `layout.tsx` provider, `use-copilot-features.tsx` pattern (render tools, frontend tools, human-in-the-loop) | card components become fuel cards | tool set, suggestion pills |
| Agent | `main.ts` structure, AG-UI bridge, `pushState`, `stateContextBuilder`, tool definition style, test style | system prompt, tools, analytics | store, seed, hardware recommendation logic |
| Data | nothing | `types.ts` → new domain types | SQLite singleton → Postgres repositories per the audit |
| Ops | Dockerfiles, Railway services, volume, IaC file | health checks, variables | add background workers and integrations |

Rough scale: the target platform is 5 to 8 times the demo in domain code.
Plan on the demo giving you the first two weeks of UI and agent scaffolding
for free, not the product.

## 2. Guiding decisions

1. **One operator, many customers.** RPG staff use the workspace; customers
   use a read-mostly portal scoped to their own data. Multi-tenant SaaS
   (other distributors as tenants) is the audit's roadmap, not this plan's.
2. **Postgres before features.** Every Phase 1 entity above is relational and
   append-only in places; do not build the pricing engine on the demo's
   SQLite singleton and migrate later.
3. **The copilot assists, gates decide.** Pricing rules, invoice approval,
   and order confirmation are human actions with an audit row. The copilot
   drafts, explains, flags, and prepares; it never finalizes money.
4. **Workflows are data.** Order status, load status, and billing status are
   enums with immutable event tables, and the validation rules that raise
   exceptions are configuration evaluated by one engine, exactly as the
   plan's cross-cutting section asks.
5. **Integrations behind adapters.** Supplier BOL feeds, index feeds,
   mailboxes, and QuickBooks each get an adapter interface with a manual or
   CSV implementation first, so every screen works before any partner API
   is connected.

## 3. What changes, file by file

### 3.1 Keep as is (or nearly)

- `frontend/components/AppChrome.tsx`, `NavRail.tsx`, `TopBar.tsx`,
  `AssistantPanel.tsx`, `KpiCard.tsx`, `KpiStrip.tsx`, chart components under
  `frontend/components/dashboard/`.
- `frontend/components/PipelineBoard.tsx` and `DealCard.tsx`: the drag-and-drop
  board becomes the **Load & Billing board** (columns = `billing_status`) and
  the **Orders board** (columns = order status). Generalize the column and
  card types; keep the optimistic overlay in `hooks/use-crm.ts`.
- `frontend/components/FollowupApprovalCard.tsx` and the
  `useHumanInTheLoop` pattern: reuse for order approval, pricing-rule
  confirmation, and invoice approval cards.
- `frontend/components/WorkspaceHandoffCard.tsx`: reuse for "opened the
  billing board", "report ready".
- `agent/main.ts` structure, `agent/src/tools/*` definition style,
  `agent/src/crm/__tests__` style, `agent/Dockerfile`, `frontend/Dockerfile`,
  `.railway/railway.ts`.

### 3.2 Adapt

- `frontend/lib/navigation.ts` (`PAGE_KEYS`): dashboard, orders, loads,
  pricing, market, customers, suppliers, terminals, carriers, billing,
  exceptions, reports, settings; plus a `portal` route group.
- `agent/src/crm/types.ts` and `frontend/lib/crm.ts`: replace the domain
  types with the data model; generate the frontend types from the agent
  (one shared package) instead of hand-mirroring them.
- `agent/src/crm/store.ts`: split into repositories (`customers`, `pricing`,
  `orders`, `loads`, `bols`, `invoices`, `exceptions`) over Postgres with
  Drizzle; keep the method-per-operation style so tools stay thin.
- `agent/src/crm/seed.ts`: RPG-shaped demo data (six customers, three
  terminals, two suppliers, two carriers, four products, thirty days of rack
  prices, a week of orders and loads) for local development and demos.
- `agent/src/crm/analytics.ts`: margin, gallons, revenue, exceptions,
  price movement, replacing bookings and win rate.
- `agent/src/crm/prioritize.ts`: the scoring pattern becomes **exception
  triage** (rank open exceptions by money at risk and age).
- `agent/src/tools/report.ts`: daily ops report (gallons, revenue, margin,
  exceptions) replacing the weekly sales report.
- `agent/main.ts` system prompt: RPG copilot persona, fuel vocabulary, the
  hard rules ("never set a price or approve an invoice; propose and ask").
- `frontend/app/page.tsx` dashboard: Module J tiles (today's rack prices,
  customer prices, market direction, orders in progress, loads awaiting
  billing, gallons, revenue, expected vs. actual profit, exceptions).
- `frontend/app/reports/**`: daily and weekly ops reports and customer
  profitability.

### 3.3 Replace

- `agent/src/tools/recommend.ts` and `frontend/components/QuoteCard.tsx`,
  `ProductCard.tsx`, `app/products/page.tsx`, `app/quotes/[id]/page.tsx`:
  replaced by the pricing module (rules editor, rack price entry, customer
  price dashboard, `PriceQuoteCard`).
- `agent/src/tools/enrich.ts`, `agent/src/tavily.ts`, `EnrichmentCard.tsx`:
  optional later (supplier or customer research); out of Phase 1.
- `agent/src/tools/team.ts`, `RepStatsCard.tsx`, `app/team/page.tsx`:
  replaced by staff and workload views only if needed; not in the plan.
- `agent/src/tools/deals.ts`: replaced by order and load tools.
- Suggestion pills in `use-copilot-features.tsx` ("Research CopilotKit"):
  replaced by "What's today's ULSD price for Acme?", "Show loads awaiting
  billing", "Any duplicate BOLs?", "Draft invoices for yesterday".
- Branding: "Northstar", "NB", "Prepared by Northstar AI CRM" → RPG Fuel.

### 3.4 Add (new code)

- `agent/src/pricing/engine.ts`: pure function
  `evaluate(rules, rackPrices, indexPrices, taxRates, request) → CustomerPrice`
  with table-driven tests; the single place price math lives.
- `agent/src/validation/rules.ts`: config-driven exception rules and an
  evaluator run on every load, BOL, and invoice change.
- `agent/src/integrations/`: `supplier/` (BOL connectors), `index/` (price
  feeds), `mailbox/` (email intake), `quickbooks/` (online and desktop
  adapters), each with a `manual` or `csv` implementation first.
- `worker/`: a third Railway service for scheduled jobs (poll mailbox, pull
  BOL feeds, refresh indexes, recompute margins, nightly forecast,
  QuickBooks sync), sharing the agent's repository code.
- `frontend/app/portal/**`: customer portal pages behind customer-scoped
  auth; order list, order detail with milestones, delivery documents.
- `frontend/app/(ops)/pricing`, `/market`, `/orders`, `/loads`, `/billing`,
  `/exceptions`, `/customers`, `/suppliers`, `/terminals`, `/carriers`,
  `/intake` (email review queue).
- Object storage (Railway bucket) for BOL PDFs, proof of delivery, and raw
  emails.

## 4. Module-by-module build notes

| Module | What the copilot does | What humans do | Key code |
| --- | --- | --- | --- |
| A Pricing | `quote_price` (uses the engine), `explain_price` (shows the inputs from `customer_price`), `propose_pricing_rule` → HITL confirm | enter or import rack prices, approve rules | engine, rules editor, price dashboard |
| B Margin | `margin_summary` by customer/day, flags low-margin loads in a card | investigate variances | `load_margin` recompute, dashboard tiles |
| C Market tracker | `market_update` narrative over `index_price` | subscribe to alerts | index ingestion, charts (reuse SVG) |
| D Forecast | writes the narrative for a statistical baseline (momentum / moving average) and reports its backtested hit rate | treat as information only | nightly job, `forecast` table |
| E BOL | `extract_bol` from an uploaded PDF into a review card; `match_bol` suggests the load and customer | confirm matches, resolve duplicates | connectors, dedupe hash, matching rules |
| F Load & billing board | `show_board`, `triage_exceptions`, `mark_pricing_verified` after checks | move cards, resolve exceptions | board reuse, validation engine |
| G Portal | none in v1 | customers view status; staff post milestone updates | portal route group, scoped queries |
| H Email intake | `parse_order_email` with per-field confidence into the review queue | approve, edit, reject | mailbox poller, extraction schema, queue page |
| I QuickBooks | `prepare_invoices` builds drafts from BOL lines and price snapshots; `explain_invoice` | management approves; sync runs | invoice builder, approval gate, adapter |
| J Dashboard | `daily_brief` narrative | read | dashboard page over the new analytics |

Guardrails that apply to every tool: identity from the auth plan on every
run; mutations write `audit_log`; price and invoice mutations only through
HITL cards; tool outputs render as cards (the existing pattern) rather than
prose tables.

## 5. Phases, aligned to the RPG plan

| Phase | RPG plan focus | This repo: what ships | Effort (1 engineer) |
| --- | --- | --- | --- |
| **0. Foundation** | (not in the plan) | Auth Phase 1–2, Postgres + Drizzle, domain types, repositories, RPG seed, rename and rebrand, worker service scaffold, CI | 3–4 weeks |
| **1. Pricing & core ops** | customers, pricing rules, base prices, auto customer pricing, margin calc, basic reporting | customers/locations/products/terminals/suppliers pages, rack price entry + CSV import, pricing engine + rules editor, customer price dashboard, expected margin, copilot tools A/B, dashboard v1 | 4–6 weeks |
| **2. Order intake & portal** | email capture, review queue, order workflow, portal | orders board + status events, manual and portal order entry, mailbox poller + LLM extraction + review queue, portal with customer-scoped auth, customer status emails | 4–6 weeks |
| **4. Supplier & BOL** (before 3) | BOL retrieval, load dashboard, matching, exceptions | loads, carriers, BOL entry + PDF extraction + first feed adapter, load & billing board, validation engine and exceptions page, actual margin | 4–6 weeks |
| **5. QuickBooks & accounting** | invoice prep, approval, creation, status sync, profitability | invoice builder, tax lines, approval gate, QuickBooks adapter (Online first), payment sync, AR aging, customer profitability reports | 4–5 weeks |
| **3. Market intelligence** | index tracking, charts, alerts, forecasting | index ingestion (CSV then feed), market page, alerts, baseline forecast with backtesting | 2–3 weeks |

Phase 3 is moved after 4 and 5 on purpose: billing is where money is lost
today, and the market tracker is informational. The RPG plan itself notes
that Phase 3 only depends on Phase 1, so this reorder costs nothing.

Total: roughly 21 to 30 engineer-weeks, plus partner-dependent time for BOL
feeds and QuickBooks credentials.

## 6. Migration and cutover

1. Import the current customer list, delivery locations, and price sheets
   into Phase 1 tables from spreadsheets (CSV importers are Phase 1 work).
2. Run pricing in parallel with the current method for two weeks; compare
   `customer_price` snapshots to what was actually charged.
3. Backfill 90 days of BOLs and invoices when Phase 4–5 land so margin
   history is not empty on day one.
4. Cut over billing only after one full month reconciles to QuickBooks.

## 7. Success metrics to bake in from Phase 1

- Pricing errors per 100 invoices (target: 0 after Phase 5).
- Hours per week of manual entry (baseline now, measure quarterly).
- Days from delivery to invoice.
- Percentage of loads with a matched BOL within 24 hours.
- Expected vs. actual gross profit variance per gallon.
- Customer status questions handled by the portal instead of phone or email.

## 8. Risks

- **Data feeds are external.** Supplier BOL access, index licenses, and the
  QuickBooks edition decide Phases 3–5; the plan's "next steps" must be
  answered before those phases are scheduled.
- **Tax complexity** is easy to underestimate; scope the states and products
  before designing `tax_rate`.
- **Forecast expectations.** A direction predictor will be wrong often;
  ship it with a visible hit rate or it will erode trust in the rest of
  the dashboard.
- **Email parsing quality.** Keep the review queue mandatory until measured
  accuracy on real emails exceeds an agreed threshold.
- **Single engineer bottleneck.** Phases 2 and 4 can run in parallel with a
  second developer, as the RPG plan suggests.
