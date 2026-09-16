// Generates the sample attachments once: a purchase-order PDF (hand-built, uncompressed)
// and an .xlsx order sheet (SheetJS). Date tokens stay literal inside the files and are
// resolved after text extraction, so the samples never go stale.
import { writeFileSync } from "node:fs";
import XLSX from "xlsx";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
const OUT = process.argv[2] ?? join(dirname(fileURLToPath(import.meta.url)), "..", "samples", "attachments");

function pdfWithLines(lines) {
  const esc = (s) => s.replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");
  let y = 740;
  const ops = ["BT", "/F1 12 Tf", "14 TL", `72 ${y} Td`];
  for (const line of lines) { ops.push(`(${esc(line)}) Tj`, "T*"); }
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

const pdf = pdfWithLines([
  "TRINITY RIVER CONTRACTORS",
  "PURCHASE ORDER",
  "PO: TRC-5591",
  "Vendor: Royalty Petroleums Group",
  "Deliver to: Dallas Laydown Yard, Dallas TX",
  "Product: Clear ULSD #2 diesel",
  "Gallons: 6,000",
  "Requested date: {{DATE+2}}",
  "Notes: Fill the two 3,000 gal skid tanks; call Alicia Grant on arrival.",
]);
writeFileSync(`${OUT}/PO-TRC-5591.pdf`, pdf);

const wb = XLSX.utils.book_new();
const ws = XLSX.utils.aoa_to_sheet([
  ["Store", "Deliver to", "Product", "Gallons", "Requested date", "PO", "Notes"],
  ["Store 21", "Store 21 - Cleburne", "Regular unleaded 87", 8500, "{{DATE+1}}", "QSM-7745", "Before 10am"],
  ["Store 33", "Store 33 - Corsicana", "Premium 93", 4000, "{{DATE+2}}", "QSM-7746", ""],
]);
XLSX.utils.book_append_sheet(wb, ws, "Orders");
writeFileSync(`${OUT}/store-fuel-orders.xlsx`, XLSX.write(wb, { type: "buffer", bookType: "xlsx" }));

const csv = [
  "customer,location,product,gallons,requested date,po,notes",
  "Prairie Trucking Fleet,Fort Worth Yard,ULSD,6500,{{DATE+1}},PTF-0911,Fill both saddle tanks",
  "Prairie Trucking Fleet,Fort Worth Yard,ULSD,6500,{{DATE+3}},PTF-0912,",
  "Prairie Trucking Fleet,Fort Worth Yard,DEF,500,{{DATE+3}},PTF-0913,Bulk DEF tote",
].join("\n");
writeFileSync(`${OUT}/fuel-schedule.csv`, csv);
console.log("samples written:", pdf.length, "byte pdf");
