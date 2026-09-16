import { loadSample } from "../../samples/loader.js";
import type { PriceIndex } from "../../domain/types.js";

/**
 * Where market index values come from (Module C). The platform stores one
 * shape, a dated $/gal value per index; a source only has to produce it.
 * Today: the sample file of daily moves, or EIA open data when configured
 * (see eia.ts). A licensed vendor (OPIS, Argus, a CME redistributor) would be
 * another source with the same interface.
 */

/** A dated absolute value for one of our indexes. */
export interface IndexQuote {
  indexCode: string;
  /** yyyy-mm-dd */
  date: string;
  value: number;
}

export interface IndexSourceStatus {
  kind: "sample" | "eia";
  name: string;
  configured: boolean;
  mode?: string;
  detail?: string;
}

export interface IndexFetchResult {
  quotes: IndexQuote[];
  skipped: { ref: string; reason: string }[];
  /** Human-readable note about this fetch (file read, endpoint called). */
  detail?: string;
  /** Display overrides for indexes this source feeds, so the Market page says what it now shows. */
  relabel?: Record<string, { name?: string; source?: string }>;
}

/** What a source gets: our indexes, the latest stored value per code, and how far back to look. */
export interface IndexSourceContext {
  indexes: PriceIndex[];
  latest: Record<string, { date: string; value: number } | undefined>;
  /** yyyy-mm-dd; sources that backfill start here. */
  since: string;
}

export interface IndexSource {
  describe(): IndexSourceStatus;
  fetch(ctx: IndexSourceContext, now: Date): Promise<IndexFetchResult>;
}

const r4 = (n: number): number => Math.round(n * 10000) / 10000;

/** The sample feed under agent/samples/index-feed.json: daily moves applied to the last stored value. */
export function sampleIndexSource(): IndexSource {
  return {
    describe: () => ({ kind: "sample", name: "Sample feed", configured: true, detail: "agent/samples/index-feed.json; set EIA_API_KEY to pull EIA spot prices instead" }),
    async fetch(ctx, now) {
      const today = now.toISOString().slice(0, 10);
      const file = loadSample<{ changes: { indexCode: string; change: number }[] }>("index-feed.json", now);
      const quotes: IndexQuote[] = [];
      const skipped: IndexFetchResult["skipped"] = [];
      for (const ch of file.changes) {
        if (!ctx.indexes.some((i) => i.code === ch.indexCode)) {
          skipped.push({ ref: ch.indexCode, reason: "unknown index code in the sample feed" });
          continue;
        }
        const last = ctx.latest[ch.indexCode];
        if (last && last.date >= today) continue; // already current
        quotes.push({ indexCode: ch.indexCode, date: today, value: r4((last?.value ?? 2.5) + ch.change) });
      }
      return { quotes, skipped, detail: `${file.changes.length} move(s) in the sample feed` };
    },
  };
}
