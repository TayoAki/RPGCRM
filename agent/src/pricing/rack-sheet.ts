import { createHash } from "node:crypto";
import type { Product, Supplier, Terminal } from "../domain/types.js";
import { guessProduct } from "../domain/store.js";
import { attachmentBytes, extractAttachment } from "../intake/attachments.js";
import type { AttachmentInput } from "../intake/attachments.js";
import type { RackFeedPosting } from "../services/pricing.js";

/**
 * Turn a supplier's daily rack sheet, as the supplier sends it (a CSV or Excel
 * export, a PDF price notice, or pasted text), into rack feed postings for
 * importRackFeed. Tabular files are read by column; documents are read line by
 * line, where a line naming a terminal sets the terminal for the product and
 * price lines under it. Names on the sheet are matched to our suppliers,
 * terminals, and products; anything that cannot be matched is passed through
 * as written, so the import reports it as skipped in the sheet's own words.
 * Postings carry a reference built from the file's content hash, so the same
 * sheet uploaded twice imports nothing the second time.
 */

export interface RackSheetRefData {
  suppliers: Supplier[];
  terminals: Terminal[];
  products: Product[];
}

export interface RackSheetOptions {
  /** Supplier the sheet came from, for sheets that do not name one. */
  supplierCode?: string;
  /** Effective time for rows without one (ISO). Defaults to now. */
  effectiveAt?: string;
}

export interface RackSheetParse {
  postings: RackFeedPosting[];
  unparsed: { line: string; reason: string }[];
  format: "rows" | "text";
  /** Rows or lines examined. */
  lines: number;
  /** Supplier code the sheet resolved to, when it did. */
  supplier?: string;
  effectiveAt: string;
  sheetRef: string;
}

type Field = "supplier" | "terminal" | "product" | "price" | "change" | "effective";

const COLUMNS: { field: Field; synonyms: string[] }[] = [
  { field: "supplier", synonyms: ["supplier", "supplier name", "vendor", "company", "seller", "posted by"] },
  { field: "terminal", synonyms: ["terminal", "terminal name", "location", "rack location", "city", "site", "market", "lift point"] },
  { field: "product", synonyms: ["product", "product name", "grade", "item", "description", "fuel", "fuel type", "commodity"] },
  { field: "price", synonyms: ["price", "rack", "rack price", "posted price", "net price", "new price", "price per gallon", "price ($/gal)", "$/gal", "ppg", "rack ($/gal)", "amount"] },
  { field: "change", synonyms: ["change", "move", "chg", "+/-", "delta", "net change"] },
  { field: "effective", synonyms: ["effective", "effective date", "effective time", "effective at", "date", "posted", "post date", "as of", "time"] },
];

const norm = (s: string): string => s.toLowerCase().replace(/[_\-]+/g, " ").replace(/\s+/g, " ").trim();
const clean = (s: string): string => s.toLowerCase().replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();
const r4 = (n: number): number => Math.round(n * 10000) / 10000;

/** Which sheet column plays which role: exact header matches first, then headers that contain a synonym. */
export function columnRoles(headers: string[]): Map<string, Field> {
  const roles = new Map<string, Field>();
  const taken = new Set<Field>();
  for (const h of headers) {
    const n = norm(h);
    const col = COLUMNS.find((c) => c.synonyms.includes(n));
    if (col && !taken.has(col.field)) {
      roles.set(h, col.field);
      taken.add(col.field);
    }
  }
  for (const h of headers) {
    if (roles.has(h)) continue;
    const n = norm(h);
    const col = COLUMNS.find((c) => !taken.has(c.field) && c.synonyms.some((s) => s.length >= 4 && n.includes(s)));
    if (col) {
      roles.set(h, col.field);
      taken.add(col.field);
    }
  }
  return roles;
}

export function matchSupplier(text: string, suppliers: Supplier[]): Supplier | undefined {
  const t = clean(text);
  if (!t) return undefined;
  return (
    suppliers.find((s) => s.code.toLowerCase() === t) ??
    suppliers.find((s) => t.includes(clean(s.name))) ??
    suppliers.find((s) => {
      const first = clean(s.name).split(" ")[0];
      return first.length > 3 && new RegExp(`\\b${first}\\b`).test(t);
    }) ??
    suppliers.find((s) => new RegExp(`\\b${s.code.toLowerCase()}\\b`).test(t))
  );
}

