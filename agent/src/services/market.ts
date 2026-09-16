import type { OpsStore } from "../domain/store.js";
import type { Forecast, IndexPrice, IntegrationRun, PriceIndex } from "../domain/types.js";
import { backtest, estimateDirection, MODEL_VERSION, realizedDirection } from "../market/forecast.js";
import { loadSample } from "../samples/loader.js";
import { recomputeExceptions } from "./context.js";

/** Module C: apply the market feed (sample file of daily changes) for today. */
export function refreshIndexFeed(store: OpsStore, now: Date = new Date()): { run: IntegrationRun; updated: IndexPrice[] } {
  const startedAt = now.toISOString();
  const today = now.toISOString().slice(0, 10);
  const file = loadSample<{ changes: { indexCode: string; change: number }[] }>("index-feed.json", now);
  const updated: IndexPrice[] = [];
  for (const ch of file.changes) {
    const idx = store.all<PriceIndex>("priceIndexes").find((i) => i.code === ch.indexCode);
    if (!idx) continue;
    const history = store.all<IndexPrice>("indexPrices").filter((p) => p.indexId === idx.id).sort((a, b) => a.date.localeCompare(b.date));
    const last = history[history.length - 1];
    if (last && last.date >= today) continue; // already have today's value
    const value = Math.round(((last?.value ?? 2.5) + ch.change) * 10000) / 10000;
    const row: IndexPrice = { id: store.nextId("indexPrices", "ip-"), indexId: idx.id, date: today, value, change: Math.round(ch.change * 10000) / 10000 };
    store.save("indexPrices", row);
    updated.push(row);
  }
  const run: IntegrationRun = {
    id: store.nextId("integrationRuns", "run-"),
    kind: "index_feed",
    startedAt,
    finishedAt: new Date().toISOString(),
    status: "success",
    recordsIn: file.changes.length,
    recordsOut: updated.length,
    summary: updated.length ? `${updated.length} index value(s) updated for ${today}` : `Indexes already current for ${today}`,
  };
  store.save("integrationRuns", run);
  recomputeExceptions(store, now);
  return { run, updated };
}

/** Module D: score yesterday's forecasts and estimate tomorrow. */
export function runForecast(store: OpsStore, now: Date = new Date()): { run: IntegrationRun; forecasts: Forecast[] } {
  const startedAt = now.toISOString();
  const tomorrow = new Date(now.getTime() + 86_400_000).toISOString().slice(0, 10);
  const out: Forecast[] = [];
  for (const idx of store.all<PriceIndex>("priceIndexes")) {
    const history = store.all<IndexPrice>("indexPrices").filter((p) => p.indexId === idx.id).sort((a, b) => a.date.localeCompare(b.date));
    // Fill in realized directions for past forecasts that now have data.
    for (const f of store.all<Forecast>("forecasts").filter((f) => f.indexId === idx.id && !f.realizedDirection)) {
      const i = history.findIndex((p) => p.date === f.targetDate);
      if (i > 0) store.save("forecasts", { ...f, realizedDirection: realizedDirection(history[i - 1].value, history[i].value) });
    }
    const est = estimateDirection(history);
    const bt = backtest(history);
    const existing = store.all<Forecast>("forecasts").find((f) => f.indexId === idx.id && f.targetDate === tomorrow);
    const forecast: Forecast = {
      id: existing?.id ?? store.nextId("forecasts", "fc-"),
      indexId: idx.id,
      targetDate: tomorrow,
      direction: est.direction,
      confidence: est.confidence,
      modelVersion: MODEL_VERSION,
      rationale: `${est.rationale}. Backtest hit rate ${(bt.hitRate * 100).toFixed(0)}% over ${bt.total} days`,
    };
    store.save("forecasts", forecast);
    out.push(forecast);
  }
  const run: IntegrationRun = {
    id: store.nextId("integrationRuns", "run-"),
    kind: "forecast",
    startedAt,
    finishedAt: new Date().toISOString(),
    status: "success",
    recordsIn: out.length,
    recordsOut: out.length,
    summary: `Forecasts for ${tomorrow}: ${out.map((f) => `${store.require<PriceIndex>("priceIndexes", f.indexId).code} ${f.direction}`).join(", ")}`,
  };
  store.save("integrationRuns", run);
  return { run, forecasts: out };
}

export interface MarketSummaryRow {
  indexId: string;
  code: string;
  name: string;
  latest: number | null;
  change: number | null;
  date: string | null;
  sevenDayChange: number | null;
  forecast: { direction: string; confidence: number; targetDate: string; rationale: string } | null;
  hitRate: number | null;
  history: { date: string; value: number }[];
}

export function marketSummary(store: OpsStore, days = 30): MarketSummaryRow[] {
  return store.all<PriceIndex>("priceIndexes").map((idx) => {
    const history = store.all<IndexPrice>("indexPrices").filter((p) => p.indexId === idx.id).sort((a, b) => a.date.localeCompare(b.date));
    const latest = history[history.length - 1];
    const weekAgo = history[history.length - 8];
    const f = store.all<Forecast>("forecasts").filter((x) => x.indexId === idx.id).sort((a, b) => b.targetDate.localeCompare(a.targetDate))[0];
    const scored = store.all<Forecast>("forecasts").filter((x) => x.indexId === idx.id && x.realizedDirection);
    const hits = scored.filter((x) => x.realizedDirection === x.direction).length;
    return {
      indexId: idx.id,
      code: idx.code,
      name: idx.name,
      latest: latest?.value ?? null,
      change: latest?.change ?? null,
      date: latest?.date ?? null,
      sevenDayChange: latest && weekAgo ? Math.round((latest.value - weekAgo.value) * 10000) / 10000 : null,
      forecast: f ? { direction: f.direction, confidence: f.confidence, targetDate: f.targetDate, rationale: f.rationale } : null,
      hitRate: scored.length ? Math.round((hits / scored.length) * 100) / 100 : null,
      history: history.slice(-days).map((p) => ({ date: p.date, value: p.value })),
    };
  });
}
