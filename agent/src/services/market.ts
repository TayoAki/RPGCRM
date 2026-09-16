import type { OpsStore } from "../domain/store.js";
import type { Forecast, IndexPrice, IntegrationRun, PriceIndex } from "../domain/types.js";
import { backtest, estimateDirection, MODEL_VERSION, realizedDirection } from "../market/forecast.js";
import { recomputeExceptions } from "./context.js";

import { sampleIndexSource } from "../integrations/market/source.js";
import type { IndexFetchResult, IndexSource, IndexSourceStatus } from "../integrations/market/source.js";
import { resolveIndexSource } from "../integrations/market/eia.js";

const r4 = (n: number): number => Math.round(n * 10000) / 10000;

/** How far back a backfilling source (EIA) is asked to look on every pull. */
export const INDEX_BACKFILL_DAYS = 35;

export interface RefreshIndexResult {
  run: IntegrationRun;
  updated: IndexPrice[];
  skipped: IndexFetchResult["skipped"];
  source: IndexSourceStatus;
}

/**
 * Module C: pull index values from the market feed (the sample file, or EIA
 * open data when EIA_API_KEY is set) and store them. Quotes are absolute
 * values per date: new dates are added, a quote for a date already held
 * replaces it (real values overwrite the seeded history), and day-over-day
 * changes are recomputed for the indexes touched. A source failure is
 * recorded as a failed run rather than thrown.
 */
export async function refreshIndexFeed(store: OpsStore, now: Date = new Date(), source: IndexSource = resolveIndexSource() ?? sampleIndexSource()): Promise<RefreshIndexResult> {
  const startedAt = now.toISOString();
  const today = now.toISOString().slice(0, 10);
  const status = source.describe();
  const indexes = store.all<PriceIndex>("priceIndexes");
  const latest: Record<string, { date: string; value: number } | undefined> = {};
  for (const idx of indexes) {
    const last = store.all<IndexPrice>("indexPrices").filter((p) => p.indexId === idx.id).sort((a, b) => b.date.localeCompare(a.date))[0];
    latest[idx.code] = last ? { date: last.date, value: last.value } : undefined;
  }
  const since = new Date(now.getTime() - INDEX_BACKFILL_DAYS * 86_400_000).toISOString().slice(0, 10);
  let fetched: IndexFetchResult;
  try {
    fetched = await source.fetch({ indexes, latest, since }, now);
  } catch (e) {
    const run: IntegrationRun = {
      id: store.nextId("integrationRuns", "run-"),
      kind: "index_feed",
      startedAt,
      finishedAt: new Date().toISOString(),
      status: "failed",
      recordsIn: 0,
      recordsOut: 0,
      summary: `Market feed pull failed: ${(e as Error).message}`,
      source: status.name,
    };
    store.save("integrationRuns", run);
    return { run, updated: [], skipped: [], source: status };
  }
  const skipped = [...fetched.skipped];
  const updatedIds: string[] = [];
  const touched = new Set<string>();
  for (const q of fetched.quotes) {
    const idx = indexes.find((i) => i.code === q.indexCode);
    if (!idx) {
      skipped.push({ ref: q.indexCode, reason: "unknown index code" });
      continue;
    }
    if (q.date > today) {
      skipped.push({ ref: `${q.indexCode}@${q.date}`, reason: "date is in the future" });
      continue;
    }
    if (!(q.value > 0)) {
      skipped.push({ ref: `${q.indexCode}@${q.date}`, reason: "value must be positive" });
      continue;
    }
    const existing = store.all<IndexPrice>("indexPrices").find((p) => p.indexId === idx.id && p.date === q.date);
    if (existing && Math.abs(existing.value - q.value) < 0.00005) continue;
    const row: IndexPrice = { id: existing?.id ?? store.nextId("indexPrices", "ip-"), indexId: idx.id, date: q.date, value: r4(q.value), change: existing?.change ?? 0 };
    store.save("indexPrices", row);
    updatedIds.push(row.id);
    touched.add(idx.id);
  }
  for (const indexId of touched) {
    const hist = store.all<IndexPrice>("indexPrices").filter((p) => p.indexId === indexId).sort((a, b) => a.date.localeCompare(b.date));
    hist.forEach((p, i) => {
      if (i === 0) return;
      const change = r4(p.value - hist[i - 1].value);
      if (change !== p.change) store.save("indexPrices", { ...p, change });
    });
  }
  for (const [code, label] of Object.entries(fetched.relabel ?? {})) {
    const idx = indexes.find((i) => i.code === code);
    if (!idx) continue;
    const next: PriceIndex = { ...idx, name: label.name ?? idx.name, source: label.source ?? idx.source };
    if (next.name !== idx.name || next.source !== idx.source) store.save("priceIndexes", next);
  }
  const updated = updatedIds.map((id) => store.require<IndexPrice>("indexPrices", id));
  const latestDate = updated.reduce((m, p) => (p.date > m ? p.date : m), "");
  const run: IntegrationRun = {
    id: store.nextId("integrationRuns", "run-"),
    kind: "index_feed",
    startedAt,
    finishedAt: new Date().toISOString(),
    status: skipped.length ? "partial" : "success",
    recordsIn: fetched.quotes.length,
    recordsOut: updated.length,
    summary:
      (updated.length ? `${updated.length} index value(s) updated${latestDate ? ` through ${latestDate}` : ""}` : `Indexes already current for ${today}`) +
      (skipped.length ? `; ${skipped.length} skipped` : ""),
    source: status.name,
  };
  store.save("integrationRuns", run);
  recomputeExceptions(store, now);
  return { run, updated, skipped, source: status };
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
