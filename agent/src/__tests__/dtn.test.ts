import { describe, it, expect } from "vitest";
import { detectFormat, dtnBolSource, dtnConfigFromEnv, loadDtnFieldMap, parseDtnDate, parseDtnPayload, resolveBolSource } from "../integrations/bol/dtn.js";
import { pullBolFeed } from "../services/loads.js";
import { freshStore, NOW } from "./helpers.js";

const map = loadDtnFieldMap();
const lift = (hoursAgo: number) => new Date(NOW.getTime() - hoursAgo * 3_600_000);
const mmdd = (d: Date) => `${String(d.getUTCMonth() + 1).padStart(2, "0")}/${String(d.getUTCDate()).padStart(2, "0")}/${d.getUTCFullYear()} ${String(d.getUTCHours()).padStart(2, "0")}:${String(d.getUTCMinutes()).padStart(2, "0")}`;

const CSV = [
  "BOL_NUMBER,BOL_DATE_TIME,SUPPLIER,TCN,CARRIER_SCAC,CONSIGNEE,DESTINATION,PRODUCT,GROSS_GALLONS,NET_GALLONS,UNIT_PRICE,TAXES",
  `MOT-HOU-771204,${mmdd(lift(5))},Motiva Enterprises LLC,Houston Pasadena,BLBT,Gulf Coast Farms Co-op,"Alvin, TX",ULSD DYED,"7,820","7,702",2.4310,0.0025`,
  `MPC-DAL-990311,${mmdd(lift(3))},Marathon Petroleum,Dallas,LNST,QuickStop Markets,Cleburne TX,RUL,8515,8390,2.0490,0.3855`,
  `MPC-DAL-990311,${mmdd(lift(3))},Marathon Petroleum,Dallas,LNST,QuickStop Markets,Cleburne TX,PUL,500,495,2.4700,0.3855`,
  `VLO-XXX-000001,${mmdd(lift(2))},Valero,Somewhere Else,LNST,Unknown Co,Nowhere,ULSD,1000,990,2.50,0.44`,
  `MOT-DAL-000002,not a date,Motiva,Dallas,RPGF,Trinity River Contractors,Dallas,ULSD,1000,990,,`,
].join("\n");

