# SaaS Readiness Audit — RPGCRM (Northstar AI CRM)

**Date:** 2026-09-16
**Scope:** the code in this repository as vendored from CopilotKit's `strands-crm`
showcase (upstream commit `7e6964f`, 2026-09-15) plus the Railway deployment
config added alongside this document.
**Method:** full read of the agent (`agent/`) and frontend (`frontend/`) source,
both test suites run (121 + 35 passing), a production build run and driven
through the UI against a mock LLM, and `npm audit` on both packages.
**Question answered:** what would it take to turn this demo into a multi-tenant
SaaS product that paying customers can sign up for?

---

## 1. Executive summary

**What you have today** is a polished single-tenant demo: one seeded SQLite
file, one Node process running one Strands agent, one hardcoded "signed-in"
user (Nathan Brooks), no authentication anywhere, and a UI whose create/edit
surfaces are mostly disabled placeholders. The parts that are genuinely strong
are the *agent experience layer*: the AG-UI wiring, the twelve agent tools,
the generative-UI cards, the human-in-the-loop follow-up approval, and the
workspace-navigation pattern. Those are worth keeping and building around.

**What has to be built essentially from scratch:** identity and tenancy, the
data layer, the security perimeter, billing, and operations. None of these are
partially present; they are absent.

**Headline verdict:** treat this as a UX prototype of the product, not as the
first version of the product. Expect to rewrite the store, the API routes, and
the agent's data access before the first external user, and to keep the
frontend components, tool definitions, and prompt design.

### Ten things you need before the first paying customer

1. **Authentication and organizations** (sign-up, login, sessions, org
   membership, roles). Nothing exists today; every route and the agent
   endpoint are public.
2. **A real multi-tenant database** (Postgres with a `tenant_id` on every
   table and scoped queries). Today: one SQLite file, no tenant concept,
   synchronous driver, no migrations, no backups.
3. **Tenant context threaded through the agent.** Today every tool imports a
   process-global `crm` singleton (`agent/src/crm/store.ts:559`), so all
   users would share one dataset.
4. **Authorization on tool calls and API routes.** Today the LLM can mark any
   deal won or edit any deal with no confirmation, and the quotes endpoint
   accepts any client-supplied subtotal.
5. **LLM cost controls**: per-tenant rate limits, token budgets, and usage
   metering. Today anyone with the URL can spend your OpenAI and Tavily budget.
6. **Real CRUD in the UI**: creating and editing deals, accounts, contacts, and
   products. Today "New deal", search, and settings are disabled controls.
7. **Scoped, paginated data loading** instead of shipping the entire CRM to
   the browser on every mutation.
8. **Billing** (Stripe subscriptions, plan limits, trials).
9. **Operations baseline**: CI, error tracking, structured logs, backups, a
   staging environment, dependency updates (Next.js has a critical advisory
   at the pinned version).
10. **Legal and trust basics**: privacy policy, terms, data deletion/export,
    and a sub-processor list (OpenAI, Tavily, Railway).

### Rough sizing

| Phase | Outcome | Rough effort (one experienced full-stack engineer) |
| --- | --- | --- |
| 0. Deploy the demo (done in this commit) | Railway, single tenant, seeded data | done |
| 1. Private beta, one real tenant | auth + orgs, Postgres, tenant scoping, real CRUD, CI, secrets, error tracking | 6–10 weeks |
| 2. Paid launch | billing, usage metering, email sending, audit log, backups, e2e tests, legal | 6–8 weeks |
| 3. Scale and differentiation | real-time sync, background jobs, per-tenant model config, evals, SOC 2 prep | ongoing |

These are estimates for planning, not commitments. The biggest uncertainty is
how much of the hardware-seller domain (product catalog, quote logic, stage
names) you keep versus generalize; see section 6.

---

## 2. Inventory: what exists today

