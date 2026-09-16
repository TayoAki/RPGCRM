import type { OpsState } from "./domain/types.js";
import { invoiceNetRevenue } from "./billing/invoices.js";
import { round2 } from "./pricing/taxes.js";

/**
 * Management dashboard numbers (Module J) and the aggregates behind reports.
 * Pure functions over the snapshot; `now` is injectable for tests.
 */

const DAY = 86_400_000;

export interface DashboardMetrics {
  asOf: string;
  gallonsDeliveredToday: number;
  gallonsDelivered7d: number;
  revenue7d: number;
  revenueMtd: number;
  expectedGrossProfit7d: number;
  actualGrossProfit7d: number;
  profitPerGallon7d: number | null;
  ordersInProgress: number;
  ordersAwaitingReview: number;
  loadsDeliveredToday: number;
  loadsAwaitingBilling: number;
  invoicesPendingApproval: number;
  openExceptions: { critical: number; warning: number; info: number };
  marketMovement: { indexId: string; code: string; name: string; value: number; change: number; date: string }[];
  forecasts: { indexId: string; code: string; direction: string; confidence: number; targetDate: string }[];
}

export function dashboardMetrics(state: OpsState, now: Date = new Date()): DashboardMetrics {
  const today = now.toISOString().slice(0, 10);
  const since7 = new Date(now.getTime() - 7 * DAY).toISOString();
  const monthStart = `${today.slice(0, 7)}-01`;

  const deliveredLoads = state.loads.filter((l) => l.status === "delivered" || l.status === "closed");
  const deliveredAt = (loadId: string): string | undefined =>
    state.deliveries.find((d) => d.loadId === loadId)?.deliveredAt ??
    state.loads.find((l) => l.id === loadId)?.scheduledDeliveryAt;
  const gallonsOf = (loadId: string): number => {
    const m = state.loadMargins.find((x) => x.loadId === loadId);
    return m?.gallons ?? state.loads.find((l) => l.id === loadId)?.plannedGallons ?? 0;
  };

  const loadsToday = deliveredLoads.filter((l) => (deliveredAt(l.id) ?? "").slice(0, 10) === today);
  const loads7d = deliveredLoads.filter((l) => (deliveredAt(l.id) ?? "") >= since7);
  const margins7d = state.loadMargins.filter((m) => loads7d.some((l) => l.id === m.loadId));
  const actual7d = round2(margins7d.reduce((s, m) => s + (m.actualGrossProfit ?? 0), 0));
  const gallons7d = loads7d.reduce((s, l) => s + gallonsOf(l.id), 0);

  const invoices = state.invoices.filter((i) => i.status !== "void" && i.status !== "draft");
  const revenue7d = round2(invoices.filter((i) => i.issueDate >= since7.slice(0, 10)).reduce((s, i) => s + invoiceNetRevenue(i), 0));
  const revenueMtd = round2(invoices.filter((i) => i.issueDate >= monthStart).reduce((s, i) => s + invoiceNetRevenue(i), 0));

  const open = state.exceptions.filter((e) => e.status !== "resolved");

  const marketMovement = state.priceIndexes.map((idx) => {
    const latest = state.indexPrices
      .filter((p) => p.indexId === idx.id)
      .sort((a, b) => b.date.localeCompare(a.date))[0];
    return {
      indexId: idx.id,
      code: idx.code,
      name: idx.name,
      value: latest?.value ?? 0,
      change: latest?.change ?? 0,
      date: latest?.date ?? "",
    };
  });

  const forecasts = state.priceIndexes.flatMap((idx) => {
    const f = state.forecasts
      .filter((x) => x.indexId === idx.id)
      .sort((a, b) => b.targetDate.localeCompare(a.targetDate))[0];
    return f ? [{ indexId: idx.id, code: idx.code, direction: f.direction, confidence: f.confidence, targetDate: f.targetDate }] : [];
  });

  return {
    asOf: now.toISOString(),
    gallonsDeliveredToday: loadsToday.reduce((s, l) => s + gallonsOf(l.id), 0),
    gallonsDelivered7d: gallons7d,
    revenue7d,
    revenueMtd,
    expectedGrossProfit7d: round2(margins7d.reduce((s, m) => s + m.expectedGrossProfit, 0)),
    actualGrossProfit7d: actual7d,
    profitPerGallon7d: gallons7d > 0 ? Math.round((actual7d / gallons7d) * 10000) / 10000 : null,
    ordersInProgress: state.orders.filter((o) => !["delivered", "cancelled"].includes(o.status)).length,
    ordersAwaitingReview: state.emailIntakes.filter((e) => e.reviewStatus === "pending").length,
    loadsDeliveredToday: loadsToday.length,
    loadsAwaitingBilling: state.loads.filter((l) => l.billingStatus && !["invoiced", "paid"].includes(l.billingStatus)).length,
    invoicesPendingApproval: state.invoices.filter((i) => i.status === "pending_approval").length,
    openExceptions: {
      critical: open.filter((e) => e.severity === "critical").length,
      warning: open.filter((e) => e.severity === "warning").length,
      info: open.filter((e) => e.severity === "info").length,
    },
    marketMovement,
    forecasts,
  };
}

