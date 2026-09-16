import { describe, it, expect } from "vitest";
import { INDEX_BACKFILL_DAYS, marketSummary, refreshIndexFeed } from "../services/market.js";
import { sampleIndexSource } from "../integrations/market/source.js";
import { eiaConfigFromEnv, eiaIndexSource, eiaRequestUrl, loadEiaSeriesMap, parseEiaResponse, resolveIndexSource } from "../integrations/market/eia.js";
import type { IndexPrice, IntegrationRun, PriceIndex } from "../domain/types.js";
import { freshStore, NOW } from "./helpers.js";

const cfg = eiaConfigFromEnv({ EIA_API_KEY: "test-key" });
const MAP = {
  series: {
    "OPIS-DAL-ULSD": { series: "EER_EPD2DXL0_PF4_RGC_DPG", name: "Gulf Coast ULSD spot (EIA)", source: "EIA" },
    "NYMEX-HO": { series: "EER_EPD2DXL0_PF4_Y35NY_DPG", name: "New York Harbor ULSD spot (EIA)", source: "EIA" },
  },
};

function fakeFetch(rows: { period: string; series: string; value: string | number | null }[]) {
  const calls: string[] = [];
  const fetcher = (async (url: string | URL | Request) => {
    calls.push(String(url));
    return new Response(JSON.stringify({ response: { total: String(rows.length), data: rows } }), { status: 200, headers: { "content-type": "application/json" } });
  }) as unknown as typeof fetch;
  return { fetcher, calls };
}