| Area | Current state | Evidence |
| --- | --- | --- |
| Agent runtime | One `@strands-agents/sdk` `Agent` with a hardcoded system prompt and `gpt-5.4` via OpenAI; served over AG-UI by Express (`createStrandsApp`) | `agent/main.ts:21-29, 31-89` |
| Agent tools (12) | `move_stage`, `update_deal`, `brief_deal`, `mark_won`, `log_activity`, `search_web`, `enrich_lead`, `plan_pipeline`, `recommend_products`, `analyze_team`, `rep_performance`, `generate_weekly_report` | `agent/main.ts:70-87`, `agent/src/tools/*.ts` |
| Frontend tools (2) + HITL (1) | `navigate_to`, `focus_deal` run in the browser; `confirm_followup` is human-in-the-loop | `frontend/hooks/use-copilot-features.tsx:214-266` |
| Generative UI (7 cards) | enrichment, deal brief, pipeline priorities, quote, team handoff, rep stats, weekly report | `frontend/hooks/use-copilot-features.tsx:80-211` |
| State sync | Mutating tools push the **entire** CRM as a `STATE_SNAPSHOT`; the browser also fetches the entire CRM from `GET /api/crm` on mount and after each stage move | `agent/main.ts:93-124`, `frontend/hooks/use-crm.ts:19-43, 61-72` |
| Store | `node:sqlite` `DatabaseSync` (synchronous), one file, eight tables, JSON blobs in TEXT columns, seeded on first run | `agent/src/crm/db.ts`, `agent/src/crm/store.ts` |
| Direct-edit API | `GET /crm`, `POST /crm/deals/:id/stage`, `POST /crm/deals/:id/won`, `POST /crm/quotes` on the agent; proxied by three Next.js routes | `agent/src/routes.ts`, `frontend/app/api/crm/**` |
| Pages | dashboard, pipeline (drag-and-drop), products (category filter), accounts, contacts, team, reports (weekly/team), activity, quote detail | `frontend/app/**` |
| Identity | Avatar initials `NB` and the settings menu name are literals; "Sign out" is a disabled menu item | `frontend/components/TopBar.tsx:56-58`, `frontend/components/NavRail.tsx:219-229` |
| Tests | Agent: 14 files / 121 tests (store, routes, tools, analytics). Frontend: 2 files / 35 tests, pure lib functions only | `agent/src/**/__tests__`, `frontend/lib/*.test.ts` |
| CI / e2e | None. `@playwright/test` is a devDependency but no config or specs exist | `frontend/package.json:28` |
| Deployment | Dockerfiles + `railway.toml` for both services, volume-backed SQLite (added in this commit) | `agent/Dockerfile`, `frontend/Dockerfile`, `README.md` |
| Config surface | Agent: `OPENAI_API_KEY`, `TAVILY_API_KEY`, `PORT`, `NORTHSTAR_DB_PATH`, `MOCK_TAVILY`, `OPENAI_BASE_URL`, `OPENAI_API_MODE`. Frontend: `AGENT_URL` only | `agent/.env.example`, `frontend/app/api/**/route.ts` |

---

## 3. Gap analysis by area

Each area lists the current state with evidence, why it matters for a SaaS,
what you need, and a priority: **P0** = required before any external user,
**P1** = required before charging money, **P2** = needed to scale or sell
upmarket. Effort: S (days), M (1–3 weeks), L (a month or more).

### 3.1 Identity and access — P0, effort L

**Current state**

- No authentication, session, or login anywhere. No `middleware.ts` or
  `proxy.ts` in the frontend; every page and API route is public.
- The "signed-in" user is a convention in the seed data ("Nathan Brooks (the
  signed-in AE)", `agent/src/crm/seed.ts:336`) and a pair of string literals
  in the chrome (`TopBar.tsx:56-58`, `NavRail.tsx:219-224`).
- The CopilotKit provider passes no user properties, headers, or thread id
  (`frontend/app/layout.tsx:20-24`), so the agent has no idea who is talking.
- Deal ownership is display-only (`ownerName`/`ownerId` on deals); there is no
  "my deals" filter and no notion of who may edit what.

**Why it matters:** without identity there is no tenancy, no billing, no
audit trail, and no way to stop one customer from reading another's pipeline.

**What you need**

- An auth provider with organization support (Clerk, WorkOS, Auth.js with a
  custom org model, or Supabase Auth). Requirements: email/password plus OAuth,
  org creation, invitations, roles (owner, manager, rep), session management.
