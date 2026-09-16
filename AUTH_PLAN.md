# Authentication Plan — RPGCRM

**Date:** 2026-09-16
**Status:** Phase 1 (staff sign-in, sessions, route protection, identity in the agent) is built with built-in accounts; Phases 2 to 4 are open
**Scope:** sign-in, sessions, route protection, passing the signed-in user to
the agent, a minimal user model, and the hooks the later multi-tenant work
needs. Organizations and tenant-scoped data are designed for here but built
in [SAAS_AUDIT.md](./SAAS_AUDIT.md) Phase 1 alongside the Postgres move.

---

## 0. Status update: staff sign-in (Phase 1) and portal accounts are built

### Staff sign-in, Phase 1 ("lock the door"): built 2026-09-16

The outcome the phase asked for holds: nobody reaches a page, an API route,
or the agent without a valid session, and the demo-user literals and the
"acting as" switcher are gone. It shipped with the plan's allowed fallback,
built-in accounts instead of Clerk, because no provider keys or network were
available and the same accounts already existed for the portal:

- **Accounts.** `staff` rows carry scrypt password hashes with per-user salts
  (`agent/src/services/passwords.ts`, shared with the portal). The seed and a
  startup migration give existing databases credentials with the demo password
  (`RPGstaff!2026`) or `STAFF_BOOTSTRAP_PASSWORD`. Users change their own
  password from the user menu; the change revokes their other sessions.
- **Sessions.** `POST /auth/login` issues an opaque 32-byte token stored in
  `staffSessions` (7 days, last-seen tracking, purge on sign-in); five failed
  attempts lock an email for 15 minutes; failures return one generic message.
- **Agent gate.** `staffAuthGate` (`agent/src/services/staffAuth.ts`) runs
  before the AG-UI endpoint and every `/ops` and `/auth` route except sign-in;
  `/ping` and `/portal/*` stay public. A valid bearer session runs the request
  inside an `AsyncLocalStorage` context, so REST handlers and copilot tools
  attribute mutations with `currentActor()`; `x-actor-id` and CopilotKit
  `properties` are no longer read. `currentActor()` throws outside a signed-in
  request, so nothing is attributed to a default user.
- **Frontend.** `frontend/proxy.ts` redirects pages to `/login` (with `next`)
  and answers API routes with 401 when the cookie is missing; the workspace
  layout re-verifies the cookie against `GET /auth/me` on every page load and
  hands the verified user to the chrome and approval cards. `/api/auth/*`
  keep the token in an httpOnly, SameSite=Lax, Secure cookie; `/api/ops/*`
  and `/api/copilotkit` attach it as the bearer server-side (the CopilotKit
  runtime forwards the request's `Authorization` header to the cloned
  `HttpAgent`, so no `AuthedAgent` subclass was needed). `/api/health` is the
  Railway health check.
- **Roles.** Approval gates read the session's role; the demo reset needs
  `admin`; the chrome shows the signed-in user with sign-out and password
  change.
- **Tests.** Agent: staff-auth unit tests (lockout, expiry, disabled accounts,
  password change, migration, context propagation) and route tests for the
  gate; Playwright: anonymous redirect and 401s, sign-in, a copilot mutation
  attributed to the signed-in user, forged header ignored, role refusal,
  password change, sign-out, portal still public.

Deviations from the plan: no `AGENT_SHARED_SECRET` (the agent verifies the
session itself, which is stronger than trusting the network boundary) and no
Clerk (sign-up is closed by construction: accounts exist only in the store).
Swapping in Clerk later touches `frontend/app/api/auth/*`, `proxy.ts`, and the
gate's token verification; nothing else sees more than a verified
`{ id, name, email, role }`.

Still open for staff: password reset and invitations by email, an admin
screen for accounts and roles, a persistent lockout store for multiple
replicas, security headers and a login rate limit (Phase 4), SSO/MFA.
INTEGRATIONS.md section 4.1 lists the steps to an 8/10.

### Customer portal accounts: built

