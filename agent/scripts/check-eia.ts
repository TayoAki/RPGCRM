// Dry run for the EIA market feed: pulls the series mapped in config/eia-series.json
// with EIA_API_KEY and prints what the market feed would store. Nothing is written.
//   cd agent && EIA_API_KEY=... npx tsx scripts/check-eia.ts [days]
import { eiaConfigFromEnv, eiaIndexSource, loadEiaSeriesMap } from "../src/integrations/market/eia.js";

const cfg = eiaConfigFromEnv({ ...process.env, MARKET_FEED_MODE: "eia" });
if (!cfg.apiKey) {
  console.error("Set EIA_API_KEY first (free key: https://www.eia.gov/opendata/register.php).");
  process.exit(1);
}
const days = Math.max(1, Number(process.argv[2]) || 14);
const map = loadEiaSeriesMap(cfg.mapPath);
const indexes = Object.keys(map.series).map((code, i) => ({ id: `idx-${i}`, code, name: code, source: "?" }));
const source = eiaIndexSource(cfg, { map });
const now = new Date();
const since = new Date(now.getTime() - days * 86_400_000).toISOString().slice(0, 10);
console.log(`${source.describe().name}: ${source.describe().detail}`);
console.log(`Pulling ${indexes.length} mapped index code(s) since ${since}...`);
const result = await source.fetch({ indexes, latest: {}, since }, now);
console.log(result.detail ?? "");
for (const idx of indexes) {
  const quotes = result.quotes.filter((q) => q.indexCode === idx.code).sort((a, b) => a.date.localeCompare(b.date));
  const label = map.series[idx.code].name ?? idx.code;
  if (!quotes.length) {
    console.log(`\n${idx.code} (${map.series[idx.code].series}): no values`);
    continue;
  }
  console.log(`\n${idx.code} → ${label} (${map.series[idx.code].series}): ${quotes.length} value(s), latest ${quotes.at(-1)!.date} = $${quotes.at(-1)!.value.toFixed(4)}`);
  for (const q of quotes.slice(-5)) console.log(`  ${q.date}  ${q.value.toFixed(4)}`);
}
if (result.skipped.length) {
  console.log("\nSkipped:");
  for (const s of result.skipped) console.log(`  ${s.ref}: ${s.reason}`);
}