- Route protection in Next.js (`proxy.ts` in Next 16 terminology) for every
  page and API route.
- Identity forwarding to the agent on every run: CopilotKit `properties` or
  request headers → runtime → AG-UI `forwardedProps` → the Strands agent,
  where tools read `{tenantId, userId, role}` from the run context instead of
  a global.
- Service-to-service auth between the frontend and the agent (a shared secret
  header at minimum), so the agent's Express routes stop trusting any caller.

### 3.2 Multi-tenancy and data model — P0, effort L

**Current state**

- No `tenant_id`, `org_id`, or `user_id` on any table (`agent/src/crm/db.ts:31-109`).
- `CrmStore` is a module-level singleton (`store.ts:559`); every tool imports
  it directly (`agent/src/tools/deals.ts:4`, `activity.ts:4`, `enrich.ts:4`, …).
- Identifiers are short sequential strings (`d1`, `a6`, `act-N`, `q-N`, `rN`)
  minted by scanning for the current maximum (`store.ts:414, 535`,
  `tools/report.ts:35-42`). Two concurrent writers can mint the same id.
- No `createdAt`/`updatedAt` on deals, accounts, or contacts; no soft delete;
  no indexes beyond primary keys; no audit of who changed what.
- Denormalized `ownerName` on deals alongside `ownerId`.
- `lineItems`, `enrichment`, `metrics`, `highlights` are JSON strings in TEXT
  columns, which cannot be queried or constrained.
- Pipeline stages and product categories are fixed TypeScript unions
  duplicated in both packages (`agent/src/crm/types.ts:1-16, 81-86`,
  `frontend/lib/crm.ts:1-23`), with hardcoded Tailwind class maps per stage.
- Quotes have exactly one status, `"approved"` (`types.ts:161`).
- The seed data, the system prompt, and the recommendation heuristics are all
  specific to a fictional enterprise-hardware seller
  (`agent/main.ts:31`, `agent/src/tools/recommend.ts:112-140`).

**What you need**

- A tenant-scoped schema: `organizations`, `users`, `memberships`, and a
  `tenant_id` foreign key on every business table, enforced by either
  Postgres row-level security or a repository layer that refuses unscoped
  queries. Prefer both.
- UUIDs or ULIDs for all ids; `created_at`, `updated_at`, `created_by`,
  `deleted_at` on every table; indexes on `(tenant_id, …)` for every access path.
- Per-tenant configuration tables for pipeline stages, deal fields, product
  catalog, currency, and fiscal calendar, instead of code-level unions.
- Proper relational modeling of line items, enrichment sources, and report
  metrics, or at minimum JSONB with validation.
- A decision on domain scope (section 6): a generic CRM needs custom objects
  and fields; a vertical CRM for hardware resellers can keep the catalog model.

### 3.3 Database and storage — P0, effort M

**Current state**

- `node:sqlite` prints `ExperimentalWarning: SQLite is an experimental feature`
  on every start; the API is not yet stable.
- `DatabaseSync` is synchronous: every query blocks the event loop of the
  single agent process, including during LLM streaming.
- One writer, one file, one container. The Railway volume makes it durable but
  pins the service to one instance and one region; it cannot scale
  horizontally and has no point-in-time recovery.
- No migration tool; `initSchema` uses `CREATE TABLE IF NOT EXISTS`, so schema
  changes to existing columns have no path (`db.ts:31`).
- `getStateSnapshot()` reads all eight tables in full on every call
  (`store.ts:233-275`); it is invoked by every mutating tool via `pushState`
  and by every `GET /crm`.

**What you need**

- Managed Postgres (Railway Postgres, Neon, or Supabase) with automated
  backups and PITR.
- A migration tool and typed query layer (Drizzle or Prisma). Drizzle is the
  lighter fit for the current hand-written SQL style.
- Connection pooling suitable for a long-running Node service.
- Replace snapshot-everything with scoped queries (per tenant, per view) and
  cursor pagination.
- Keep SQLite for tests only (`process.env.VITEST ? ":memory:"`,
  `store.ts:230`) or move tests to a Postgres test container so the test
  dialect matches production.

