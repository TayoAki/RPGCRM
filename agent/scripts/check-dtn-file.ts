// Dry run for a DTN export: shows how each row maps with config/dtn-bol-map.json
// and what would be skipped. Nothing is written. Usage:
//   npx tsx scripts/check-dtn-file.ts path/to/export.csv [path/to/map.json]
import { readFileSync } from "node:fs";
import { detectFormat, loadDtnFieldMap, parseDtnPayload } from "../src/integrations/bol/dtn.js";

const [file, mapPath] = process.argv.slice(2);
if (!file) {
  console.error("usage: npx tsx scripts/check-dtn-file.ts <export.csv|export.json> [map.json]");
  process.exit(2);
}
const text = readFileSync(file, "utf8");
const map = loadDtnFieldMap(mapPath);
const { records, skipped } = parseDtnPayload(text, detectFormat(text), map);
console.log(`${records.length} BOL(s) would be ingested, ${skipped.length} row(s)/BOL(s) skipped\n`);
for (const r of records) {
  console.log(`${r.bolNumber}  ${r.supplierCode} @ ${r.terminalCode}  carrier ${r.carrierCode}  lifted ${r.liftedAt}  → ${r.customerRef} (${r.destinationText})`);
  for (const l of r.lines) console.log(`    ${l.productCode}  gross ${l.grossGallons}  net ${l.netGallons}  cost ${l.supplierCostPerGallon}  taxes ${l.taxesPerGallon ?? "-"}  fees ${l.feesPerGallon ?? "-"}`);
}
if (skipped.length) {
  console.log("\nSkipped:");
  for (const s of skipped) console.log(`  ${s.ref}: ${s.reason}`);
}
console.log("\nCodes that are not in the platform will be reported again when the feed is pulled; add them to config/dtn-bol-map.json.");