The customer-facing half of this plan shipped ahead of the staff half. The
portal (Module G) now has email + password accounts instead of per-customer
token links:

- Accounts live in the agent store (`portalUsers`, one per customer, seeded for
  the ordering contact; passwords are scrypt hashes with per-user salts).
- Sign-in issues an opaque 32-byte session token stored server-side
  (`portalSessions`, 7-day life, last-seen tracking, expired sessions purged).
  The Next.js route `/api/portal/login` keeps the token in an httpOnly,
  SameSite=Lax cookie (Secure in production); the browser never handles it.
- Five failed attempts lock an email for 15 minutes; failures return one
  generic message so accounts cannot be enumerated.
- `/portal/me` resolves the session and returns only that customer's orders,
  deliveries, and invoices. The staff snapshot exposes portal accounts with
  credentials blanked and never includes sessions.
- Old `/portal/<token>` links redirect to `/portal/login`.

Still open for the portal: self-service password reset (today: sales resets it),
invitations from the Customers page, and moving the lockout counter out of
process memory when the agent runs more than one replica.

Sections 1 to 8 below are the original plan, kept for the Phase 2 to 4 work;
section 1 describes the state before Phase 1 shipped.

## 1. Where we are

Today the deployed app has no authentication at all:

- Every page and API route is public. There is no `proxy.ts`/`middleware.ts`
  in `frontend/`, and none of the four route handlers read a session
  (`frontend/app/api/copilotkit/route.ts`, `frontend/app/api/crm/**`).
- The agent's Express app accepts any caller on its AG-UI endpoint and CRM
  routes (`agent/main.ts:128-129`, `agent/src/routes.ts`). It is private on
  Railway, but the public frontend forwards to it unauthenticated.
- The "signed-in user" is a pair of string literals: the `NB` avatar in
  `frontend/components/TopBar.tsx:56-58` and "Nathan Brooks" in
  `frontend/components/NavRail.tsx:219-224`. "Sign out" is a disabled item.
- The copilot has no idea who is talking: `<CopilotKit>` in
  `frontend/app/layout.tsx:20-24` passes no identity, and tools import a
  process-global store (`agent/src/crm/store.ts:559`).

Consequence: anyone with the URL can read the whole pipeline, mutate it, and
spend the OpenRouter balance. Authentication is the first item in the audit's
launch-blocker list, and everything in this plan is a prerequisite for
billing, tenancy, and an audit trail.

## 2. Decision: Clerk, with Auth.js as the fallback

| Option | Fits this codebase | Orgs, invites, roles | Cost of ownership | Verdict |
| --- | --- | --- | --- | --- |
| **Clerk** (`@clerk/nextjs`, supports Next 16) | Drop-in provider, prebuilt sign-in UI, `auth()` in route handlers, `clerkMiddleware()` in the proxy file | Built in (Organizations) | Hosted; free tier covers a beta, paid per MAU after | **Recommended** |
| Auth.js (`next-auth`) | Good Next.js fit, but sessions, user tables, and email flows are yours | You model orgs, invitations, and roles yourself | Zero vendor cost, roughly a week more work | Fallback if you want no third party |
| WorkOS AuthKit | Similar to Clerk with stronger enterprise SSO | Built in | Hosted; enterprise-oriented pricing | Revisit when a customer asks for SSO |
| Supabase Auth | Best if you also adopt Supabase Postgres | Basic | Hosted with the database | Only if Supabase wins the database decision in the audit |

Reasoning: the SaaS roadmap needs organizations, invitations, and roles
within weeks, and Clerk gives all three without building them. Nothing below
locks you in beyond the provider layer: the agent only ever sees a verified
`{ userId, orgId, role }` triple, so swapping the provider later touches the
frontend only.

## 3. Target architecture

