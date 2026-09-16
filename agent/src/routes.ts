import express from "express";
import type { Express, Request, Response } from "express";
import { ops } from "./domain/store.js";
import type { Customer, Invoice, Load, Order, OrderStatus, LoadStatus, BillingStatus, PricingRule, RollupPeriod } from "./domain/types.js";
import { customerProfitability, dailySeries, dashboardMetrics, DEFAULT_ROLLUP_COUNT, periodRollups, rollupTotals } from "./analytics.js";
import { enterRackPrice, priceBoard, quotePrice, upsertPricingRule } from "./services/pricing.js";
import { marketSummary, refreshIndexFeed, runForecast } from "./services/market.js";
import { createOrder, releaseCreditHold, reviewIntake, runEmailIntake, setOrderStatus } from "./services/orders.js";
import { createLoadForOrder, ingestBol, matchBolToLoad, pullBolFeed, recordDelivery, setBillingStatus, setLoadStatus } from "./services/loads.js";
import { approveInvoice, prepareInvoices, rejectInvoice, syncInvoicesToQuickBooks, syncPaymentsFromQuickBooks } from "./services/billing.js";
import { acknowledgeException, resolveException, triageExceptions } from "./services/controls.js";
import { recomputeAll } from "./services/context.js";
import { DEFAULT_ACTOR } from "./services/actor.js";

/**
 * REST surface for UI-initiated actions and the customer portal. Every
 * mutation goes through the same service functions the copilot's tools use,
 * so the board, the drawer, and the assistant stay one source of truth.
 */

type Handler = (req: Request, res: Response) => unknown;

function actorOf(req: Request): string {
  const h = req.header("x-actor-id");
  return h && ops.find("staff", h) ? h : DEFAULT_ACTOR;
}