### 3.4 API surface and security — P0, effort M

**Current state**

- The agent's Express app enables CORS for any origin by default
  (`corsOrigin: true` in `@ag-ui/aws-strands/server`), and its AG-UI endpoint
  (`POST /`) plus the four CRM routes are unauthenticated
  (`agent/src/routes.ts`). On Railway the agent is private, but the frontend's
  `/api/copilotkit` and `/api/crm/*` routes are public and forward to it, so
  the exposure is the same.
- `POST /crm/quotes` trusts client-supplied `subtotal` and `lineItems` and
  persists the quote with status `"approved"` (`routes.ts:39-72`). Anyone can
  create an approved quote with any numbers.
- `POST /crm/deals/:id/stage` and `/won` validate the stage string but nothing
  about the caller (`routes.ts:16-34`).
- No rate limiting, no request size limits beyond Express defaults, no CSRF
  protection, no security headers or CSP (`frontend/next.config.ts` is empty).
- Product photos and rep avatars are rendered with plain `<img>` from
  data-supplied URLs (`frontend/components/DealCard.tsx:34`,
  `QuoteCard.tsx:80`, `app/quotes/[id]/page.tsx:141`). Once tenants can edit
  those URLs, this becomes a vector for tracking pixels and mixed content.
- Enrichment links open with `target="_blank"` and no explicit
  `rel="noopener noreferrer"` (`EnrichmentCard.tsx:56,77`,
  `AccountResearch.tsx:45`). Modern browsers imply `noopener`, so this is
  hygiene rather than a live hole.
- Dependency advisories at the pinned versions (`npm audit`, 2026-09-16):
  agent 13 (7 high), frontend 36 (1 critical, 9 high). The critical one is
  Next.js 16.2.7 (fixed in 16.3.5): a proxy/middleware bypass and a Server
  Actions denial of service. This app currently uses neither middleware nor
  Server Actions, so the practical impact today is low, but it must be
  patched before launch.
- Error messages from the store are returned to clients verbatim
  (`routes.ts:24, 32`), including internal ids.

**What you need**

- Authentication on every route (3.1) and a service secret between frontend
  and agent; lock CORS to the frontend origin.
- Server-side validation of every mutation with a schema library (zod is
  already a transitive dependency of both packages) and server-side
  recomputation of derived values such as quote totals.
- Rate limiting per user and per tenant on the copilot endpoint and on
  enrichment, since both spend money.
- Security headers (CSP, HSTS, frame-ancestors), `next/image` with an allowlist
  or a media-upload service for images, sanitized error responses.
- A dependency update policy: Dependabot or Renovate, `npm audit` in CI,
  and an immediate bump of `next` to the patched line.
- Secrets in Railway variables only (already the case), with rotation
  documented.

### 3.5 Agent and LLM layer — P0 for cost controls, P1 for the rest; effort M–L

**Current state**

- One `Agent` instance is constructed at boot with a static system prompt that
  names the company, the product categories, and the demo deals
  (`agent/main.ts:31-68`). The AG-UI bridge clones it per thread, but the
  prompt and tools are identical for everyone.
- `stateContextBuilder` appends **every deal in the database** to every
  prompt (`agent/main.ts:114-124`). With six accounts this is a few lines;
  with a real tenant it is thousands of tokens per turn and grows linearly.
- The model is hardcoded (`modelId: "gpt-5.4"`, `main.ts:23`); there is no
  per-tenant model choice, no fallback provider, and no way to route a tenant
  to Bedrock even though the Strands SDK supports it.
- No token or cost accounting, no per-tenant budget, no per-user rate limit,
  no output length limits.
- Tool authorization is absent: `mark_won`, `update_deal`, `move_stage`, and
  `log_activity` execute whatever the model decides with no confirmation
  (`agent/src/tools/deals.ts`, `activity.ts`). The only human-in-the-loop step
  is `confirm_followup` for emails (`frontend/hooks/use-copilot-features.tsx:214`).
- Prompt-injection surface: `enrich_lead` writes web-search content into the
  account record (`agent/src/tools/enrich.ts:61-72`), which is then rendered
  in the UI and available to later prompts. A prospect's website can therefore
  influence what the copilot says and does about that prospect.
