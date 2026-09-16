import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync } from "node:fs";
import { dirname, join, extname, basename } from "node:path";
import { fileURLToPath } from "node:url";
import { parseCsv } from "../../intake/attachments.js";
import type { BolFeedRecord, BolFetchResult, BolSource, SkippedRecord } from "./source.js";

/**
 * DTN BOL connector. DTN distributes electronic BOL / lifting data for most
 * Gulf Coast terminals; customers receive it either as a pull from an HTTPS
 * endpoint or as files dropped over SFTP. Both are supported here:
 *
 *   DTN_BOL_MODE=https      DTN_BOL_URL=...  DTN_API_KEY=...   (GET, JSON or CSV)
 *   DTN_BOL_MODE=directory  DTN_BOL_DIR=/data/dtn-inbox         (an SFTP mirror or mounted volume)
 *   DTN_BOL_FORMAT=csv|json (optional; otherwise detected)
 *   DTN_FIELD_MAP=/path/to/dtn-bol-map.json (optional; default agent/config/dtn-bol-map.json)
 *
 * The exact column names and identifiers come from the DTN onboarding packet
 * and live in the field map, not in code. Validate a sample export with
 * `npx tsx scripts/check-dtn-file.ts <file>` before switching the mode on.
 */

export interface DtnFieldMap {
  fields: Record<string, string[]>;
  suppliers: Record<string, string>;
  terminals: Record<string, string>;
  carriers: Record<string, string>;
  products: Record<string, string>;
  customerRefs?: Record<string, string>;
}

export interface DtnConfig {
  mode: "off" | "https" | "directory";
  url?: string;
  apiKey?: string;
  dir?: string;
  format?: "csv" | "json";
  mapPath?: string;
  /** Move processed files into <dir>/processed (directory mode). */
  archive?: boolean;
}

const DEFAULT_MAP_PATH = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "config", "dtn-bol-map.json");

export function dtnConfigFromEnv(env: NodeJS.ProcessEnv = process.env): DtnConfig {
  const mode = (env.DTN_BOL_MODE ?? "off").toLowerCase();
  return {
    mode: mode === "https" || mode === "directory" ? mode : "off",
    url: env.DTN_BOL_URL,
    apiKey: env.DTN_API_KEY,
    dir: env.DTN_BOL_DIR,
    format: env.DTN_BOL_FORMAT === "csv" || env.DTN_BOL_FORMAT === "json" ? env.DTN_BOL_FORMAT : undefined,
    mapPath: env.DTN_FIELD_MAP,
    archive: env.DTN_BOL_ARCHIVE !== "false",
  };
}

export function loadDtnFieldMap(path: string = DEFAULT_MAP_PATH): DtnFieldMap {
  return JSON.parse(readFileSync(path, "utf8")) as DtnFieldMap;
}

const norm = (s: string): string => s.toUpperCase().replace(/[^A-Z0-9#&]+/g, " ").trim();
const keyOf = (s: string): string => s.toUpperCase().replace(/[^A-Z0-9]+/g, "");

function pick(row: Record<string, string>, names: string[]): string | undefined {
  const keys = new Map(Object.keys(row).map((k) => [keyOf(k), k]));
  for (const n of names) {
    const k = keys.get(keyOf(n));
    if (k !== undefined && String(row[k] ?? "").trim() !== "") return String(row[k]).trim();
  }
  return undefined;
}

function crosswalk(value: string | undefined, table: Record<string, string>): string | undefined {
  if (!value) return undefined;
  const n = norm(value);
  const hit = Object.entries(table).find(([k]) => norm(k) === n);
  return hit ? hit[1] : n;
}

const num = (v: string | undefined): number | undefined => {
  if (v === undefined) return undefined;
  const n = Number(String(v).replace(/[$,\s]/g, ""));
  return Number.isFinite(n) ? n : undefined;
};

/** DTN timestamps arrive as ISO, "MM/DD/YYYY HH:MM[:SS]", or "YYYY-MM-DD HH:MM". Returned as ISO (UTC when no zone is given). */
export function parseDtnDate(v: string | undefined): string | undefined {
  if (!v) return undefined;
  const s = v.trim();
  if (/^\d{4}-\d{2}-\d{2}T/.test(s)) { const d = new Date(s); return Number.isNaN(d.getTime()) ? undefined : d.toISOString(); }
  let m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?)?/);
  if (m) return new Date(Date.UTC(+m[3], +m[1] - 1, +m[2], +(m[4] ?? 0), +(m[5] ?? 0), +(m[6] ?? 0))).toISOString();
  m = s.match(/^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?$/);
  if (m) return new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], +(m[4] ?? 0), +(m[5] ?? 0), +(m[6] ?? 0))).toISOString();
  return undefined;
}

