# Review of the RPG Fuel Platform Build-Out Plan

**Document reviewed:** "Fuel Management Software — Build-Out Plan,
Requirements & Development Direction", Royalty Petroleums Group LLC
([extracted text](./docs/source/RPG_Fuel_Platform_Buildout_Plan_3.md)).
**Companions:** [data model](./RPG_DATA_MODEL.md) and
[transformation plan](./RPG_TRANSFORMATION_PLAN.md).

## 1. What the document is

A requirements and direction document for an internal fuel-distribution
operations platform. It describes ten functional modules (pricing engine,
margin tracking, market index tracker, price forecasting, electronic bill of
lading integration, a load and billing dashboard, a customer portal,
automated email order intake, QuickBooks invoicing, and a management
dashboard), arranges them in five phases with dependencies, lists five
cross-cutting principles (reusable validation, per-customer isolation,
immutable audit trail, config-driven extensibility, hard approval gates), and
ends with four open questions about data sources, BOL partners, the
QuickBooks edition, and portal hosting.

It is a "what and in what order" document. It is not a specification: there
is no data model, no screen list, no integration contracts, no estimates, no
owners, and no success metrics. That is appropriate for its stage, and the
rating below reflects that stage.

## 2. Rating

| Dimension | Score (1–10) | Why |
| --- | --- | --- |
| Clarity of purpose | 9 | One-line lifecycle, one-paragraph goal, a layer table. Anyone can explain the system after one read. |
| Module decomposition | 8 | Ten modules map cleanly to real back-office functions; boundaries are sensible. |
| Sequencing and dependencies | 8 | Pricing first is right; dependency column is honest; parallelism called out. |
| Domain completeness | 6 | Order-to-cash is covered; procure-to-pay, freight settlement, credit control, and taxes are thin or absent (section 4). |
| Data and integration readiness | 5 | No entity model; BOL feed availability, index licensing, and QuickBooks edition are unknown, and Phases 3–5 depend on them. |
| Security and compliance | 7 | Portal isolation, audit trail, and approval gates are named up front; no roles matrix, retention, or document handling. |
| Measurability and delivery | 3 | No KPIs, timeline, estimates, staffing, environments, or testing approach. |
| Risk awareness | 7 | The "next steps" section identifies exactly the right unknowns. |
| **Overall** | **6.5** | A good direction document that needs a data model, a scope decision on taxes and freight, and delivery mechanics before it is an execution plan. |

## 3. Strengths worth keeping

- Pricing as the foundation. Every downstream number (margin, invoice,
  dashboard) references a price, so building and testing the rules engine
  first is the correct call.
- The review queue for email orders and the management approval gate for
  invoices. Both are the right places to keep humans in the loop, and both
  map directly onto the human-in-the-loop pattern the current codebase
  already has.
- Exceptions as a first-class module (missing BOLs, unassigned customers,
  pricing mismatches, duplicates, uninvoiced loads). This is where fuel
  distributors lose money, and the plan says to build the checks once and
  reuse them.
- Customer-scoped portal isolation "from day one". Correct and often
  retrofitted badly elsewhere.
- Config-driven suppliers, indexes, and pricing rules. Matches how the
  business will grow.

## 4. Gaps against how fuel back-office operations actually run

Interpreting "compare it to back-end ops" as: does the plan cover the
work the back office does every day? Walking the order-to-cash and
procure-to-pay flows of a fuel jobber:

