<!-- Text extracted from RPG_Fuel_Platform_Buildout_Plan_3.docx (uploaded 2026-09-16) for reference. -->

ROYALTY PETROLEUMS GROUP LLC
Fuel Management Software — Build-Out Plan
Requirements & Development Direction
# 1. Project Objective
Build a centralized platform connecting the full fuel operations lifecycle:
Customer Order  →  Order Intake  →  Pricing  →  Carrier/Load Tracking  →
Supplier BOL  →  Customer Delivery  →  Billing  →  Profitability
Goal: reduce manual entry, minimize pricing and billing errors, improve customer communication, increase operational visibility, and scale cleanly as RPG adds customers, suppliers, terminals, indexes, and accounting integrations.
# 2. System Architecture at a Glance
| Layer | Function | Feeds Into |
|---|---|---|
| Pricing Engine | Daily base price → customer selling price via pricing rules | Dashboard, Margin Tracking, Invoicing |
| Market Intelligence | Index tracking + forecasting | Pricing decisions, Management Dashboard |
| Order Intake | Email capture + manual entry → review queue | Load Workflow, Customer Portal |
| Load & BOL Management | Supplier BOL ingestion, load status tracking | Billing, Margin Tracking |
| Customer Portal | External order/delivery visibility | Customer self-service |
| Billing / Invoicing | BOL + pricing → invoice → QuickBooks | Accounting, Profitability Reporting |
| Management Dashboard | Aggregates all layers | Executive decision-making |

# 3. Functional Modules
## Module A — Pricing
- Daily base fuel price entry/import
- Customer pricing rules: product, terminal, basis, margin/markup, freight, fees, contract vs. spot, effective dates
- Auto-calculated daily customer price dashboard
## Module B — Margin & Profit Tracking
- Expected vs. actual profit by customer/load
- Profit-per-gallon and totals (load, customer, day, week, month)
- Flags for low-margin/loss loads and cost variances
## Module C — Fuel Market Tracker
- Centralized dashboard for pricing indexes/benchmarks
- Current pricing, daily change, historical trend views
## Module D — Market Forecast / Price Predictor
- Next-day direction estimate (up / down / flat)
- Confidence level or probability using historical + market data
## Module E — Electronic BOL Integration
- Pull BOLs from participating suppliers/terminals
- Capture: BOL #, date/time, supplier, terminal, carrier, customer/destination, product, gross/net gallons, load reference, supplier cost, taxes, fees
## Module F — Daily Load & Billing Dashboard
- Workflow: BOL Received → Pricing Verified → Ready to Invoice → Invoiced → Paid
- Exception flags: missing BOLs, unassigned customers, missing/mismatched pricing, duplicate BOLs, uninvoiced loads
## Module G — Customer Load Tracking Portal
- Secure, customer-scoped login (own orders/loads only)
- Status milestones: Order Received → Order Confirmed → Carrier Confirmed → Loading/In Transit → Delivered
- Manual status updates by RPG staff, timestamped
- Displays: order #, product, gallons, delivery location, scheduled date, carrier info, delivered date/time
## Module H — Automated Order Intake from Email
- Parse incoming order emails/attachments
- Extract: customer, delivery location, product, gallons, requested date/time, PO/reference #, special instructions
- Route to review queue for staff verification before dispatch
- Approved orders flow into load workflow + portal automatically
## Module I — QuickBooks Integration & Automated Invoicing (future phase)
- Workflow: BOL Received → Customer Identified → Price Applied → Gallons Verified → Invoice Calculated → Management Approval → QuickBooks Invoice Created
- Management approval required before finalizing/sending
## Module J — Management Dashboard & Reporting
- Daily fuel prices, customer prices, market movement, forecast direction
- Orders in progress, loads delivered, loads awaiting billing
- Gallons sold, revenue, expected/actual gross profit, profit/gallon
- Customer profitability, operational exceptions
# 4. Phased Roadmap
| Phase | Focus | Core Deliverables | Depends On |
|---|---|---|---|
| Phase 1 | Pricing & Core Operations | Customer database, pricing rules engine, base price entry, auto customer pricing, margin calculations, basic reporting | — (foundation) |
| Phase 2 | Order Intake & Customer Portal | Email order capture, review queue, order status workflow, secure customer portal | Phase 1 (customer/pricing data) |
| Phase 3 | Market Intelligence | Index tracking, historical charts, daily movement alerts, forecasting/prediction model | Phase 1 (pricing dashboard to integrate with) |
| Phase 4 | Supplier & BOL Integration | Supplier/terminal connections, electronic BOL retrieval, load dashboard, customer matching, exception alerts | Phase 1 & 2 (customer + order data to match against) |
| Phase 5 | QuickBooks & Accounting | QuickBooks integration, invoice prep/approval, invoice creation, status sync, expanded profitability reporting | Phase 1, 2, 4 (needs pricing, orders, verified BOLs) |

Sequencing rationale: Pricing is the foundational data layer everything else references (margin calculations, invoicing, dashboards). Order intake and BOL integration can be parallelized in later stages since they are largely independent data sources, but both must land before invoicing logic (Phase 5) can be trusted end-to-end.
# 5. Cross-Cutting Considerations
- Data integrity checkpoints: duplicate BOL detection, pricing discrepancy flags, and missing-data alerts (Module F) should be built as reusable validation logic, not one-off checks — they recur in Phases 4 and 5.
- Access control: the customer portal (Module G) requires strict per-customer data isolation from day one of Phase 2, not retrofitted later.
- Audit trail: status changes (order + load) should be timestamped and immutable to support both customer trust and internal dispute resolution.
- Extensibility: pricing rules, supplier connections, and index sources should be config-driven, not hardcoded, since RPG explicitly plans to scale customers/suppliers/terminals/indexes.
- Approval gates: invoicing (Phase 5) explicitly requires human management approval before QuickBooks sync — this should be a hard gate in the workflow engine, not a soft warning.
# 6. Suggested Next Steps
- Confirm data sources available now for Phase 1 (existing customer list, current pricing methodology, index feeds RPG already subscribes to).
- Identify which supplier/terminal partners offer electronic BOL access (determines Phase 4 scope/complexity).
- Confirm QuickBooks version/edition in use (Online vs. Desktop materially changes Phase 5 integration approach).
- Decide on hosting/security requirements for the customer-facing portal (Phase 2) given it exposes data externally.
