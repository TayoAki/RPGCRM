import { z } from "zod";
import { tool } from "@strands-agents/sdk";
import type { JSONValue } from "@strands-agents/sdk";
import { ops } from "../domain/store.js";
import type { Contact, DeliveryLocation, Invoice, Load, LoadMargin, Order, Product } from "../domain/types.js";
import { customerProfitability, dailySeries, dashboardMetrics } from "../analytics.js";
import { marketSummary, refreshIndexFeed, runForecast } from "../services/market.js";
import { resolveException, triageExceptions } from "../services/controls.js";
import { priceBoard } from "../services/pricing.js";
import { currentActor } from "../services/actor.js";
import { resolveCustomer } from "./resolve.js";

/** Rendered by the DailyBriefCard. */
export const dailyBriefTool = tool({
  name: "daily_brief",
  description: "Management brief (Module J): gallons, revenue, expected vs actual gross profit, orders and loads in progress, billing backlog, open exceptions, and market movement. Use for 'how are we doing', 'morning brief', 'status'.",
  inputSchema: z.object({}),
  callback: () => {
    const now = new Date();
    const state = ops.snapshot();
    const t = triageExceptions(ops, now, 3);
    return {
      metrics: dashboardMetrics(state, now),
      topExceptions: t.priorities.map((p) => ({ id: p.id, type: p.type, severity: p.severity, message: p.message, nextStep: p.nextStep })),
      totalOpenExceptions: t.totalOpen,
      daily: dailySeries(state, now, 7),
    } as unknown as JSONValue;
  },
});

/** Rendered by the MarketCard. */
export const marketUpdateTool = tool({
  name: "market_update",
  description: "Fuel market tracker (Modules C/D): each index's latest value, daily and 7-day change, tomorrow's direction estimate with confidence and backtested hit rate. Read-only.",
  inputSchema: z.object({}),
  callback: () => ({ indexes: marketSummary(ops, 14).map((m) => ({ ...m, history: m.history.slice(-14) })) }) as unknown as JSONValue,
});

export const refreshMarketFeedTool = tool({
  name: "refresh_market_feed",
  description: "Pull today's index values from the market feed (sample data in this MVP) and re-run the next-day forecast.",
  inputSchema: z.object({}),
  callback: () => {
    const feed = refreshIndexFeed(ops);
    const fc = runForecast(ops);
    return { feed: feed.run.summary, forecast: fc.run.summary, indexes: marketSummary(ops, 14).map((m) => ({ ...m, history: m.history.slice(-14) })) } as unknown as JSONValue;
  },
});

/** Rendered by the ExceptionsCard. */
export const triageExceptionsTool = tool({
  name: "triage_exceptions",
  description: "Rank open data-integrity exceptions (missing BOLs, unmatched BOLs, duplicates, pricing gaps, uninvoiced loads, low-margin loads, credit holds, stale indexes) by severity, money at risk, and age, each with a suggested next step. Use for 'what needs attention', 'exceptions', 'what's wrong'.",
  inputSchema: z.object({ topN: z.number().min(1).max(10).optional() }),
  callback: ({ topN }) => triageExceptions(ops, new Date(), topN ?? 5) as unknown as JSONValue,
});

export const resolveExceptionTool = tool({
  name: "resolve_exception",
  description: "Mark an exception resolved with a note explaining what was done.",
  inputSchema: z.object({ exceptionId: z.string(), note: z.string() }),
  callback: ({ exceptionId, note }) => resolveException(ops, exceptionId, currentActor(), note) as unknown as JSONValue,
});