export function matchTerminal(text: string, terminals: Terminal[]): Terminal | undefined {
  const t = clean(text);
  if (!t) return undefined;
  return (
    terminals.find((x) => x.code.toLowerCase() === t) ??
    terminals.find((x) => t.includes(clean(x.name))) ??
    terminals.find((x) => new RegExp(`\\b${x.code.toLowerCase()}\\b`).test(t)) ??
    terminals.find((x) => new RegExp(`\\b${clean(x.city)}\\b`).test(t)) ??
    // A distinctive word of the terminal's name ("Houston" for Houston Pasadena Terminal).
    terminals.find((x) => clean(x.name).split(" ").some((w) => w.length >= 4 && w !== "terminal" && new RegExp(`\\b${w}\\b`).test(t)))
  );
}

export function matchProduct(text: string, products: Product[]): Product | undefined {
  const t = clean(text);
  if (!t) return undefined;
  return products.find((p) => p.code.toLowerCase() === t) ?? products.find((p) => clean(p.name) === t) ?? guessProduct(t, products);
}

/** A rack price on a line or in a cell: the first number that looks like $/gal. */
export function parsePrice(text: string): number | undefined {
  for (const m of text.matchAll(/(?<![\d.])(\d{1,2}\.\d{2,5})(?![\d])/g)) {
    const n = Number(m[1]);
    if (n >= 0.5 && n <= 10) return r4(n);
  }
  return undefined;
}

/** A move against the previous posting: "+0.0125", "-.0075", "(0.0125)". */
export function parseChange(text: string): number | undefined {
  const t = text.trim();
  if (!t) return undefined;
  const negative = /^\(.*\)$/.test(t) || t.startsWith("-") || t.startsWith("−");
  const m = t.replace(/[()$+\-−\s]/g, "").match(/^\d*\.?\d+$/);
  if (!m) return undefined;
  const n = Number(m[0]);
  if (!Number.isFinite(n) || n >= 1) return undefined;
  return r4(negative ? -n : n);
}