| Back-office step | Plan coverage | Gap |
| --- | --- | --- |
| Customer setup: terms, credit limit, tax status, billing basis (net vs. gross gallons) | Partial (customer database) | Credit limits and holds, tax-exempt certificates, and billing basis are not mentioned; they change pricing and invoicing math. |
| Order capture (phone, email, portal) | Covered (Module H, G) | Phone and text orders still need manual entry; the plan has it. Fine. |
| Credit check before dispatch | Missing | A hold before a truck is dispatched is a standard control; add to Phase 2. |
| Pricing at time of lift | Partial (Module A) | The plan prices "daily"; rack postings change at specific times and many contracts price at the BOL timestamp. The engine must be effective-dated to the minute. |
| Dispatch: assign carrier, driver, truck, terminal, allocation | Partial (Module G status "Carrier Confirmed") | No dispatch board or supplier allocation tracking; loads are only status-tracked. |
| Lift at terminal, BOL issued (gross and net gallons, taxes on the BOL) | Covered (Module E) | Good field list. Multi-product compartments need BOL lines, not columns. |
| Delivery and proof of delivery | Partial | Delivered date/time is tracked; delivered gallons, signed ticket, and document storage are not. |
| Freight cost: carrier rates and carrier invoice reconciliation | Missing | Freight appears only as a pricing component. Actual freight cost is required for actual margin (Module B) and for paying carriers. |
| Supplier invoice reconciliation (accounts payable) | Missing | Supplier cost comes from the BOL, but supplier invoices differ (price corrections, fees). Profitability without AP reconciliation is an estimate. |
| Taxes: federal and state excise, environmental fees, dyed product, destination-based rates, exemptions | Thin (a BOL field) | The most error-prone part of fuel invoicing. Needs effective-dated rate tables and per-line tax computation (see `tax_rate`, `tax_line` in the data model). |
| Invoice build, approval, send, sync | Covered (Module I) | Good, including the hard gate. QuickBooks Online vs. Desktop is correctly flagged as decisive. |
| Payments, AR aging, collections | Partial | "Paid" status exists; aging and dunning do not. Add payment sync and aging to Phase 5. |
| Month-end: margin by customer, inventory or in-transit gallons, reconciliation to accounting | Partial (Modules B, J) | Reporting is there; reconciliation to QuickBooks totals is not stated. |
| Regulatory: motor fuel tax filings by state | Missing | Whether RPG files them decides if the platform must produce the gallons-by-jurisdiction reports. Ask. |
| Notifications: customer status emails, internal alerts | Partial (market alerts only) | Order and delivery notifications belong with the portal in Phase 2. |
| Documents: BOL PDFs, tickets, contracts | Missing | Object storage and retention are needed from Phase 4. |
| Roles: dispatcher, pricing, billing, management, customer | Missing | A permissions matrix should exist before the portal and the approval gate. |

The pattern: the plan follows revenue (order → price → BOL → invoice) well
and under-covers cost (freight, supplier invoices, taxes) and controls
(credit, roles, documents). Since the stated goal includes profitability and
fewer billing errors, the cost and tax side needs the same weight as pricing.

## 5. Comparison to the current application's back end

| RPG module | What exists in this repo today | Reusable? |
| --- | --- | --- |
| A Pricing | hardware quote heuristics (`agent/src/tools/recommend.ts`) | No; the pricing engine is new. The quote-card pattern is reusable. |
| B Margin | bookings/forecast analytics (`agent/src/crm/analytics.ts`) | Pattern yes, math no. |
| C, D Market and forecast | nothing | New. |
| E BOL | nothing | New; PDF extraction can use the copilot. |
| F Load & billing board | Kanban with drag-and-drop and optimistic updates | Yes, largely as is. |
| G Portal | nothing; no auth | New, after the auth plan. |
| H Email intake | human-in-the-loop approval pattern (`confirm_followup`) | Pattern yes; parsing, mailbox, and queue are new. |
| I QuickBooks | nothing | New. |
| J Dashboard | KPI tiles, charts, reports pages | Yes, with new numbers. |
| Cross-cutting: audit trail, validation rules, access control | none | New; see the SaaS audit and auth plan. |

Details of the keep/adapt/replace split are in the transformation plan.

## 6. Recommended changes to the plan

1. **Add a Phase 0**: authentication, Postgres, the data model, roles, and
   the audit log. The plan's cross-cutting principles all depend on it.
2. **Decide three things before Phase 1**: billing basis (net or gross),
   tax scope (states, products, who remits), and whether freight is owned
   fleet or carriers. Each changes the pricing engine's inputs.
3. **Bring cost into scope**: carrier rates and carrier invoice matching
   (Phase 4) and supplier invoice reconciliation (Phase 5), so "actual
   profit" is actual.
4. **Move Phase 3 (market intelligence) after Phases 4 and 5.** It only
   depends on Phase 1, and billing accuracy is worth more than a forecast.
5. **Define KPIs and a pilot**: pricing errors per 100 invoices, days from
   delivery to invoice, percentage of loads with a matched BOL in 24 hours,
   hours of manual entry per week. Pick two customers for a Phase 2 pilot.
6. **Treat the forecast as information with a published hit rate**, not a
   pricing input, until it has been backtested for a quarter.
7. **Add a roles and permissions matrix** and a document-retention note
   before the portal ships.
8. **Add estimates and owners** per phase; the transformation plan offers a
   starting point of roughly 21 to 30 engineer-weeks.

## 7. Verdict

Keep the document as the north star: its lifecycle framing, module list,
and sequencing are sound, and its cross-cutting principles are the right
ones. Before committing engineering time, extend it with the data model,
the three scoping decisions, the cost-side modules, and delivery mechanics.
With those additions it becomes an execution plan; the transformation plan
in this repository is written to be that next step.