describe("DTN BOL connector", () => {
  it("parses DTN timestamps in the usual shapes", () => {
    expect(parseDtnDate("09/16/2026 07:45")).toBe("2026-09-16T07:45:00.000Z");
    expect(parseDtnDate("2026-09-16 07:45:30")).toBe("2026-09-16T07:45:30.000Z");
    expect(parseDtnDate("2026-09-16T07:45:00.000Z")).toBe("2026-09-16T07:45:00.000Z");
    expect(parseDtnDate("yesterday")).toBeUndefined();
  });

  it("maps a DTN CSV export onto platform codes, groups lines by BOL, and reports what it cannot place", () => {
    const { records, skipped } = parseDtnPayload(CSV, "csv", map);
    expect(records.map((r) => r.bolNumber)).toEqual(["MOT-HOU-771204", "MPC-DAL-990311", "VLO-XXX-000001"]);
    const gcf = records[0];
    expect(gcf).toMatchObject({ supplierCode: "MOT", terminalCode: "HOU", carrierCode: "BLUEBONNET", customerRef: "GCF", externalRef: "dtn:MOT-HOU-771204" });
    expect(gcf.lines[0]).toMatchObject({ productCode: "DYED", grossGallons: 7820, netGallons: 7702, supplierCostPerGallon: 2.431, taxesPerGallon: 0.0025 });
    expect(gcf.liftedAt).toBe(lift(5).toISOString().replace(/\.\d{3}Z$/, ".000Z"));
    const qsm = records[1];
    expect(qsm.lines.map((l) => l.productCode)).toEqual(["UNL87", "PRM93"]);
    expect(qsm.customerRef).toBe("QSM");
    // Unknown terminal text is passed through upper-cased so the pull can report it.
    expect(records[2].terminalCode).toBe("SOMEWHERE ELSE");
    expect(skipped).toEqual([{ ref: "MOT-DAL-000002", reason: "missing lift date/time" }]);
  });

  it("accepts JSON payloads and detects the format", () => {
    const json = JSON.stringify({ bols: [{ BOL_NUMBER: "MPC-FTW-1", BOL_DATE_TIME: "2026-09-16T05:00:00Z", SUPPLIER: "Marathon", TCN: "Fort Worth", CARRIER_SCAC: "LNST", CONSIGNEE: "Prairie Trucking Fleet", PRODUCT: "ULSD", GROSS_GALLONS: 6510, NET_GALLONS: 6418, UNIT_PRICE: null }] });
    expect(detectFormat(json)).toBe("json");
    expect(detectFormat(CSV)).toBe("csv");
    const { records } = parseDtnPayload(json, "json", map);
    expect(records[0]).toMatchObject({ supplierCode: "MPC", terminalCode: "FTW", customerRef: "PTF" });
    expect(records[0].lines[0].supplierCostPerGallon).toBe("{{RACK}}");
  });

  it("pulls over HTTPS with the API key and ingests through the normal BOL path", async () => {
    const store = freshStore();
    const calls: { url: string; headers: Record<string, string> }[] = [];
    const fetcher = (async (url: string, init?: RequestInit) => {
      calls.push({ url, headers: Object.fromEntries(Object.entries((init?.headers ?? {}) as Record<string, string>)) });
      return new Response(CSV, { status: 200, headers: { "content-type": "text/csv" } });
    }) as unknown as typeof fetch;
    const source = dtnBolSource({ mode: "https", url: "https://dtn.example/bols", apiKey: "secret-key" }, { fetcher, map });
    expect(source.describe()).toMatchObject({ kind: "dtn", configured: true, mode: "https" });
    const r = await pullBolFeed(store, NOW, source);
    expect(calls[0].url).toBe("https://dtn.example/bols");
    expect(calls[0].headers.authorization).toBe("Bearer secret-key");
    expect(r.run.source).toBe("DTN (https)");
    expect(r.run.summary).toMatch(/^DTN \(https\): 2 BOL\(s\) received/);
    expect(r.results.map((x) => [x.bol.bolNumber, x.outcome])).toEqual([["MOT-HOU-771204", "matched"], ["MPC-DAL-990311", "matched"]]);
    expect(r.skipped).toEqual([
      { ref: "MOT-DAL-000002", reason: "missing lift date/time" },
      { ref: "VLO-XXX-000001", reason: "unknown terminal SOMEWHERE ELSE" },
    ]);
    expect(r.run.status).toBe("partial");
    const again = await pullBolFeed(store, NOW, source);
    expect(again.results.every((x) => x.outcome === "duplicate")).toBe(true);
  });

  it("records a failed run instead of throwing when DTN is unreachable", async () => {
    const store = freshStore();
    const fetcher = (async () => new Response("nope", { status: 503, statusText: "Service Unavailable" })) as unknown as typeof fetch;
    const r = await pullBolFeed(store, NOW, dtnBolSource({ mode: "https", url: "https://dtn.example/bols" }, { fetcher, map }));
    expect(r.run.status).toBe("failed");
    expect(r.run.summary).toMatch(/DTN responded 503/);
    expect(r.results).toEqual([]);
  });

  it("is off unless configured, and the sample feed stays the default", () => {
    expect(resolveBolSource({})).toBeNull();
    expect(dtnConfigFromEnv({ DTN_BOL_MODE: "https", DTN_BOL_URL: "https://x" }).mode).toBe("https");
    expect(resolveBolSource({ DTN_BOL_MODE: "https", DTN_BOL_URL: "https://x" })?.describe()).toMatchObject({ kind: "dtn", configured: true });
    expect(resolveBolSource({ DTN_BOL_MODE: "directory" })?.describe()).toMatchObject({ kind: "dtn", configured: false });
  });
});