describe("market feed sources (Module C)", () => {
  it("sample feed adds today's value per index once and records the source", async () => {
    const store = freshStore();
    const r = await refreshIndexFeed(store, NOW, sampleIndexSource());
    expect(r.source.kind).toBe("sample");
    expect(r.updated.length).toBe(4);
    expect(r.run.source).toBe("Sample feed");
    expect(r.run.status).toBe("success");
    const again = await refreshIndexFeed(store, NOW, sampleIndexSource());
    expect(again.updated.length).toBe(0);
    expect(again.run.summary).toMatch(/already current/);
  });

  it("EIA backfills recent days, replaces stored values for the same date, recomputes changes, and relabels the index", async () => {
    const store = freshStore();
    const idx = store.all<PriceIndex>("priceIndexes").find((i) => i.code === "OPIS-DAL-ULSD")!;
    const before = store.all<IndexPrice>("indexPrices").filter((p) => p.indexId === idx.id).sort((a, b) => a.date.localeCompare(b.date));
    const yesterday = before.at(-1)!;
    expect(yesterday.date).toBe("2026-09-15");
    const rows = [
      { period: "2026-09-15", series: "EER_EPD2DXL0_PF4_RGC_DPG", value: "2.5010" },
      { period: "2026-09-12", series: "EER_EPD2DXL0_PF4_RGC_DPG", value: "2.4900" },
      { period: "2026-09-15", series: "EER_EPD2DXL0_PF4_Y35NY_DPG", value: 2.6 },
      { period: "2026-09-14", series: "EER_EPD2DXL0_PF4_Y35NY_DPG", value: "2.58" },
      { period: "2026-09-20", series: "EER_EPD2DXL0_PF4_Y35NY_DPG", value: "9.99" },
    ];
    const { fetcher, calls } = fakeFetch(rows);
    const r = await refreshIndexFeed(store, NOW, eiaIndexSource(cfg, { fetcher, map: MAP }));
    expect(r.source.kind).toBe("eia");
    expect(r.run.source).toBe("EIA open data (daily spot prices)");
    expect(calls.length).toBe(1);
    expect(calls[0]).toContain("api_key=test-key");
    expect(calls[0]).toContain("EER_EPD2DXL0_PF4_RGC_DPG");
    expect(calls[0]).toContain(`start=${new Date(NOW.getTime() - INDEX_BACKFILL_DAYS * 86_400_000).toISOString().slice(0, 10)}`);
    const after = store.all<IndexPrice>("indexPrices").filter((p) => p.indexId === idx.id).sort((a, b) => a.date.localeCompare(b.date));
    expect(after.length).toBe(before.length);
    const d15 = after.find((p) => p.date === "2026-09-15")!;
    expect(d15.id).toBe(yesterday.id);
    expect(d15.value).toBe(2.501);
    const d14 = after.find((p) => p.date === "2026-09-14")!;
    expect(d15.change).toBeCloseTo(2.501 - d14.value, 4);
    expect(after.find((p) => p.date === "2026-09-12")!.value).toBe(2.49);
    expect(r.skipped.map((s) => s.ref).sort()).toEqual(["NYMEX-HO@2026-09-20", "NYMEX-RBOB", "OPIS-DAL-UNL87"]);
    expect(r.run.status).toBe("partial");
    expect(r.updated.length).toBe(4);
    const relabeled = store.require<PriceIndex>("priceIndexes", idx.id);
    expect(relabeled.name).toBe("Gulf Coast ULSD spot (EIA)");
    expect(relabeled.source).toBe("EIA");
    expect(marketSummary(store).find((m) => m.code === "OPIS-DAL-ULSD")!.latest).toBe(2.501);
    const again = await refreshIndexFeed(store, NOW, eiaIndexSource(cfg, { fetcher, map: MAP }));
    expect(again.updated.length).toBe(0);
    expect(again.run.summary).toMatch(/already current/);
  });

  it("records a failed run when EIA is unreachable or rejects the key, and leaves prices alone", async () => {
    const store = freshStore();
    const count = store.all("indexPrices").length;
    const runsBefore = store.all<IntegrationRun>("integrationRuns").filter((x) => x.kind === "index_feed").length;
    const down = (async () => {
      throw new Error("connect ECONNREFUSED");
    }) as unknown as typeof fetch;
    const r = await refreshIndexFeed(store, NOW, eiaIndexSource(cfg, { fetcher: down, map: MAP }));
    expect(r.run.status).toBe("failed");
    expect(r.run.summary).toMatch(/ECONNREFUSED/);
    expect(store.all("indexPrices").length).toBe(count);
    const rejected = (async () => new Response(JSON.stringify({ error: "invalid api key" }), { status: 200 })) as unknown as typeof fetch;
    const r2 = await refreshIndexFeed(store, NOW, eiaIndexSource(cfg, { fetcher: rejected, map: MAP }));
    expect(r2.run.status).toBe("failed");
    expect(r2.run.summary).toMatch(/invalid api key/);
    const http = (async () => new Response("nope", { status: 403, statusText: "Forbidden" })) as unknown as typeof fetch;
    const r3 = await refreshIndexFeed(store, NOW, eiaIndexSource(cfg, { fetcher: http, map: MAP }));
    expect(r3.run.summary).toMatch(/403/);
    expect(store.all<IntegrationRun>("integrationRuns").filter((x) => x.kind === "index_feed").length).toBe(runsBefore + 3);
  });

  it("parses EIA payloads defensively and builds the request from the shipped crosswalk", () => {
    expect(parseEiaResponse({ response: { data: [{ period: "2026-09-15", series: "S", value: "2.5" }, { period: "bad", series: "S", value: "1" }, { period: "2026-09-14", series: "S", value: null }] } })).toEqual([{ period: "2026-09-15", series: "S", value: 2.5 }]);
    expect(() => parseEiaResponse({ error: "invalid api key" })).toThrow(/invalid api key/);
    expect(() => parseEiaResponse({ response: {} })).toThrow(/no data rows/);
    const url = eiaRequestUrl(cfg, ["A", "B"], "2026-08-12");
    expect(url.startsWith("https://api.eia.gov/v2/petroleum/pri/spt/data/?")).toBe(true);
    expect(url).toContain("frequency=daily");
    expect(decodeURIComponent(url)).toContain("facets[series][]=A");
    expect(decodeURIComponent(url)).toContain("facets[series][]=B");
    const shipped = loadEiaSeriesMap();
    expect(Object.keys(shipped.series).sort()).toEqual(["NYMEX-HO", "NYMEX-RBOB", "OPIS-DAL-ULSD", "OPIS-DAL-UNL87"]);
    expect(Object.values(shipped.series).every((m) => /^EER_/.test(m.series))).toBe(true);
  });

  it("resolves the source from the environment and never exposes the key", () => {
    expect(resolveIndexSource({})).toBeNull();
    expect(resolveIndexSource({ EIA_API_KEY: "k" })?.describe().kind).toBe("eia");
    expect(resolveIndexSource({ EIA_API_KEY: "k", MARKET_FEED_MODE: "off" })).toBeNull();
    expect(resolveIndexSource({ MARKET_FEED_MODE: "eia" })?.describe().configured).toBe(false);
    const described = eiaIndexSource(cfg, { map: MAP }).describe();
    expect(described.configured).toBe(true);
    expect(described.detail).toContain("2 index code(s) mapped");
    expect(described.detail).not.toContain("test-key");
  });
});
