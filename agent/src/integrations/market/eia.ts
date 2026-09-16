import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import type { IndexFetchResult, IndexQuote, IndexSource, IndexSourceContext } from "./source.js";

/**
 * EIA open data as the market feed (Module C). The U.S. Energy Information
 * Administration publishes daily spot prices (Gulf Coast and New York Harbor
 * diesel and gasoline) behind a free API key. Our index codes map to EIA
 * series in config/eia-series.json. Values are absolute $/gal and arrive a
 * business day or two behind, so every pull backfills recent days and a value
 * for a date we already hold replaces it.
 *
 * Free key: https://www.eia.gov/opendata/register.php
 */

const DEFAULT_MAP_PATH = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "config", "eia-series.json");

export interface EiaSeriesMapping {
  /** EIA series id, e.g. EER_EPD2DXL0_PF4_RGC_DPG. */
  series: string;
  /** Optional label overrides applied to the index once this feed is live. */
  name?: string;
  source?: string;
  note?: string;
}

export interface EiaSeriesMap {
  series: Record<string, EiaSeriesMapping>;
}

export interface EiaConfig {
  mode: "off" | "eia";
  apiKey: string;
  baseUrl: string;
  route: string;
  mapPath: string;
}

/** MARKET_FEED_MODE=eia|off decides explicitly; otherwise a set EIA_API_KEY turns the feed on. */
export function eiaConfigFromEnv(env: NodeJS.ProcessEnv = process.env): EiaConfig {
  const explicit = (env.MARKET_FEED_MODE ?? "").trim().toLowerCase();
  const apiKey = (env.EIA_API_KEY ?? "").trim();
  const mode: EiaConfig["mode"] = explicit ? (explicit === "eia" ? "eia" : "off") : apiKey ? "eia" : "off";
  return {
    mode,
    apiKey,
    baseUrl: (env.EIA_BASE_URL ?? "https://api.eia.gov/v2").replace(/\/+$/, ""),
    route: "petroleum/pri/spt/data/",
    mapPath: env.EIA_SERIES_MAP ?? DEFAULT_MAP_PATH,
  };
}

export function loadEiaSeriesMap(path: string = DEFAULT_MAP_PATH): EiaSeriesMap {
  const raw = JSON.parse(readFileSync(path, "utf8")) as Partial<EiaSeriesMap>;
  if (!raw || typeof raw.series !== "object" || raw.series === null) throw new Error(`${path}: expected { "series": { "<index code>": { "series": "<EIA series id>" } } }`);
  return { series: raw.series };
}

/** The request URL. The key travels as a query parameter, so this is never logged. */
export function eiaRequestUrl(cfg: EiaConfig, seriesIds: string[], start: string): string {
  const p = new URLSearchParams();
  p.set("api_key", cfg.apiKey);
  p.set("frequency", "daily");
  p.append("data[0]", "value");
  for (const id of seriesIds) p.append("facets[series][]", id);
  p.set("start", start);
  p.append("sort[0][column]", "period");
  p.append("sort[0][direction]", "desc");
  p.set("offset", "0");
  p.set("length", "5000");
  return `${cfg.baseUrl}/${cfg.route}?${p.toString()}`;
}

export interface EiaRow {
  period: string;
  series: string;
  value: number;
}

/** Rows from an EIA v2 payload. The API can report problems in an `error` field, so both are checked. */
export function parseEiaResponse(payload: unknown): EiaRow[] {
  const p = payload as { error?: unknown; response?: { data?: unknown } } | null;
  if (!p || typeof p !== "object") throw new Error("EIA returned an empty response");
  if (typeof p.error === "string") throw new Error(`EIA error: ${p.error}`);
  const data = p.response?.data;
  if (!Array.isArray(data)) throw new Error("EIA response has no data rows (check the API key and the series ids)");
  const rows: EiaRow[] = [];
  for (const raw of data) {
    const r = raw as Record<string, unknown>;
    const period = String(r.period ?? "");
    const series = String(r.series ?? "");
    if (r.value === null || r.value === undefined || r.value === "") continue; // EIA sends null for days without a value
    const value = Number(r.value);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(period) || !series || !Number.isFinite(value)) continue;
    rows.push({ period, series, value });
  }
  return rows;
}

export interface EiaDeps {
  fetcher?: typeof fetch;
  map?: EiaSeriesMap;
}

export function eiaIndexSource(cfg: EiaConfig, deps: EiaDeps = {}): IndexSource {
  const fetcher = deps.fetcher ?? fetch;
  const mapOf = (): EiaSeriesMap => deps.map ?? loadEiaSeriesMap(cfg.mapPath);
  return {
    describe: () => {
      let mapped = 0;
      try {
        mapped = Object.keys(mapOf().series).length;
      } catch {
        /* reported when the feed runs */
      }
      return {
        kind: "eia",
        name: "EIA open data (daily spot prices)",
        configured: !!cfg.apiKey,
        mode: "https",
        detail: `${cfg.baseUrl}/${cfg.route.replace(/\/?data\/?$/, "")}; ${mapped} index code(s) mapped in config/eia-series.json; values lag a business day or two`,
      };
    },
    async fetch(ctx: IndexSourceContext): Promise<IndexFetchResult> {
      if (!cfg.apiKey) throw new Error("EIA_API_KEY is not set (free key: https://www.eia.gov/opendata/register.php)");
      const map = mapOf();
      const skipped: IndexFetchResult["skipped"] = [];
      const byCode = new Map<string, EiaSeriesMapping>();
      for (const idx of ctx.indexes) {
        const m = map.series[idx.code];
        if (m?.series) byCode.set(idx.code, m);
        else skipped.push({ ref: idx.code, reason: "no EIA series mapped in config/eia-series.json" });
      }
      const seriesIds = [...new Set([...byCode.values()].map((m) => m.series))];
      if (seriesIds.length === 0) return { quotes: [], skipped, detail: "no index is mapped to an EIA series" };
      const res = await fetcher(eiaRequestUrl(cfg, seriesIds, ctx.since), { headers: { accept: "application/json" }, signal: AbortSignal.timeout(20_000) });
      if (!res.ok) throw new Error(`EIA responded ${res.status}${res.statusText ? ` ${res.statusText}` : ""}`);
      const rows = parseEiaResponse(await res.json());
      const returned = new Set(rows.map((r) => r.series));
      const quotes: IndexQuote[] = [];
      const relabel: NonNullable<IndexFetchResult["relabel"]> = {};
      for (const [code, m] of byCode) {
        if (!returned.has(m.series)) {
          skipped.push({ ref: code, reason: `EIA returned no rows for ${m.series} since ${ctx.since}` });
          continue;
        }
        for (const r of rows) if (r.series === m.series && r.value > 0) quotes.push({ indexCode: code, date: r.period, value: Math.round(r.value * 10000) / 10000 });
        if (m.name || m.source) relabel[code] = { name: m.name, source: m.source };
      }
      return { quotes, skipped, relabel, detail: `${rows.length} row(s) from EIA for ${seriesIds.length} series since ${ctx.since}` };
    },
  };
}

/** The index source for this deployment: EIA when configured, otherwise null (the caller falls back to the sample feed). */
export function resolveIndexSource(env: NodeJS.ProcessEnv = process.env): IndexSource | null {
  const cfg = eiaConfigFromEnv(env);
  return cfg.mode === "eia" ? eiaIndexSource(cfg) : null;
}
