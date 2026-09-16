import express from "express";
import type { Express, Request, Response } from "express";
import { ops } from "./domain/store.js";
import type { OrderStatus, LoadStatus, BillingStatus, PricingRule, RollupPeriod, IntegrationRun } from "./domain/types.js";
import { customerProfitability, dailySeries, dashboardMetrics, DEFAULT_ROLLUP_COUNT, periodRollups, rollupTotals } from "./analytics.js";
import { enterRackPrice, importRackFeed, priceBoard, quotePrice, upsertPricingRule } from "./services/pricing.js";
import { marketSummary, refreshIndexFeed, runForecast } from "./services/market.js";
import { createOrder, releaseCreditHold, reviewIntake, runEmailIntake, setOrderStatus } from "./services/orders.js";
import { createLoadForOrder, ingestBol, matchBolToLoad, pullBolFeed, recordDelivery, setBillingStatus, setLoadStatus } from "./services/loads.js";
import { approveInvoice, prepareInvoices, rejectInvoice, syncInvoicesToQuickBooks, syncPaymentsFromQuickBooks } from "./services/billing.js";
import { acknowledgeException, resolveException, triageExceptions } from "./services/controls.js";
import { recomputeAll } from "./services/context.js";
import { portalData, portalLogin, portalLogout, portalSessionFor } from "./services/portal.js";
import { sampleBolSource } from "./integrations/bol/source.js";
import { resolveBolSource } from "./integrations/bol/dtn.js";
import { currentActor } from "./services/actor.js";
import { bearerToken, changeStaffPassword, publicStaff, staffLogin, staffLogout } from "./services/staffAuth.js";
import type { StaffIdentity } from "./services/staffAuth.js";

/**
 * REST surface for UI-initiated actions, staff sign-in, and the customer
 * portal. Every mutation goes through the same service functions the
 * copilot's tools use, so the board, the drawer, and the assistant stay one
 * source of truth. Everything under /ops and /auth (except sign-in) runs
 * behind the staff auth gate (services/staffAuth.ts), which resolves the
 * session and runs the request as that user; `actor()` reads it back.
 */

type Handler = (req: Request, res: Response) => unknown;

const actor = (): string => currentActor();

/** The verified staff identity the gate attached to this request. */
function staffOf(res: Response): StaffIdentity {
  const id = res.locals.staff as StaffIdentity | undefined;
  if (!id) throw new Error("No signed-in user for this request. Please sign in.");
  return id;
}

function wrap(fn: Handler): Handler {
  return async (req, res) => {
    try {
      const out = await fn(req, res);
      if (out !== undefined && !res.headersSent) res.json(out);
    } catch (e) {
      const message = (e as Error).message;
      const status = /not found/i.test(message) ? 404 : 400;
      if (!res.headersSent) res.status(status).json({ error: message });
    }
  };
}