function rowsFrom(text: string, format: "csv" | "json"): Record<string, string>[] {
  if (format === "csv") return parseCsv(text);
  const parsed = JSON.parse(text) as unknown;
  const arr = Array.isArray(parsed)
    ? parsed
    : (["bols", "records", "data", "items", "BOLs"].map((k) => (parsed as Record<string, unknown>)?.[k]).find(Array.isArray) as unknown[] | undefined) ?? [];
  return arr.map((r) => Object.fromEntries(Object.entries(r as Record<string, unknown>).map(([k, v]) => [k, v === null || v === undefined ? "" : typeof v === "object" ? JSON.stringify(v) : String(v)])));
}

export function detectFormat(text: string, hint?: string): "csv" | "json" {
  if (hint === "csv" || hint === "json") return hint;
  const t = text.trimStart();
  return t.startsWith("{") || t.startsWith("[") ? "json" : "csv";
}

/**
 * Turn a DTN export (one row per BOL line) into the platform's BOL records.
 * Rows sharing a BOL number become one BOL with several lines. Rows we cannot
 * place are reported with a reason instead of being dropped silently.
 */
export function parseDtnPayload(text: string, format: "csv" | "json", map: DtnFieldMap): { records: BolFeedRecord[]; skipped: SkippedRecord[] } {
  const rows = rowsFrom(text, format);
  const groups = new Map<string, Record<string, string>[]>();
  const skipped: SkippedRecord[] = [];
  rows.forEach((row, i) => {
    const bol = pick(row, map.fields.bolNumber ?? []);
    if (!bol) { skipped.push({ ref: `row ${i + 2}`, reason: "no BOL number" }); return; }
    groups.set(bol, [...(groups.get(bol) ?? []), row]);
  });
  const records: BolFeedRecord[] = [];
  for (const [bolNumber, group] of groups) {
    const head = group[0];
    const supplierCode = crosswalk(pick(head, map.fields.supplier ?? []), map.suppliers);
    const terminalCode = crosswalk(pick(head, map.fields.terminal ?? []), map.terminals);
    const carrierCode = crosswalk(pick(head, map.fields.carrier ?? []), map.carriers);
    const liftedAt = parseDtnDate(pick(head, map.fields.liftedAt ?? []));
    const consignee = pick(head, map.fields.consignee ?? []);
    const destination = pick(head, map.fields.destination ?? []);
    const missing = [!supplierCode && "supplier", !terminalCode && "terminal", !carrierCode && "carrier", !liftedAt && "lift date/time"].filter(Boolean);
    if (missing.length) { skipped.push({ ref: bolNumber, reason: `missing ${missing.join(", ")}` }); continue; }
    const lines = group.flatMap((row) => {
      const productCode = crosswalk(pick(row, map.fields.product ?? []), map.products);
      const gross = num(pick(row, map.fields.grossGallons ?? []));
      const net = num(pick(row, map.fields.netGallons ?? [])) ?? gross;
      if (!productCode || !gross) { skipped.push({ ref: bolNumber, reason: `line without product or gross gallons` }); return []; }
      const price = num(pick(row, map.fields.unitPrice ?? []));
      return [{
        productCode,
        grossGallons: gross,
        netGallons: net ?? gross,
        supplierCostPerGallon: price !== undefined && price > 0 ? price : ("{{RACK}}" as const),
        taxesPerGallon: num(pick(row, map.fields.taxes ?? [])),
        feesPerGallon: num(pick(row, map.fields.fees ?? [])),
      }];
    });
    if (lines.length === 0) { skipped.push({ ref: bolNumber, reason: "no usable product lines" }); continue; }
    const customerRef = (consignee && map.customerRefs ? crosswalk(consignee, map.customerRefs) : undefined) ?? (consignee ? norm(consignee) : "");
    records.push({
      bolNumber,
      supplierCode: supplierCode!,
      terminalCode: terminalCode!,
      carrierCode: carrierCode!,
      liftedAt: liftedAt!,
      destinationText: [consignee, destination].filter(Boolean).join(" / ").toUpperCase(),
      customerRef,
      lines,
      externalRef: `dtn:${bolNumber}`,
    });
  }
  return { records, skipped };
}

