import { readFileSync } from "node:fs";
import { PDFParse } from "pdf-parse";
import XLSX from "xlsx";
import { samplePath } from "../samples/loader.js";

/**
 * Attachment extraction for order intake (Module H). Spreadsheets become rows,
 * documents become text; either is then fed through the same parser as an
 * email body, so labeled columns and labeled lines are handled identically.
 * Sample attachments are files under agent/samples/attachments; a real mailbox
 * connector would pass bytes (contentBase64) instead.
 */

export interface AttachmentInput {
  filename: string;
  contentType: string;
  /** Inline text (small samples). */
  text?: string;
  /** Raw bytes, base64 (what a mailbox connector would supply). */
  contentBase64?: string;
  /** Path relative to agent/samples (sample data). */
  file?: string;
}

export type Extracted =
  | { kind: "text"; text: string }
  | { kind: "rows"; rows: Record<string, string>[]; sheet?: string }
  | { kind: "unsupported"; reason: string };

export function attachmentBytes(att: AttachmentInput): Buffer | undefined {
  if (att.contentBase64) return Buffer.from(att.contentBase64, "base64");
  if (att.file) return readFileSync(samplePath(att.file));
  if (att.text !== undefined) return Buffer.from(att.text, "utf8");
  return undefined;
}

/** Minimal RFC 4180 reader: quoted fields, doubled quotes, CR/LF rows, comma or tab separated. */
export function parseCsv(text: string): Record<string, string>[] {
  const sep = text.split(/\r?\n/)[0]?.includes("\t") ? "\t" : ",";
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; } else quoted = false;
      } else field += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === sep) { row.push(field); field = ""; }
    else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(field); field = "";
      if (row.some((c) => c.trim() !== "")) rows.push(row);
      row = [];
    } else field += ch;
  }
  if (field !== "" || row.length) { row.push(field); if (row.some((c) => c.trim() !== "")) rows.push(row); }
  if (rows.length === 0) return [];
  const headers = rows[0].map((h) => h.trim());
  return rows.slice(1).map((r) => Object.fromEntries(headers.map((h, i) => [h, (r[i] ?? "").trim()])));
}

const isSpreadsheet = (type: string, name: string): boolean =>
  type.includes("spreadsheetml") || type === "application/vnd.ms-excel" || /\.xlsx?$/.test(name);

export async function extractAttachment(att: AttachmentInput): Promise<Extracted> {
  const type = (att.contentType ?? "").toLowerCase();
  const name = att.filename.toLowerCase();
  const bytes = attachmentBytes(att);
  if (!bytes || bytes.length === 0) return { kind: "unsupported", reason: "no content" };
  if (type.startsWith("text/csv") || type === "text/tab-separated-values" || /\.(csv|tsv)$/.test(name)) {
    return { kind: "rows", rows: parseCsv(bytes.toString("utf8")) };
  }
  if (type.startsWith("text/") || /\.(txt|md)$/.test(name)) return { kind: "text", text: bytes.toString("utf8") };
  if (type === "application/pdf" || name.endsWith(".pdf")) {
    const parser = new PDFParse({ data: bytes });
    try {
      const result = await parser.getText();
      return { kind: "text", text: result.text };
    } finally {
      await parser.destroy();
    }
  }
  if (isSpreadsheet(type, name)) {
    const wb = XLSX.read(bytes, { type: "buffer" });
    const sheet = wb.SheetNames[0];
    if (!sheet) return { kind: "rows", rows: [] };
    const raw = XLSX.utils.sheet_to_json<Record<string, unknown>>(wb.Sheets[sheet], { defval: "", raw: false });
    const rows = raw.map((r) => Object.fromEntries(Object.entries(r).map(([k, v]) => [String(k).trim(), String(v ?? "").trim()])));
    return { kind: "rows", rows, sheet };
  }
  return { kind: "unsupported", reason: `${att.contentType || "unknown type"} is not parsed` };
}

/** Column headers we recognize, mapped to the labels the email parser understands. */
const HEADER_LABELS: [label: string, synonyms: string[]][] = [
  ["Customer", ["customer", "account", "company", "client", "customer name"]],
  ["Location", ["location", "site", "deliver to", "delivery location", "ship to", "destination", "delivery site", "yard", "store"]],
  ["Product", ["product", "fuel", "grade", "fuel type", "fuel grade"]],
  ["Gallons", ["gallons", "gal", "qty", "quantity", "volume", "gallons requested"]],
  ["Requested date", ["requested date", "delivery date", "date", "needed by", "deliver on", "when", "ship date", "requested"]],
  ["PO", ["po", "po #", "po#", "p.o.", "purchase order", "reference", "ref", "po number"]],
  ["Notes", ["notes", "note", "instructions", "special instructions", "comments", "remarks"]],
];

const normalize = (h: string): string => h.toLowerCase().replace(/[_\-]+/g, " ").replace(/\s+/g, " ").trim();

/**
 * Turn a spreadsheet row into the labeled-line form the email parser reads
 * ("Gallons: 6500"). Columns we do not recognize are ignored; a more specific
 * column (e.g. "Deliver to") wins over a looser one (e.g. "Store") for the same field.
 */
export function rowToLabeledText(row: Record<string, string>): string {
  const picked = new Map<string, { value: string; rank: number }>();
  for (const [header, value] of Object.entries(row)) {
    if (!value || !value.trim()) continue;
    const h = normalize(header);
    for (const [label, synonyms] of HEADER_LABELS) {
      const rank = synonyms.indexOf(h);
      if (rank === -1) continue;
      const cur = picked.get(label);
      if (!cur || rank < cur.rank) picked.set(label, { value: value.trim(), rank });
    }
  }
  return HEADER_LABELS.filter(([label]) => picked.has(label)).map(([label]) => `${label}: ${picked.get(label)!.value}`).join("\n");
}
