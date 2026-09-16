// Generates the sample supplier rack sheets testers can upload on the Pricing page:
// a Marathon CSV export, a Valero PDF price notice (hand-built, uncompressed), and a
// Motiva Excel sheet without a supplier column. Written to agent/samples/rack-sheets
// and copied to frontend/public/samples for the download links in the app.
import { mkdirSync, writeFileSync } from "node:fs";
import XLSX from "xlsx";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const OUTS = process.argv.length > 2 ? process.argv.slice(2) : [join(here, "..", "samples", "rack-sheets"), join(here, "..", "..", "frontend", "public", "samples")];

function pdfWithLines(lines) {
  const esc = (s) => s.replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");
  const ops = ["BT", "/F1 12 Tf", "14 TL", "72 740 Td"];
  for (const line of lines) ops.push(`(${esc(line)}) Tj`, "T*");
  ops.push("ET");
  const stream = ops.join("\n");
  const objs = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>",
    `<< /Length ${Buffer.byteLength(stream, "latin1")} >>\nstream\n${stream}\nendstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];
  let out = "%PDF-1.4\n";
  const offsets = [];
  objs.forEach((body, i) => { offsets.push(Buffer.byteLength(out, "latin1")); out += `${i + 1} 0 obj\n${body}\nendobj\n`; });
  const xref = Buffer.byteLength(out, "latin1");
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n` + offsets.map((o) => String(o).padStart(10, "0") + " 00000 n \n").join("");
  out += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out, "latin1");
}

const csv = [
  "Supplier,Terminal,Product,Price ($/gal)",
  "Marathon Petroleum,Dallas Terminal,ULSD Clear #2,2.4725",
  "Marathon Petroleum,Dallas Terminal,Dyed ULSD Off-Road,2.3910",
  "Marathon Petroleum,Dallas Terminal,Regular Unleaded 87 E10,2.1480",
  "Marathon Petroleum,Dallas Terminal,Premium Unleaded 93,2.6120",
  "Marathon Petroleum,Fort Worth Terminal,ULSD Clear #2,2.4850",
  "Marathon Petroleum,Fort Worth Terminal,Dyed ULSD Off-Road,2.4030",
  "Marathon Petroleum,Fort Worth Terminal,Regular Unleaded 87 E10,2.1595",
  "Marathon Petroleum,Fort Worth Terminal,Premium Unleaded 93,2.6240",
].join("\n");

const pdf = pdfWithLines([
  "VALERO MARKETING AND SUPPLY",
  "Daily Rack Price Notice - Texas",
  "Prices effective at 18:00 today. All prices $/gallon, excluding taxes and fees.",
  "",
  "Fort Worth Terminal",
  "ULSD Clear #2 Diesel        2.4795",
  "Dyed ULSD Off-Road          2.3980",
  "Unleaded 87 E10             2.1510",
  "Premium 93                  2.6205",
  "",
  "Houston Pasadena Terminal",
  "ULSD Clear #2 Diesel        2.4610",
  "Dyed ULSD Off-Road          2.3790",
  "Unleaded 87 E10             2.1330",
  "Premium 93                  2.6010",
  "",
  "Questions: rackdesk@valero.example",
]);

const wb = XLSX.utils.book_new();
const ws = XLSX.utils.aoa_to_sheet([
  ["Location", "Grade", "Rack Price", "Move"],
  ["Dallas", "ULSD", 2.469, 0.0075],
  ["Dallas", "Dyed Diesel", 2.388, 0.0075],
  ["Dallas", "Unleaded 87", 2.145, -0.004],
  ["Dallas", "Premium 93", 2.609, -0.004],
  ["Dallas", "DEF", 2.95, 0],
  ["Houston", "ULSD", 2.454, 0.0075],
  ["Houston", "Dyed Diesel", 2.373, 0.0075],
  ["Houston", "Unleaded 87", 2.129, -0.004],
  ["Houston", "Premium 93", 2.596, -0.004],
]);
XLSX.utils.book_append_sheet(wb, ws, "Rack");
const xlsx = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });

for (const out of OUTS) {
  mkdirSync(out, { recursive: true });
  writeFileSync(join(out, "marathon-rack-sheet.csv"), csv);
  writeFileSync(join(out, "valero-rack-notice.pdf"), pdf);
  writeFileSync(join(out, "motiva-rack-sheet.xlsx"), xlsx);
  console.log(`wrote 3 sample rack sheets to ${out}`);
}