export interface DtnDeps {
  fetcher?: typeof fetch;
  map?: DtnFieldMap;
}

export function dtnBolSource(cfg: DtnConfig, deps: DtnDeps = {}): BolSource {
  const map = deps.map ?? loadDtnFieldMap(cfg.mapPath);
  const fetcher = deps.fetcher ?? fetch;
  const configured = cfg.mode === "https" ? !!cfg.url : cfg.mode === "directory" ? !!cfg.dir : false;
  return {
    describe: () => ({
      kind: "dtn",
      name: `DTN (${cfg.mode})`,
      configured,
      mode: cfg.mode,
      detail: cfg.mode === "https" ? (cfg.url ? `GET ${cfg.url}` : "DTN_BOL_URL is not set") : cfg.mode === "directory" ? (cfg.dir ? `files in ${cfg.dir}` : "DTN_BOL_DIR is not set") : "DTN_BOL_MODE is off",
    }),
    async fetch(): Promise<BolFetchResult> {
      if (!configured) throw new Error(`DTN connector is not configured (${cfg.mode === "off" ? "DTN_BOL_MODE is off" : cfg.mode === "https" ? "DTN_BOL_URL missing" : "DTN_BOL_DIR missing"})`);
      if (cfg.mode === "https") {
        const res = await fetcher(cfg.url!, {
          headers: { accept: "application/json, text/csv", ...(cfg.apiKey ? { authorization: `Bearer ${cfg.apiKey}`, "x-api-key": cfg.apiKey } : {}) },
          signal: AbortSignal.timeout(60_000),
        });
        if (!res.ok) throw new Error(`DTN responded ${res.status} ${res.statusText}`);
        const text = await res.text();
        const ct = res.headers.get("content-type") ?? "";
        const format = detectFormat(text, cfg.format ?? (ct.includes("json") ? "json" : ct.includes("csv") ? "csv" : undefined));
        const out = parseDtnPayload(text, format, map);
        return { ...out, detail: `GET ${cfg.url} (${format}, ${text.length} bytes)` };
      }
      const dir = cfg.dir!;
      if (!existsSync(dir)) return { records: [], skipped: [], detail: `${dir} does not exist yet` };
      const files = readdirSync(dir).filter((f) => [".csv", ".json", ".txt"].includes(extname(f).toLowerCase())).sort();
      const records: BolFeedRecord[] = [];
      const skipped: SkippedRecord[] = [];
      for (const f of files) {
        const path = join(dir, f);
        const text = readFileSync(path, "utf8");
        const out = parseDtnPayload(text, detectFormat(text, cfg.format ?? (extname(f).toLowerCase() === ".json" ? "json" : "csv")), map);
        records.push(...out.records);
        skipped.push(...out.skipped.map((s) => ({ ...s, ref: `${basename(f)}: ${s.ref}` })));
        if (cfg.archive !== false) {
          mkdirSync(join(dir, "processed"), { recursive: true });
          renameSync(path, join(dir, "processed", f));
        }
      }
      return { records, skipped, detail: `${files.length} file(s) read from ${dir}` };
    },
  };
}

/** The BOL source for this deployment: DTN when configured, the sample feed otherwise. */
export function resolveBolSource(env: NodeJS.ProcessEnv = process.env): BolSource | null {
  const cfg = dtnConfigFromEnv(env);
  if (cfg.mode === "off") return null;
  return dtnBolSource(cfg);
}