- Conversation history lives only in the browser session; nothing persists
  threads, so users lose context on reload and there is no history to audit.
- No tracing or evaluation: no per-run logs of prompts, tool calls, latency,
  or cost, and no regression suite for agent behavior. The upstream repo uses
  the `aimock` fixture server for deterministic tests, and this repository's
  agent already honors `OPENAI_BASE_URL` and `OPENAI_API_MODE=chat` for that
  purpose (`main.ts:24-28`).
- The follow-up flow does not send email; on approval the agent only logs an
  activity (`main.ts:67-68`).

**What you need**

- Run context: tenant, user, role, and plan passed into every run and read by
  every tool (replaces the `crm` singleton import).
- A tenant-aware prompt builder: company name, custom stage names, and a
  *summary* of the pipeline (counts, top N by value or risk) instead of the
  full list; retrieval for specifics.
- Budgets and metering: count tokens per run (the OpenAI responses include
  usage), store them per tenant, enforce plan limits, and expose usage to
  billing (3.9).
- Authorization inside tools: check the acting user's role before mutations,
  require HITL for destructive or high-value changes (closing deals, editing
  amounts above a threshold), and log every tool call to an audit table.
- Injection hardening: treat enrichment text as untrusted (delimit it in
  prompts, never let it carry instructions), constrain `search_web` queries,
  and consider a moderation pass on stored web content.
- Persisted threads and messages per tenant, with retention rules.
- Observability: structured per-run traces (prompt, tools, tokens, latency,
  errors) to a tool such as Langfuse, Braintrust, or OpenTelemetry, plus a
  fixture-based eval suite for the core prompts.
- Provider strategy: keep the model behind a config value per tenant; the
  Strands SDK makes Bedrock a drop-in if you need a second provider or region.

### 3.6 Real-time and state synchronization — P1, effort M

**Current state**

- Two whole-CRM channels feed the UI: `STATE_SNAPSHOT` from the agent on every
  mutating tool (`agent/main.ts:93-112`) and `GET /api/crm` on mount and after
  each drag-and-drop move (`frontend/hooks/use-crm.ts:27-34, 61-72`). The quote
  page fetches the entire CRM to find one quote (`app/quotes/[id]/page.tsx:26`).
- A second user's change is invisible until you reload or mutate something
  yourself; there is no push channel for board updates.
- Every analytic is recomputed client-side over all deals on every render,
  mostly unmemoized; several are O(reps × deals) (`frontend/lib/crm.ts:379-401,
  416-445, 458-484`). List pages render every row with no virtualization.
- Optimistic stage moves are handled with an overlay (`use-crm.ts:25, 57-60`),
  which is a good pattern to keep.

**What you need**

- Scoped queries per view (board by stage with limits, paginated lists,
  server-computed KPIs), and agent state deltas limited to what changed.
- A push mechanism for multi-user boards: Postgres LISTEN/NOTIFY or a hosted
  realtime service surfaced over SSE or WebSocket, with a polling fallback.
- Memoization and virtualization on the frontend once lists exceed a few
  hundred rows.
- One source of truth for analytics: today `frontend/lib/crm.ts` mirrors
  `agent/src/crm/analytics.ts` by hand (`lib/crm.ts:268`), which will drift.
  Compute on the server and ship numbers.

### 3.7 Frontend product gaps — P0 for basic CRUD, P1 for the rest; effort L

**Current state** (all verified in source)

- Disabled: "New deal" (`TopBar.tsx:48-53`, tooltip "Coming soon"), search
  (`TopBar.tsx:37-41`), Preferences / Theme / Sign out (`NavRail.tsx:226-229`).
- Deal drawer is read-only except for the stage dropdown
  (`DealDrawer.tsx:115-216`); no way to create or edit accounts, contacts,
  activities, products, or reps in the UI.
- The `Add to deal` action on quote cards exists as a prop but is never wired
  (`QuoteCard.tsx:36,131-135` vs `use-copilot-features.tsx:139-145`).