export interface CustomerProfitRow {
  customerId: string;
  name: string;
  loads: number;
  gallons: number;
  revenue: number;
  grossProfit: number;
  profitPerGallon: number | null;
}

export function customerProfitability(state: OpsState, now: Date = new Date(), days = 30): CustomerProfitRow[] {
  const since = new Date(now.getTime() - days * DAY).toISOString();
  const rows = new Map<string, CustomerProfitRow>();
  for (const m of state.loadMargins) {
    const load = state.loads.find((l) => l.id === m.loadId);
    if (!load || load.scheduledPickupAt < since || m.actualGrossProfit === null) continue;
    const row = rows.get(m.customerId) ?? {
      customerId: m.customerId,
      name: state.customers.find((c) => c.id === m.customerId)?.name ?? m.customerId,
      loads: 0,
      gallons: 0,
      revenue: 0,
      grossProfit: 0,
      profitPerGallon: null,
    };
    row.loads += 1;
    row.gallons += m.gallons;
    row.revenue = round2(row.revenue + m.revenue);
    row.grossProfit = round2(row.grossProfit + m.actualGrossProfit);
    rows.set(m.customerId, row);
  }
  return [...rows.values()]
    .map((r) => ({ ...r, profitPerGallon: r.gallons ? Math.round((r.grossProfit / r.gallons) * 10000) / 10000 : null }))
    .sort((a, b) => b.grossProfit - a.grossProfit);
}

export interface DailyPoint {
  date: string;
  gallons: number;
  grossProfit: number;
  loads: number;
}

/** Delivered gallons and actual gross profit by day for the trailing window. */
export function dailySeries(state: OpsState, now: Date = new Date(), days = 14): DailyPoint[] {
  const out: DailyPoint[] = [];
  for (let i = days - 1; i >= 0; i--) {
    const date = new Date(now.getTime() - i * DAY).toISOString().slice(0, 10);
    out.push({ date, gallons: 0, grossProfit: 0, loads: 0 });
  }
  const byDate = new Map(out.map((p) => [p.date, p]));
  for (const load of state.loads) {
    if (!["delivered", "closed"].includes(load.status)) continue;
    const at = (state.deliveries.find((d) => d.loadId === load.id)?.deliveredAt ?? load.scheduledDeliveryAt).slice(0, 10);
    const p = byDate.get(at);
    if (!p) continue;
    const m = state.loadMargins.find((x) => x.loadId === load.id);
    p.loads += 1;
    p.gallons += m?.gallons ?? load.plannedGallons;
    p.grossProfit = round2(p.grossProfit + (m?.actualGrossProfit ?? 0));
  }
  return out;
}