```
Browser ──(Clerk session cookie)──▶ Next.js frontend
   │                                  ├─ proxy.ts: clerkMiddleware() protects every route
   │                                  │   except /sign-in, /sign-up, /api/health
   │                                  ├─ pages: <ClerkProvider>, <UserButton/>, real user in the chrome
   │                                  ├─ /api/copilotkit and /api/crm/*: await auth.protect()
   │                                  └─ agent client: adds service secret + identity headers
   │                                       Authorization: Bearer $AGENT_SHARED_SECRET
   │                                       X-User-Id / X-User-Email / X-User-Role / X-Org-Id
   ▼                                                    │  (private network)
                                                        ▼
                                   Agent (Express + Strands over AG-UI)
                                     ├─ auth middleware: reject without the secret (401)
                                     ├─ AsyncLocalStorage request context {userId, email, role, orgId}
                                     ├─ prompt: "Acting user: <name> (<role>)"
                                     ├─ tools: read the context; authorization + audit rows
                                     └─ GET /ping stays public for the Railway health check
```

Why headers plus a shared secret rather than verifying Clerk tokens in the
agent: the agent is only reachable over Railway's private network, the
frontend is the single caller, and the route handlers already had to verify
the session to build the headers. Phase 4 upgrades the headers to a signed,
short-lived token so the agent no longer relies on the network boundary.

Why identity is attached server-side: anything the browser sends to
`/api/copilotkit`, including CopilotKit's `properties` prop, is under the
user's control. The agent must only trust identity that a route handler
derived from a verified session.

## 4. Phases

### Phase 1 — Lock the door (1–2 days)

Outcome: nobody reaches a page, an API route, or the agent without a valid
session; the demo user literals are gone.

Frontend (`frontend/`):

1. `npm install @clerk/nextjs`. Add `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` and
   `CLERK_SECRET_KEY` to the Railway `frontend` service.
2. Add `frontend/proxy.ts` (Next 16's name for the request middleware file;
   `middleware.ts` still works but is deprecated):

   ```ts
   import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";

   const isPublic = createRouteMatcher(["/sign-in(.*)", "/sign-up(.*)", "/api/health"]);

   export default clerkMiddleware(async (auth, req) => {
     if (!isPublic(req)) await auth.protect();
   });

   export const config = {
     matcher: ["/((?!_next|.*\\..*).*)", "/(api|trpc)(.*)"],
   };
   ```

3. Wrap the tree in `<ClerkProvider>` in `frontend/app/layout.tsx`, add
   `app/sign-in/[[...sign-in]]/page.tsx` and `app/sign-up/[[...sign-up]]/page.tsx`
   rendering Clerk's `<SignIn/>` and `<SignUp/>`.
4. In the four route handlers call `const { userId, orgId, orgRole } = await auth.protect();`
   before doing anything else. Return 401 JSON rather than a redirect for API
   routes (Clerk does this when the request is not a navigation).
5. Replace the `NB` avatar with `<UserButton/>` and the hardcoded name/email
   in the settings menu with `useUser()` data; wire "Sign out" to
   `<SignOutButton/>`.
6. Add `app/api/health/route.ts` returning `{ ok: true }` and move the Railway
   health check for `frontend` from `/` to `/api/health`, since `/` now
   redirects to sign-in.
7. In the Clerk dashboard set sign-up mode to **Restricted** (invitation or
   allowlist) so the public URL does not become an open registration form.

Agent (`agent/`):

8. Build the Express app explicitly instead of `createStrandsApp`, so an auth
   middleware runs before the AG-UI endpoint. The server helper already
   exports the pieces (`addStrandsExpressEndpoint`, `addPing`):

   ```ts
   import express from "express";
   import cors from "cors";
   import { addStrandsExpressEndpoint, addPing } from "@ag-ui/aws-strands/server";

   const app = express();
   app.use(cors({ origin: false }));          // server-to-server only
   app.use(express.json({ limit: "50mb" }));
   addPing(app, "/ping");                      // public: Railway health check
   app.use(requireServiceSecret);              // 401 unless Authorization matches
   app.use(attachRequestContext);              // parses X-User-* into AsyncLocalStorage
   addStrandsExpressEndpoint(app, aguiAgent, { path: "/" });
   registerCrmRoutes(app);
   ```