function wrap(fn: Handler): Handler {
  return (req, res) => {
    try {
      const out = fn(req, res);
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
    const r = quotePrice(ops, { customerId: b.customerId, productId: b.productId, terminalId: b.terminalId || undefined, deliveryLocationId: b.deliveryLocationId || undefined, date: b.date || today() }, actorOf(req));
    return r.ok ? { ok: true, price: r.snapshot, rule: r.rule } : { ok: false, reason: r.reason, message: r.message };
  }));
  app.post("/ops/rack-prices", json, wrap((req) => enterRackPrice(ops, req.body, actorOf(req))));
  app.post("/ops/pricing-rules", json, wrap((req) => upsertPricingRule(ops, req.body as PricingRule, actorOf(req))));

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
  app.post("/ops/intake/:id/review", json, wrap((req) => reviewIntake(ops, String(req.params.id), req.body?.decision, actorOf(req), req.body?.edits ?? {})));

  app.post("/ops/orders", json, wrap((req) => createOrder(ops, { ...req.body, source: req.body?.source ?? "manual" }, actorOf(req))));
  app.post("/ops/orders/:id/status", json, wrap((req) => setOrderStatus(ops, String(req.params.id), req.body?.status as OrderStatus, actorOf(req), req.body?.note)));
  app.post("/ops/orders/:id/release-hold", wrap((req) => releaseCreditHold(ops, String(req.params.id), actorOf(req))));

  app.post("/ops/loads", json, wrap((req) => createLoadForOrder(ops, req.body, actorOf(req))));
  app.post("/ops/loads/:id/status", json, wrap((req) => setLoadStatus(ops, String(req.params.id), req.body?.status as LoadStatus, actorOf(req), req.body?.note)));
  app.post("/ops/loads/:id/delivery", json, wrap((req) => recordDelivery(ops, String(req.params.id), req.body, actorOf(req))));
  app.post("/ops/loads/:id/billing-status", json, wrap((req) => setBillingStatus(ops, String(req.params.id), req.body?.status as BillingStatus, actorOf(req))));

  app.post("/ops/bols/pull", wrap(() => {
    const r = pullBolFeed(ops);
    return { run: r.run, results: r.results.map((x) => ({ bolNumber: x.bol.bolNumber, outcome: x.outcome, loadNumber: x.load?.loadNumber })) };
  }));
  app.post("/ops/bols", json, wrap((req) => {
    const r = ingestBol(ops, { ...req.body, source: req.body?.source ?? "manual" }, actorOf(req));
    return { bol: r.bol, outcome: r.outcome, loadNumber: r.load?.loadNumber };
  }));
  app.post("/ops/bols/:id/match", json, wrap((req) => matchBolToLoad(ops, String(req.params.id), req.body?.loadId, actorOf(req))));

  app.post("/ops/invoices/prepare", json, wrap((req) => prepareInvoices(ops, actorOf(req), new Date(), req.body?.loadIds)));
  app.post("/ops/invoices/:id/approve", wrap((req) => approveInvoice(ops, String(req.params.id), actorOf(req))));
  app.post("/ops/invoices/:id/reject", json, wrap((req) => rejectInvoice(ops, String(req.params.id), actorOf(req), String(req.body?.reason ?? "Rejected"))));
  app.post("/ops/quickbooks/sync-invoices", wrap(() => {
    const r = syncInvoicesToQuickBooks(ops);
    return { run: r.run, synced: r.synced.map((i) => i.invoiceNumber), responses: r.responses };
  }));
  app.post("/ops/quickbooks/sync-payments", wrap(() => syncPaymentsFromQuickBooks(ops)));

  app.get("/ops/exceptions/triage", wrap(() => triageExceptions(ops, new Date(), 10)));
  app.post("/ops/exceptions/:id/resolve", json, wrap((req) => resolveException(ops, String(req.params.id), actorOf(req), String(req.body?.note ?? "Resolved"))));
  app.post("/ops/exceptions/:id/acknowledge", wrap((req) => acknowledgeException(ops, String(req.params.id), actorOf(req))));

  app.post("/ops/admin/reseed", wrap(() => {
    ops.reseed(new Date());
    recomputeAll(ops);
    return { ok: true, seededAt: ops.docs.getMeta("seededAt") };
  }));

  // Customer portal (Module G): scoped by the customer's portal token; no pricing internals.
  app.get("/portal/:token", wrap((req, res) => {
    const customer = ops.all<Customer>("customers").find((c) => c.portalToken === String(req.params.token));
    if (!customer) {
      res.status(404).json({ error: "portal link not found" });
      return undefined;
    }
    const orders = ops.all<Order>("orders").filter((o) => o.customerId === customer.id);
    const loads = ops.all<Load>("loads").filter((l) => l.customerId === customer.id);
    const invoices = ops.all<Invoice>("invoices").filter((i) => i.customerId === customer.id && !["draft", "pending_approval", "void"].includes(i.status));
    const products = ops.all<{ id: string; name: string }>("products");
    const locations = ops.all<{ id: string; customerId: string; name: string; city: string; state: string }>("deliveryLocations").filter((l) => l.customerId === customer.id);
    const carriers = ops.all<{ id: string; name: string }>("carriers");
    const events = ops.all<{ id: string; orderId: string; to: string; occurredAt: string }>("orderEvents");
    const deliveries = ops.all<{ id: string; loadId: string; deliveredAt: string; deliveredGallons: number; ticketNumber: string }>("deliveries");
    return {
      customer: { id: customer.id, name: customer.name, code: customer.code, paymentTermsDays: customer.paymentTermsDays },
      locations,
      orders: orders
        .sort((a, b) => b.requestedDate.localeCompare(a.requestedDate))
        .map((o) => {
          const load = loads.find((l) => l.orderIds.includes(o.id));
          const delivery = load ? deliveries.find((d) => d.loadId === load.id) : undefined;
          return {
            id: o.id,
            orderNumber: o.orderNumber,
            product: products.find((p) => p.id === o.productId)?.name ?? o.productId,
            gallons: o.requestedGallons,
            requestedDate: o.requestedDate,
            customerPo: o.customerPo,
            location: locations.find((l) => l.id === o.deliveryLocationId)?.name ?? "",
            status: o.status,
            milestones: events.filter((e) => e.orderId === o.id).map((e) => ({ status: e.to, at: e.occurredAt })),
            carrier: load ? carriers.find((c) => c.id === load.carrierId)?.name : undefined,
            scheduledDeliveryAt: load?.scheduledDeliveryAt,
            deliveredAt: delivery?.deliveredAt,
            deliveredGallons: delivery?.deliveredGallons,
            ticketNumber: delivery?.ticketNumber,
          };
        }),
      invoices: invoices.map((i) => ({ invoiceNumber: i.invoiceNumber, issueDate: i.issueDate, dueDate: i.dueDate, total: i.total, status: i.status })),
    };
  }));
}