- Contacts rows are not clickable (`app/contacts/page.tsx:38-43`); "Open" on a
  priority card always routes to the dashboard rather than the pipeline
  (`use-copilot-features.tsx:47-50`).
- Drag-and-drop is HTML5 only (no touch or keyboard path;
  `PipelineBoard.tsx:29-42`).
- Suggestion pills and the system prompt hardcode demo content such as
  "Research CopilotKit" (`use-copilot-features.tsx:269-287`).
- No settings surface for a tenant (users, stages, catalog, branding), no
  onboarding, no empty states for a tenant with no data, no CSV import/export,
  no mobile layout audit, no i18n, single currency and locale (`en-US` formatting
  in `lib/crm.ts` and `tools/report.ts:23-31`).

**What you need**

- CRUD forms for every object, with server-side validation and optimistic UI.
- Tenant settings (members, roles, stages, fields, catalog, branding).
- Onboarding and import (CSV, and later HubSpot/Salesforce/Pipedrive imports).
- Global search backed by the database (Postgres full-text is enough to start).
- Accessibility and mobile passes on the board and the assistant panel.
- Replace demo-specific copy with tenant-derived suggestions.

### 3.8 Integrations — P1, effort M each

- **Email**: approving a follow-up logs an activity; nothing is sent. You
  need a sending provider (Resend, SendGrid, Postmark) or mailbox OAuth
  (Gmail, Microsoft 365) plus reply tracking if you want threads in the CRM.
- **Calendar and meetings**: none.
- **Enrichment**: Tavily is called with your single key for all tenants
  (`agent/src/tavily.ts:11-21`). You need per-tenant metering or bundled
  quotas, and probably a firmographic provider in addition to web search.
- **Quotes**: no PDF export, no e-signature, no link to an order or invoice.
- **Public API and webhooks** for customers: none. The existing Express routes
  are internal helpers, not an API.

### 3.9 Billing and plans — P1, effort M

Nothing exists. You need Stripe (Checkout, Customer Portal, webhooks), a
`subscriptions` table tied to organizations, plan definitions (seats, AI
turns per month, enrichment credits), entitlement checks in the request
path and in the agent, trials, dunning, and usage records fed from the
metering in 3.5. Decide early whether AI usage is bundled per seat or metered;
it changes the data you must capture per run.

### 3.10 Operations and reliability — P0 for CI/errors/backups, P1 for the rest; effort M

**Current state**

- No CI (no `.github/` directory), no linting or tests on push, no e2e suite.
  The root `npm test` runs only the agent's tests (`package.json:11`).
- No error tracking, no structured logging (only `console`), no metrics, no
  tracing. The agent has no dedicated health endpoint; the Railway health
  check uses `GET /crm`, which also serializes the whole database.