/** Rendered by the MarginCard. */
export const marginReportTool = tool({
  name: "margin_report",
  description: "Expected vs actual profit (Module B): per-load margins and customer profitability for the trailing window. Use for 'how profitable', 'margin', 'profit per gallon', 'which loads lost money'.",
  inputSchema: z.object({ days: z.number().min(1).max(90).optional(), customer: z.string().optional() }),
  callback: ({ days, customer }) => {
    const now = new Date();
    const state = ops.snapshot();
    const c = customer ? resolveCustomer(customer) : undefined;
    const since = new Date(now.getTime() - (days ?? 30) * 86_400_000).toISOString();
    const margins = state.loadMargins
      .filter((m) => !c || m.customerId === c.id)
      .map((m) => ({ ...m, load: state.loads.find((l) => l.id === m.loadId)! }))
      .filter((m) => m.load && m.load.scheduledPickupAt >= since)
      .map((m) => ({
        loadId: m.loadId,
        loadNumber: m.load.loadNumber,
        customerName: state.customers.find((x) => x.id === m.customerId)?.name ?? m.customerId,
        productName: state.products.find((p) => p.id === m.productId)?.name ?? m.productId,
        gallons: m.gallons,
        revenue: m.revenue,
        supplierCost: m.supplierCost,
        freightCost: m.freightCost,
        expectedGrossProfit: m.expectedGrossProfit,
        actualGrossProfit: m.actualGrossProfit,
        profitPerGallon: m.profitPerGallon,
        variance: m.variance,
        status: m.load.status,
      }))
      .sort((a, b) => (a.profitPerGallon ?? 99) - (b.profitPerGallon ?? 99));
    const totals = margins.reduce(
      (t, m) => ({ gallons: t.gallons + (m.actualGrossProfit !== null ? m.gallons : 0), expected: t.expected + m.expectedGrossProfit, actual: t.actual + (m.actualGrossProfit ?? 0) }),
      { gallons: 0, expected: 0, actual: 0 },
    );
    return {
      days: days ?? 30,
      customerName: c?.name ?? null,
      totals: { ...totals, expected: Math.round(totals.expected * 100) / 100, actual: Math.round(totals.actual * 100) / 100, profitPerGallon: totals.gallons ? Math.round((totals.actual / totals.gallons) * 10000) / 10000 : null },
      loads: margins,
      customers: customerProfitability(state, now, days ?? 30).filter((r) => !c || r.customerId === c.id),
    } as unknown as JSONValue;
  },
});

/** Rendered by the CustomerCard. */
export const customerSummaryTool = tool({
  name: "customer_summary",
  description: "One customer's profile: terms, credit, tax status, locations, contacts, open orders, recent loads, outstanding invoices, profitability, and today's prices. Use for 'tell me about <customer>'.",
  inputSchema: z.object({ customer: z.string() }),
  callback: ({ customer }) => {
    const c = resolveCustomer(customer);
    const now = new Date();
    const state = ops.snapshot();
    const outstanding = state.invoices.filter((i: Invoice) => i.customerId === c.id && ["synced", "approved", "pending_approval"].includes(i.status));
    return {
      customer: c,
      locations: state.deliveryLocations.filter((l: DeliveryLocation) => l.customerId === c.id),
      contacts: state.contacts.filter((x: Contact) => x.customerId === c.id),
      openOrders: state.orders.filter((o: Order) => o.customerId === c.id && !["delivered", "cancelled"].includes(o.status)).map((o) => ({ ...o, productName: state.products.find((p: Product) => p.id === o.productId)?.name })),
      recentLoads: state.loads.filter((l: Load) => l.customerId === c.id).sort((a, b) => b.scheduledPickupAt.localeCompare(a.scheduledPickupAt)).slice(0, 5),
      outstandingInvoices: outstanding.map((i) => ({ invoiceNumber: i.invoiceNumber, total: i.total, dueDate: i.dueDate, status: i.status })),
      outstandingTotal: Math.round(outstanding.reduce((s, i) => s + i.total, 0) * 100) / 100,
      profitability: customerProfitability(state, now, 30).find((r) => r.customerId === c.id) ?? null,
      margins: state.loadMargins.filter((m: LoadMargin) => m.customerId === c.id).slice(-5),
      prices: priceBoard(ops, now.toISOString().slice(0, 10)).filter((r) => r.customerId === c.id),
    } as unknown as JSONValue;
  },
});