9. `AGENT_SHARED_SECRET`: a 32-byte random value set on both Railway services
   (`openssl rand -hex 32`). Compare with a constant-time check.
10. Point the `agent` health check at `/ping` instead of `/crm`, which is now
    behind the secret.

Frontend → agent client:

11. Add `frontend/lib/agent-client.ts` with one `agentHeaders(identity)`
    helper used by the three `/api/crm/*` routes (plain `fetch`) and by the
    copilot route.
12. For `/api/copilotkit`, keep the runtime at module scope (per-request
    construction has caused races in other CopilotKit apps) and inject
    headers per request by subclassing the AG-UI client, which exposes a
    `requestInit(input)` hook, with the identity read from an
    `AsyncLocalStorage` that the route handler populates:

    ```ts
    class AuthedAgent extends HttpAgent {
      protected requestInit(input: RunAgentInput): RequestInit {
        const base = super.requestInit(input);
        return { ...base, headers: { ...(base.headers as Record<string, string>), ...identityHeaders() } };
      }
    }
    // in POST: return identityStore.run(identity, () => handleRequest(req));
    ```

Railway:

13. Set the Clerk keys on `frontend`, `AGENT_SHARED_SECRET` on both, update
    the two health-check paths, and mirror all of it in `.railway/railway.ts`
    (secrets as `preserve()`).

Acceptance:

- Unauthenticated `GET /`, `GET /pipeline`, `GET /api/crm` on the public
  domain return a redirect or 401. Signed in, everything works as today.
- `POST http://agent.railway.internal:8000/` without the secret returns 401
  (re-run the chat probe from the deployment session to confirm).
- The chrome shows the real user; Sign out works; the `NB` literal is gone.
- Tests: a unit test for the agent middleware (missing, wrong, right secret)
  and one for header parsing; existing 121 + 35 tests still pass.

### Phase 2 — Identity inside the agent (2–3 days)

Outcome: the copilot knows who it is helping, records who did what, and
refuses actions the user's role does not allow.

1. `agent/src/auth/context.ts`: `AsyncLocalStorage<RequestContext>` with
   `currentUser()`; populated by the middleware from Phase 1.
2. `stateContextBuilder` in `agent/main.ts` appends one line to every prompt:
   `Acting user: <name> (<role>, id <userId>)`, so "my deals" and "assign to
   me" resolve correctly.
3. `users` table in the store: `id` (Clerk user id), `email`, `name`, `role`
   (`rep` | `manager` | `admin`), `salespersonId` (nullable link to the seeded
   reps so the demo data keeps working), `createdAt`, `lastSeenAt`. Upsert on
   every authenticated request; later replaced by the Clerk webhook sync.
4. Authorization v1 inside tools, not in the prompt: `move_stage`,
   `update_deal`, `mark_won`, `log_activity` check that the acting user owns
   the deal or has the `manager` role; otherwise return a structured refusal
   the UI can render. `mark_won` and amount changes above a threshold go
   through a `confirm_deal_change` human-in-the-loop step, mirroring the
   existing `confirm_followup` pattern.
5. `audit_log` table (`actorId`, `action`, `targetType`, `targetId`,
   `payload`, `at`) written by the middleware for every mutating tool call
   and CRM route. This is also the first piece of the audit's compliance work.
6. Per-user rate limit on `/api/copilotkit` and on `enrich_lead`: a token
   bucket keyed by `userId`, in-memory while the frontend runs one replica,
   Upstash or a Railway Redis when it runs more.
7. Frontend: "My deals" filter on the pipeline using the user → salesperson
   link; hide manager-only actions for reps.

Acceptance: a rep cannot move another rep's deal via chat or drag-and-drop; a
manager can; every mutation has an `audit_log` row with the actor; a user who
sends 60 chat turns in a minute gets a friendly rate-limit message.

### Phase 3 — Organizations and invitations (3–5 days)

