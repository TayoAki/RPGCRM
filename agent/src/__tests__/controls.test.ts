import { describe, it, expect } from "vitest";
import { backtest, estimateDirection } from "../market/forecast.js";
import { detectExceptions, reconcileExceptions } from "../exceptions/rules.js";
import { computeLoadMargin } from "../margin/compute.js";
import { marginContext, priceWith } from "../services/context.js";
import { acknowledgeException, resolveException, triageExceptions } from "../services/controls.js";
import { refreshIndexFeed, runForecast, marketSummary } from "../services/market.js";
import { customerProfitability, dailySeries, dashboardMetrics } from "../analytics.js";
import { freshStore, NOW } from "./helpers.js";

describe("forecast", () => {
  it("estimates a direction with bounded confidence and backtests", () => {
    const store = freshStore();
    const hist = store.all<any>("indexPrices").filter((p) => p.indexId === "idx-nymex-ho");
    const est = estimateDirection(hist);
    expect(["up", "down", "flat"]).toContain(est.direction);
    expect(est.confidence).toBeGreaterThanOrEqual(0.5);
    expect(est.confidence).toBeLessThanOrEqual(0.85);
    const bt = backtest(hist);
    expect(bt.total).toBeGreaterThan(40);
    expect(bt.hitRate).toBeGreaterThanOrEqual(0);
  });

  it("feed refresh adds today's values once; forecast targets tomorrow", async () => {
    const store = freshStore();
    const first = await refreshIndexFeed(store, NOW);
    expect(first.updated.length).toBe(4);
    const second = await refreshIndexFeed(store, NOW);
    expect(second.updated.length).toBe(0);
    const { forecasts } = runForecast(store, NOW);
    expect(forecasts.every((f) => f.targetDate === "2026-09-17")).toBe(true);
    const summary = marketSummary(store);
    expect(summary[0].latest).not.toBeNull();
    expect(summary[0].date).toBe("2026-09-16");
  });
});

describe("margins and exceptions", () => {
  it("computes expected and actual margin for a delivered load", () => {
    const store = freshStore();
    const m = computeLoadMargin(store.load("l-504"), marginContext(store), NOW);
    expect(m.actualGrossProfit).not.toBeNull();
    expect(m.gallons).toBe(7015); // gross basis customer
    expect(m.taxesPassthrough).toBeGreaterThan(0);
    expect(m.freightCost).toBeGreaterThan(0);
    const open = computeLoadMargin(store.load("l-506"), marginContext(store), NOW);
    expect(open.actualGrossProfit).toBeNull();
    expect(open.expectedGrossProfit).toBeGreaterThan(0);
  });

  it("detects the seeded conditions and auto-resolves cleared ones", () => {
    const store = freshStore();
    const detected = detectExceptions(store.snapshot(), NOW, priceWith(store));
    const types = detected.map((d) => `${d.type}:${d.entityId}`);
    expect(types).toContain("missing_bol:l-505");
    expect(types).toContain("pricing_missing:o-1010");
    expect(types).toContain("credit_hold:o-1009");
    const existing = store.all<any>("exceptions");
    const { changed, autoResolved } = reconcileExceptions(existing, detected.filter((d) => d.type !== "missing_bol"), () => "ex-x", NOW);
    expect(autoResolved).toBe(1);
    expect(changed.find((c) => c.entityId === "l-505")?.status).toBe("resolved");
  });

  it("triages by severity and money, and human resolution sticks", () => {
    const store = freshStore();
    const t = triageExceptions(store, NOW);
    expect(t.totalOpen).toBeGreaterThanOrEqual(4);
    expect(t.priorities[0].severity).toBe("critical");
    expect(t.priorities[0].nextStep.length).toBeGreaterThan(10);
    const target = t.priorities.find((p) => p.type === "credit_hold")!;
    resolveException(store, target.id, "u-elena", "Payment received; hold released", NOW);
    const after = triageExceptions(store, NOW);
    expect(after.priorities.concat(after.rest).some((p) => p.id === target.id)).toBe(false); // not reopened by the system
    acknowledgeException(store, after.priorities[0].id, "u-marcus");
    expect(store.require<any>("exceptions", after.priorities[0].id).status).toBe("acknowledged");
  });
});

describe("analytics", () => {
  it("summarizes the dashboard and profitability", () => {
    const store = freshStore();
    const dm = dashboardMetrics(store.snapshot(), NOW);
    expect(dm.ordersInProgress).toBe(6);
    expect(dm.loadsAwaitingBilling).toBe(2);
    expect(dm.invoicesPendingApproval).toBe(1);
    expect(dm.openExceptions.critical + dm.openExceptions.warning + dm.openExceptions.info).toBeGreaterThanOrEqual(4);
    expect(dm.marketMovement.length).toBe(4);
    const prof = customerProfitability(store.snapshot(), NOW);
    expect(prof.length).toBeGreaterThanOrEqual(3);
    expect(prof[0].grossProfit).toBeGreaterThanOrEqual(prof[prof.length - 1].grossProfit);
    const series = dailySeries(store.snapshot(), NOW, 7);
    expect(series.length).toBe(7);
    expect(series.reduce((s, p) => s + p.loads, 0)).toBeGreaterThanOrEqual(4);
  });
});