/** ISO timestamp from "2026-09-17 18:00", "9/17/2026 6:00 PM", or a bare date (past dates get 18:00 UTC; today or later, `now`). */
export function parseEffective(text: string, now: Date): string | undefined {
  const t = text.trim();
  let y = 0;
  let mo = 0;
  let d = 0;
  let hh: number | undefined;
  let mm = 0;
  let ampm: string | undefined;
  const iso = t.match(/\b(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{1,2}):(\d{2})(?::\d{2})?(?:\.\d+)?(Z|[+-]\d{2}:?\d{2})?)?/);
  const us = iso ? null : t.match(/\b(\d{1,2})\/(\d{1,2})\/(\d{2,4})\b(?:\s+(\d{1,2}):(\d{2})\s*(am|pm)?)?/i);
  if (iso) {
    if (iso[4] !== undefined && iso[6]) return new Date(t.slice(iso.index)).toISOString();
    [y, mo, d] = [Number(iso[1]), Number(iso[2]), Number(iso[3])];
    if (iso[4] !== undefined) [hh, mm] = [Number(iso[4]), Number(iso[5])];
  } else if (us) {
    [mo, d, y] = [Number(us[1]), Number(us[2]), Number(us[3])];
    if (y < 100) y += 2000;
    if (us[4] !== undefined) [hh, mm, ampm] = [Number(us[4]), Number(us[5]), us[6]?.toLowerCase()];
  } else return undefined;
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return undefined;
  if (hh !== undefined && ampm) {
    if (ampm === "pm" && hh < 12) hh += 12;
    if (ampm === "am" && hh === 12) hh = 0;
  }
  const date = `${y}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
  if (hh === undefined) return date < now.toISOString().slice(0, 10) ? `${date}T18:00:00.000Z` : now.toISOString();
  return new Date(Date.UTC(y, mo - 1, d, hh, mm)).toISOString();
}

export async function parseRackSheet(att: AttachmentInput, ref: RackSheetRefData, opts: RackSheetOptions = {}, now: Date = new Date()): Promise<RackSheetParse> {
  const bytes = attachmentBytes(att);
  if (!bytes || bytes.length === 0) throw new Error(`${att.filename} is empty`);
  const sheetRef = `sheet:${createHash("sha256").update(bytes).digest("hex").slice(0, 12)}`;
  const extracted = await extractAttachment(att);
  if (extracted.kind === "unsupported") throw new Error(`${att.filename}: ${extracted.reason}. Upload a CSV, Excel, PDF, or text rack sheet.`);
  return extracted.kind === "rows" ? fromRows(extracted.rows, ref, opts, now, sheetRef) : fromText(extracted.text, ref, opts, now, sheetRef);
}

function fromRows(rows: Record<string, string>[], ref: RackSheetRefData, opts: RackSheetOptions, now: Date, sheetRef: string): RackSheetParse {
  const headers = Object.keys(rows[0] ?? {});
  const roles = columnRoles(headers);
  const col = (field: Field): string | undefined => [...roles.entries()].find(([, f]) => f === field)?.[0];
  const cSup = col("supplier");
  const cTerm = col("terminal");
  const cProd = col("product");
  const cPrice = col("price");
  const cChange = col("change");
  const cEff = col("effective");
  if (!cProd || !cTerm || (!cPrice && !cChange)) {
    throw new Error(`Could not find the terminal, product, and price columns (headers: ${headers.join(", ") || "none"})`);
  }
  const postings: RackFeedPosting[] = [];
  const unparsed: RackSheetParse["unparsed"] = [];
  let supplier: string | undefined;
  rows.forEach((row, i) => {
    const line = headers.map((h) => row[h]).filter(Boolean).join(" | ");
    const supText = (cSup ? row[cSup] : "") || opts.supplierCode || "";
    if (!supText) {
      unparsed.push({ line, reason: "the sheet has no supplier column; choose the supplier when uploading" });
      return;
    }
    const price = cPrice ? parsePrice(row[cPrice] ?? "") : undefined;
    const change = cChange && price === undefined ? parseChange(row[cChange] ?? "") : undefined;
    if (price === undefined && change === undefined) {
      unparsed.push({ line, reason: "no price on the row" });
      return;
    }
    const sup = matchSupplier(supText, ref.suppliers);
    const term = matchTerminal(row[cTerm] ?? "", ref.terminals);
    const prod = matchProduct(row[cProd] ?? "", ref.products);
    supplier ??= sup?.code;
    const effectiveAt = (cEff ? parseEffective(row[cEff] ?? "", now) : undefined) ?? opts.effectiveAt ?? now.toISOString();
    postings.push({
      postingRef: `${sheetRef}:${i + 1}`,
      supplierCode: sup?.code ?? supText,
      terminalCode: term?.code ?? (row[cTerm] ?? "").trim(),
      productCode: prod?.code ?? (row[cProd] ?? "").trim(),
      effectiveAt,
      ...(price !== undefined ? { price } : { change }),
    });
  });
  return { postings, unparsed, format: "rows", lines: rows.length, supplier, effectiveAt: postings[0]?.effectiveAt ?? opts.effectiveAt ?? now.toISOString(), sheetRef };
}

function fromText(text: string, ref: RackSheetRefData, opts: RackSheetOptions, now: Date, sheetRef: string): RackSheetParse {
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const dated = [...lines.filter((l) => /effective|as of|posted/i.test(l)), ...lines];
  let effectiveAt = opts.effectiveAt;
  for (const l of dated) {
    const e = parseEffective(l, now);
    if (e) {
      effectiveAt = e;
      break;
    }
  }
  effectiveAt ??= now.toISOString();
  let supplier = opts.supplierCode ? matchSupplier(opts.supplierCode, ref.suppliers) : undefined;
  if (!supplier) for (const l of lines.slice(0, 12)) if ((supplier = matchSupplier(l, ref.suppliers))) break;
  const postings: RackFeedPosting[] = [];
  const unparsed: RackSheetParse["unparsed"] = [];
  let terminal: Terminal | undefined;
  let terminalText = "";
  lines.forEach((line, i) => {
    const price = parsePrice(line);
    const term = matchTerminal(line.replace(/(?<![\d.])\d{1,2}\.\d{2,5}(?![\d])/g, " "), ref.terminals);
    if (term) {
      terminal = term;
      terminalText = line;
    } else if (price === undefined && /terminal|rack/i.test(line) && !/effective|notice|rack price|rack sheet|price sheet/i.test(line)) {
      // A terminal we do not know: remember its words so the skip reason names it.
      terminal = undefined;
      terminalText = line;
    }
    if (price === undefined) return;
    const withoutNumbers = line.replace(/[+\-−(]?\s*\d{1,2}\.\d{2,5}\)?/g, " ").replace(term ? clean(term.name) : "", " ");
    const prod = matchProduct(withoutNumbers, ref.products);
    if (!prod) {
      unparsed.push({ line, reason: "price found but no product recognized on the line" });
      return;
    }
    if (!terminal && !terminalText) {
      unparsed.push({ line, reason: "no terminal named above this line" });
      return;
    }
    postings.push({
      postingRef: `${sheetRef}:${i + 1}`,
      supplierCode: supplier?.code ?? opts.supplierCode ?? "(none on sheet)",
      terminalCode: terminal?.code ?? terminalText,
      productCode: prod.code,
      effectiveAt,
      price,
    });
  });
  if (!supplier && !opts.supplierCode) {
    for (const p of postings) unparsed.push({ line: `${p.terminalCode} ${p.productCode} ${p.price}`, reason: "the sheet does not name a supplier we know; choose the supplier when uploading" });
    postings.length = 0;
  }
  return { postings, unparsed, format: "text", lines: lines.length, supplier: supplier?.code, effectiveAt, sheetRef };
}