This is where tenancy starts. It should land together with the Postgres and
`tenant_id` work in the audit, because scoping the store by organization is
the bulk of the effort.

1. Enable Clerk Organizations; add `<OrganizationSwitcher/>` and the create
   organization flow; require an active organization to use the app.
2. `orgId` becomes the tenant id: forwarded as `X-Org-Id`, stored on every
   business row, and used by every store query.
3. Roles: map Clerk `org:admin` → `admin`, `org:member` → `rep`, with a custom
   `org:manager` permission set for managers.
4. Invitations through Clerk; a `/api/webhooks/clerk` route (Svix-signed)
   syncs `user.*`, `organization.*`, and `organizationMembership.*` events
   into `users`, `organizations`, and `memberships` tables.
5. Onboarding: a new organization gets an empty CRM plus an optional "load
   demo data" button, replacing the automatic seed.

Acceptance: two organizations on the same deployment cannot see each other's
deals through the UI, the API routes, or the copilot; an invited user lands in
the right organization with the right role.

### Phase 4 — Hardening (1–2 days, can be spread out)

1. Replace the plain identity headers with a signed token: the frontend mints
   a 5-minute HS256 JWT (`jose`) containing `{ sub, org, role }` with
   `AGENT_SHARED_SECRET`; the agent verifies signature and expiry. The
   network boundary stops being the only thing the agent trusts.
2. Session policy in Clerk: inactivity timeout, optional MFA for admins,
   device revocation.
3. Security headers on the frontend (CSP, HSTS, frame-ancestors) via
   `next.config.ts`; lock the agent's CORS to no browser origins at all.
4. End-to-end tests with Clerk's testing tokens so Playwright can sign in
   without a UI flow, running against the `aimock` fixtures.

## 5. Environment variables

| Service | Variable | Notes |
| --- | --- | --- |
| frontend | `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` | public, from the Clerk dashboard |
| frontend | `CLERK_SECRET_KEY` | secret |
| frontend | `NEXT_PUBLIC_CLERK_SIGN_IN_URL` = `/sign-in`, `NEXT_PUBLIC_CLERK_SIGN_UP_URL` = `/sign-up` | routing |
| frontend, agent | `AGENT_SHARED_SECRET` | same value on both; rotate by setting both then redeploying |
| frontend | `CLERK_WEBHOOK_SIGNING_SECRET` | Phase 3 |
| frontend | `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN` | Phase 2, only if rate limiting moves out of memory |

## 6. Effort and order

| Phase | Effort | Blocks |
| --- | --- | --- |
| 1. Lock the door | 1–2 days | nothing; do first |
| 2. Identity inside the agent | 2–3 days | Phase 1 |
| 3. Organizations | 3–5 days | Phase 1; should ship with the Postgres migration |
| 4. Hardening | 1–2 days | Phase 1; items can be interleaved |

Total: roughly two working weeks for one engineer, of which Phase 1 alone
closes the "anyone with the URL" problem in a day or two.

## 7. Decisions to confirm before starting

1. **Clerk or Auth.js.** The plan assumes Clerk; Auth.js adds about a week
   for user tables, email delivery, and an org model.
2. **Sign-up policy for the beta:** invitation-only (recommended) or open
   with a domain allowlist.
3. **Roles for v1:** `rep`, `manager`, `admin` as above, or just `member`
   and `admin` until the multi-tenant work lands.
4. **Whether the demo seed stays** for new users during the beta, or whether
   a fresh user starts with an empty CRM.

## 8. Testing checklist for Phase 1

- Sign in, sign out, sign in as a second user; each sees the workspace.
- Visit the public domain in a private window: redirected to sign-in.
- `curl -i https://<frontend>/api/crm` without cookies: 401 or redirect.
- Chat still works end to end (navigate, enrich, prioritize) when signed in.
- Drag a deal between stages: the move persists after a reload.
- Railway health checks stay green on `/api/health` and `/ping`.
- Re-run the deployment session's private-network probe against the agent
  without the secret: 401; with the secret: the seeded snapshot.