- Single instance per service, single region, no staging environment.
- CopilotKit's runtime sends anonymous telemetry by default
  (set `COPILOTKIT_TELEMETRY_DISABLED=true` on the frontend service if you
  don't want that). Next.js telemetry is disabled in the Dockerfile.
- Backups depend on the Railway volume; there is no application-level export.

**What you need**

- GitHub Actions: install, lint, typecheck, unit tests, `npm audit`, and a
  Playwright e2e run against `aimock` fixtures on every PR; build the Docker
  images in CI so a Railway build never fails first.
- Sentry (or equivalent) on both services, structured JSON logs with request
  and tenant ids, uptime checks, and a lightweight `/health` route on the agent.
- Staging and production environments in Railway with separate databases.
- Managed Postgres backups plus a scheduled export; a documented restore drill.
- Release process: migrations run before deploy, feature flags for risky
  changes, rollback plan.

### 3.11 Compliance and trust — P1, effort S–M initially

- Privacy policy, terms of service, and a DPA template; a sub-processor list
  (OpenAI, Tavily, Railway, your auth and email providers).
- GDPR/CCPA mechanics: per-tenant data export and deletion, retention rules for
  chat threads and enrichment data, consent language for AI features.
- Encryption in transit (Railway provides TLS on public domains; the private
  network is internal) and at rest (managed Postgres; verify for volumes).
- An audit log of user and agent actions (also needed for support).
- SOC 2 only when enterprise buyers ask; design the logging and access
  controls now so it is not a rewrite later.

### 3.12 Testing and quality — P0 for CI wiring, P1 for coverage; effort M

- Existing coverage is good for pure logic: store, routes, tools, analytics,
  prioritization, quotes on the agent; analytics and navigation helpers on the
  frontend.
- Missing: hook tests (`use-crm.ts`, `use-copilot-features.tsx`), component
  tests, API route tests on the Next.js side, any end-to-end test, and any
  test of an actual agent run. The frontend vitest config only includes
  `lib/**/*.test.ts` (`frontend/vitest.config.ts:3`).
- Add: e2e flows against `aimock` (this session's fixtures for four prompts are
  a starting point), contract tests that pin the tool schemas the frontend
  renders against, and Postgres-backed store tests once the database moves.

---

## 4. Target architecture for the SaaS version

```
Browser
  │  session cookie (auth provider)
  ▼
Next.js (frontend service)            ── keeps: pages, components, generative UI,
  ├─ proxy.ts: auth + tenant resolve        frontend tools, HITL, CopilotKit wiring
  ├─ /api/copilotkit  → CopilotRuntime → HttpAgent (adds tenant/user props + service secret)
  ├─ /api/crm/*       → scoped, validated handlers (or move to the agent service)
  └─ server-side data loaders (scoped queries, pagination, computed KPIs)
        │
        ▼
Agent service (Express + Strands over AG-UI)   ── keeps: tool definitions, prompt design,
  ├─ auth middleware (service secret, tenant context)   pushState pattern (scoped deltas)
  ├─ Agent factory per run: prompt built from tenant config + pipeline summary
  ├─ tools receive {tenantId, userId, role}; authorization + audit inside
  ├─ usage metering (tokens, enrichments) → billing
  └─ tracing (per-run spans) → Langfuse / OTel
        │
        ▼
Postgres (managed)                    ── replaces SQLite
  organizations · users · memberships · deals · accounts · contacts · activities
  products · quotes · reports · threads · messages · tool_calls · usage · audit_log
  (tenant_id everywhere, RLS or repository scoping, migrations via Drizzle)

Side services: Stripe (billing) · email provider · Tavily/enrichment · object storage
               (avatars, photos, PDFs) · Redis or Postgres queue for background jobs
```

**Keep:** the CopilotKit + AG-UI + Strands stack, the tool-first agent design,
the generative UI cards, HITL approval, workspace navigation as a frontend
tool, the optimistic stage overlay, the test style in `agent/src/**/__tests__`.

**Replace:** the SQLite store and singleton, the whole-snapshot sync, the
unauthenticated routes, the hardcoded identity, the static system prompt,
the duplicated analytics.

---

## 5. Phased roadmap

**Phase 0 — Deployed demo (this commit).** Railway, two services, volume-backed
SQLite, mock-able LLM. Purpose: show the experience, gather feedback. Do not
share the URL publicly for long; it has no authentication and spends your API
keys.

**Phase 1 — Private beta with one real tenant (yourself or a design partner).**
1. Auth provider with organizations; protect every route; forward identity to the agent.
2. Postgres + migrations; port the schema with `tenant_id`, UUIDs, timestamps; port `CrmStore` to a repository that takes tenant context.
3. Remove the `crm` singleton from tools; build the agent per run with tenant config.
4. Real CRUD for deals, accounts, contacts; global search; tenant settings.
5. Service secret between services; lock CORS; validation on every mutation; bump Next.js.
6. CI with tests and audit; Sentry; structured logs; staging environment.
7. Per-user rate limits and a per-tenant AI budget (hard cap) so a beta tenant cannot surprise you on cost.

**Phase 2 — Paid launch.**
1. Stripe subscriptions, plans, entitlements, trial, customer portal.
2. Usage metering surfaced to customers (AI turns, enrichments).
3. Email sending integration for follow-ups; activity threading.
4. Audit log, data export and deletion, legal documents, sub-processor list.
5. Backups verified with a restore drill; e2e suite gating deploys.
6. Onboarding, empty states, CSV import.

**Phase 3 — Scale and differentiation.**
1. Realtime board updates; background jobs for enrichment and reports.
2. Per-tenant model routing (OpenAI vs Bedrock), prompt versioning, evals.
3. Public API and webhooks; mailbox and calendar sync.
4. Custom objects/fields if you go horizontal; deeper catalog and quoting if you stay vertical.
5. SOC 2 readiness.

---

## 6. Decisions to make early

1. **Vertical or horizontal?** The product catalog, `recommend_products`
   heuristics, quote model, and system prompt are all built for a hardware
   reseller. Staying vertical keeps most of that logic; going horizontal means
   custom objects, custom fields, and a generic quoting model, which is a
   larger data-model change than everything else in this document combined.
2. **Auth provider.** Clerk or WorkOS if you want orgs, invitations, and SSO
   handled for you; Auth.js or Supabase if you want to own it.
3. **Database host.** Railway Postgres keeps everything in one project; Neon
   or Supabase give branching and a larger managed feature set.
4. **AI pricing model.** Bundled per seat with a fair-use cap, or metered
   turns/credits. This decides what you must record per run from day one.
5. **LLM provider strategy.** OpenAI only, or OpenAI plus Bedrock via Strands
   for enterprise/regional requirements.
6. **Enrichment sourcing.** Keep Tavily web search, add a firmographic API,
   or both; each has per-call cost that must map to a plan.
7. **Region and residency.** Railway region selection plus where OpenAI and
   Tavily process data; EU customers will ask.

---

## Appendix A — Security findings (ordered by severity)

| # | Severity | Finding | Location |
| --- | --- | --- | --- |
| 1 | Critical | No authentication on any page, API route, or the agent endpoint | whole app |
| 2 | High | Unbounded LLM and enrichment spend by anonymous callers | `frontend/app/api/copilotkit/route.ts`, `agent/src/tools/enrich.ts` |
| 3 | High | Quotes endpoint persists client-supplied totals as approved | `agent/src/routes.ts:39-72` |
| 4 | High | Agent tools mutate data with no authorization or confirmation | `agent/src/tools/deals.ts`, `activity.ts` |
| 5 | High | Next.js 16.2.7 has a critical advisory (fixed in 16.3.5); other high advisories in transitive deps | `frontend/package.json`, `npm audit` |
| 6 | Medium | Untrusted web content stored into records and re-fed to the model (prompt injection) | `agent/src/tools/enrich.ts:61-72` |
| 7 | Medium | CORS open to any origin on the agent; no security headers on the frontend | `@ag-ui/aws-strands/server` defaults, `frontend/next.config.ts` |
| 8 | Medium | Data-supplied image URLs rendered without an allowlist | `DealCard.tsx:34`, `QuoteCard.tsx:80`, `quotes/[id]/page.tsx:141` |
| 9 | Low | Internal error messages returned verbatim | `agent/src/routes.ts:24,32` |
| 10 | Low | `target="_blank"` links without explicit `rel="noopener noreferrer"` | `EnrichmentCard.tsx:56,77`, `AccountResearch.tsx:45` |
| 11 | Low | Anonymous telemetry on by default in the CopilotKit runtime | frontend service env |

## Appendix B — Dependency audit snapshot (2026-09-16)

| Package | Total | Critical | High | Notes |
| --- | --- | --- | --- | --- |
| agent | 13 | 0 | 7 | axios, fast-uri, form-data, hono, ip-address, nanoid, postcss (all transitive; fixes available) |
| frontend | 36 | 1 | 9 | `next` 16.2.7 → 16.3.5 fixes the critical and two highs; brace-expansion, browserslist, js-yaml, sharp, etc. |

Run `npm audit` in each package for the current list; these counts will drift.

## Appendix C — What was verified for this audit

- Agent tests: 14 files, 121 tests passing. Frontend tests: 2 files, 35 tests passing.
- Production build: `next build` succeeds; `next start` on the frontend and
  `npm start` (tsx) on a production-only install of the agent serve the app,
  and four scripted copilot flows (navigate, enrich, prioritize, team report)
  complete through the real UI against a mock OpenAI server.
- Docker images were not built in the audit environment (base image pulls are
  blocked there); the Dockerfiles replicate exactly the commands above.