export function registerOpsRoutes(app: Express): void {
  const json = express.json({ limit: "2mb" });
  const today = () => new Date().toISOString().slice(0, 10);

  // ---- Staff sign-in (AUTH_PLAN Phase 1) ---------------------------------
  // /auth/login is public; the rest need the session the gate verified.
  app.post("/auth/login", json, wrap((req, res) => {
    const { email, password } = (req.body ?? {}) as { email?: string; password?: string };
    try {
      return staffLogin(ops, String(email ?? ""), String(password ?? ""));
    } catch (e) {
      res.status(401).json({ error: (e as Error).message });
      return undefined;
    }
  }));
  app.get("/auth/me", wrap((_req, res) => {
    const me = staffOf(res);
    return { user: publicStaff(me.user), session: { expiresAt: me.session.expiresAt } };
  }));
  app.post("/auth/logout", wrap((req) => ({ ok: staffLogout(ops, bearerToken(req)) })));
  app.post("/auth/password", json, wrap((req, res) => {
    const me = staffOf(res);
    const { currentPassword, newPassword } = (req.body ?? {}) as { currentPassword?: string; newPassword?: string };
    changeStaffPassword(ops, me.user.id, String(currentPassword ?? ""), String(newPassword ?? ""), me.session.id);
    return { ok: true };
  }));

  app.get("/ops", wrap(() => ops.uiSnapshot()));

  app.get("/ops/dashboard", wrap(() => {
    const now = new Date();
    const state = ops.snapshot();
    return {
      metrics: dashboardMetrics(state, now),
      profitability: customerProfitability(state, now),
      daily: dailySeries(state, now, 14),
      priceBoard: priceBoard(ops, today()),
      market: marketSummary(ops, 30),
      triage: triageExceptions(ops, now, 5),
    };
  }));

  app.get("/ops/price-board", wrap((req) => priceBoard(ops, String(req.query.date ?? today()))));
  app.post("/ops/price/quote", json, wrap((req) => {
    const b = req.body ?? {};
    const r = quotePrice(ops, { customerId: b.customerId, productId: b.productId, terminalId: b.terminalId || undefined, deliveryLocationId: b.deliveryLocationId || undefined, date: b.date || today() }, actor());
    return r.ok ? { ok: true, price: r.snapshot, rule: r.rule } : { ok: false, reason: r.reason, message: r.message };
  }));
  app.post("/ops/rack-prices", json, wrap((req) => enterRackPrice(ops, req.body, actor())));
  app.post("/ops/rack-prices/import", json, wrap(() => importRackFeed(ops, actor())));
  app.post("/ops/pricing-rules", json, wrap((req) => upsertPricingRule(ops, req.body as PricingRule, actor())));

  // Module B: totals by day / week / month for the Reports page.
  app.get("/ops/reports/rollups", wrap((req) => {
    const period = String(req.query.period ?? "week");
    if (!["day", "week", "month"].includes(period)) throw new Error(`Unknown period "${period}"; use day, week, or month`);
    const p = period as RollupPeriod;
    const count = Math.max(1, Math.min(24, Number(req.query.count) || DEFAULT_ROLLUP_COUNT[p]));
    const rollups = periodRollups(ops.snapshot(), p, new Date(), count);
    return { period: p, count, rollups, totals: rollupTotals(rollups) };
  }));
  app.get("/ops/market", wrap(() => marketSummary(ops, 60)));
  app.post("/ops/market/refresh", wrap(() => {
    const feed = refreshIndexFeed(ops);
    const forecast = runForecast(ops);
    return { feed: feed.run, forecast: forecast.run, updated: feed.updated, forecasts: forecast.forecasts };
  }));

  app.post("/ops/intake/run", wrap(() => runEmailIntake(ops)));
  app.post("/ops/intake/:id/review", json, wrap((req) => reviewIntake(ops, String(req.params.id), req.body?.decision, actor(), req.body?.edits ?? {})));

  app.post("/ops/orders", json, wrap((req) => createOrder(ops, { ...req.body, source: req.body?.source ?? "manual" }, actor())));
  app.post("/ops/orders/:id/status", json, wrap((req) => setOrderStatus(ops, String(req.params.id), req.body?.status as OrderStatus, actor(), req.body?.note)));
  app.post("/ops/orders/:id/release-hold", wrap((req) => releaseCreditHold(ops, String(req.params.id), actor())));

  app.post("/ops/loads", json, wrap((req) => createLoadForOrder(ops, req.body, actor())));
  app.post("/ops/loads/:id/status", json, wrap((req) => setLoadStatus(ops, String(req.params.id), req.body?.status as LoadStatus, actor(), req.body?.note)));
  app.post("/ops/loads/:id/delivery", json, wrap((req) => recordDelivery(ops, String(req.params.id), req.body, actor())));
  app.post("/ops/loads/:id/billing-status", json, wrap((req) => setBillingStatus(ops, String(req.params.id), req.body?.status as BillingStatus, actor())));

  // Which connector feeds BOLs right now (DTN when configured, the sample file otherwise).
  app.get("/ops/integrations/bol-source", wrap(() => {
    const src = resolveBolSource() ?? sampleBolSource();
    const last = ops.all<IntegrationRun>("integrationRuns").filter((r) => r.kind === "bol_feed").at(-1) ?? null;
    return { ...src.describe(), lastRun: last };
  }));
  app.post("/ops/bols/pull", wrap(async () => {
    const r = await pullBolFeed(ops);
    return { run: r.run, source: r.source, skipped: r.skipped, results: r.results.map((x) => ({ bolNumber: x.bol.bolNumber, outcome: x.outcome, loadNumber: x.load?.loadNumber })) };
  }));
  app.post("/ops/bols", json, wrap((req) => {
    const r = ingestBol(ops, { ...req.body, source: req.body?.source ?? "manual" }, actor());
    return { bol: r.bol, outcome: r.outcome, loadNumber: r.load?.loadNumber };
  }));
  app.post("/ops/bols/:id/match", json, wrap((req) => matchBolToLoad(ops, String(req.params.id), req.body?.loadId, actor())));

  app.post("/ops/invoices/prepare", json, wrap((req) => prepareInvoices(ops, actor(), new Date(), req.body?.loadIds)));
  app.post("/ops/invoices/:id/approve", wrap((req) => approveInvoice(ops, String(req.params.id), actor())));
  app.post("/ops/invoices/:id/reject", json, wrap((req) => rejectInvoice(ops, String(req.params.id), actor(), String(req.body?.reason ?? "Rejected"))));
  app.post("/ops/quickbooks/sync-invoices", wrap(() => {
    const r = syncInvoicesToQuickBooks(ops);
    return { run: r.run, synced: r.synced.map((i) => i.invoiceNumber), responses: r.responses };
  }));
  app.post("/ops/quickbooks/sync-payments", wrap(() => syncPaymentsFromQuickBooks(ops)));

  app.get("/ops/exceptions/triage", wrap(() => triageExceptions(ops, new Date(), 10)));
  app.post("/ops/exceptions/:id/resolve", json, wrap((req) => resolveException(ops, String(req.params.id), actor(), String(req.body?.note ?? "Resolved"))));
  app.post("/ops/exceptions/:id/acknowledge", wrap((req) => acknowledgeException(ops, String(req.params.id), actor())));

  // Demo reset: admins only. Staff logins and sessions survive it.
  app.post("/ops/admin/reseed", wrap((_req, res) => {
    const me = staffOf(res);
    if (me.user.role !== "admin") {
      res.status(403).json({ error: `Only an admin can reset the demo data (${me.user.name} is ${me.user.role}).` });
      return undefined;
    }
    ops.reseed(new Date());
    recomputeAll(ops);
    ops.audit(me.user.id, "admin.reseed", "system", "demo", `${me.user.name} reset the demo data`);
    return { ok: true, seededAt: ops.docs.getMeta("seededAt") };
  }));

  // ---- Customer portal (Module G): email + password sign-in, customer-scoped data ----
  // Public paths (no staff session): the portal has its own accounts and sessions.
  app.post("/portal/login", json, wrap((req, res) => {
    const { email, password } = (req.body ?? {}) as { email?: string; password?: string };
    try {
      return portalLogin(ops, String(email ?? ""), String(password ?? ""));
    } catch (e) {
      res.status(401).json({ error: (e as Error).message });
      return undefined;
    }
  }));

  app.get("/portal/me", wrap((req, res) => {
    const identity = portalSessionFor(ops, bearerToken(req));
    if (!identity) {
      res.status(401).json({ error: "Please sign in." });
      return undefined;
    }
    return {
      ...portalData(ops, identity.customer.id),
      user: { id: identity.user.id, name: identity.user.name, email: identity.user.email },
      session: { expiresAt: identity.session.expiresAt },
    };
  }));

  app.post("/portal/logout", wrap((req) => ({ ok: portalLogout(ops, bearerToken(req)) })));
}
