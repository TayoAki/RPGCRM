import { describe, it, expect } from "vitest";
import { columnRoles, parseChange, parseEffective, parsePrice } from "../pricing/rack-sheet.js";
import { uploadRackSheet } from "../services/pricing.js";
import type { RackPrice } from "../domain/types.js";
import { freshStore, NOW } from "./helpers.js";

const latest = (store: ReturnType<typeof freshStore>, supplierId: string, terminalId: string, productId: string): RackPrice | undefined =>
  store.all<RackPrice>("rackPrices").filter((r) => r.supplierId === supplierId && r.terminalId === terminalId && r.productId === productId).sort((a, b) => b.effectiveAt.localeCompare(a.effectiveAt))[0];

describe("rack sheet upload (Module A: the supplier's own sheet)", () => {
  it("reads a CSV export by column, imports it, and skips the same file the second time", async () => {
    const store = freshStore();
    const att = { filename: "marathon-rack-sheet.csv", contentType: "text/csv", file: "rack-sheets/marathon-rack-sheet.csv" };
    const r = await uploadRackSheet(store, "u-priya", att, {}, NOW);
    expect(r.sheet.format).toBe("rows");
    expect(r.sheet.supplier).toBe("MPC");
    expect(r.imported.length).toBe(8);
    expect(r.skipped).toEqual([]);
    expect(r.run.source).toBe("Upload: marathon-rack-sheet.csv");
    const dal = latest(store, "sup-mpc", "t-dal", "p-ulsd")!;
    expect(dal.pricePerGallon).toBe(2.4725);
    expect(dal.source).toBe("feed");
    expect(dal.sourceRef).toMatch(/^sheet:[0-9a-f]{12}:1$/);
    expect(dal.effectiveAt).toBe(NOW.toISOString());
    expect(latest(store, "sup-mpc", "t-ftw", "p-prm93")!.pricePerGallon).toBe(2.624);
    const again = await uploadRackSheet(store, "u-priya", att, {}, NOW);
    expect(again.imported.length).toBe(0);
    expect(again.skipped.length).toBe(8);
    expect(again.skipped.every((s) => s.reason === "already imported")).toBe(true);
    expect(store.all<{ action: string; detail: string }>("auditLog").some((a) => a.action === "rackPrice.imported" && a.detail.startsWith("Upload: marathon"))).toBe(true);
  });

  it("reads a PDF price notice line by line, with the terminal named above each block", async () => {
    const store = freshStore();
    const r = await uploadRackSheet(store, "u-priya", { filename: "valero-rack-notice.pdf", contentType: "application/pdf", file: "rack-sheets/valero-rack-notice.pdf" }, {}, NOW);
    expect(r.sheet.format).toBe("text");
    expect(r.sheet.supplier).toBe("VLO");
    expect(r.sheet.effectiveAt).toBe(NOW.toISOString());
    expect(r.imported.map((x) => `${x.terminalCode}/${x.productCode}=${x.pricePerGallon}`)).toEqual([
      "FTW/ULSD=2.4795", "FTW/DYED=2.398", "FTW/UNL87=2.151", "FTW/PRM93=2.6205",
      "HOU/ULSD=2.461", "HOU/DYED=2.379", "HOU/UNL87=2.133", "HOU/PRM93=2.601",
    ]);
    expect(r.skipped).toEqual([]);
    expect(r.sheet.unparsed).toEqual([]);
  });

  it("reads an Excel sheet with no supplier column when the supplier is chosen, and explains when it is not", async () => {
    const store = freshStore();
    const att = { filename: "motiva-rack-sheet.xlsx", contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", file: "rack-sheets/motiva-rack-sheet.xlsx" };
    await expect(uploadRackSheet(store, "u-priya", att, {}, NOW)).rejects.toThrow(/choose the supplier/);
    const r = await uploadRackSheet(store, "u-priya", att, { supplierCode: "MOT" }, NOW);
    expect(r.imported.length).toBe(9);
    expect(r.skipped).toEqual([]);
    expect(latest(store, "sup-mot", "t-dal", "p-def")!.pricePerGallon).toBe(2.95);
    expect(latest(store, "sup-mot", "t-hou", "p-dyed")!.pricePerGallon).toBe(2.373);
  });

  it("passes unknown names through so the import says what it could not place, and parses dates and moves", async () => {
    const store = freshStore();
    const text = ["Marathon Petroleum - Rack Notice", "Effective 09/10/2026 6:00 PM", "Amarillo Terminal", "ULSD 2.5100", "Dallas Terminal", "ULSD 2.4700", "Jet A 3.1000"].join("\n");
    const r = await uploadRackSheet(store, "u-priya", { filename: "notice.txt", contentType: "text/plain", text }, {}, NOW);
    expect(r.sheet.effectiveAt).toBe("2026-09-10T18:00:00.000Z");
    expect(r.imported.map((x) => `${x.terminalCode}/${x.productCode}`)).toEqual(["DAL/ULSD"]);
    expect(r.skipped.map((s) => s.reason)).toEqual(["unknown terminal Amarillo Terminal"]);
    expect(r.sheet.unparsed.map((u) => u.reason)).toEqual(["price found but no product recognized on the line"]);
    await expect(uploadRackSheet(store, "u-priya", { filename: "empty.csv", contentType: "text/csv", text: "a,b\n" }, {}, NOW)).rejects.toThrow(/Could not find the terminal, product, and price columns/);
    await expect(uploadRackSheet(store, "u-priya", { filename: "photo.png", contentType: "image/png", contentBase64: "iVBORw0KGgo=" }, {}, NOW)).rejects.toThrow(/Upload a CSV, Excel, PDF, or text/);
    expect(parseEffective("2026-09-01", NOW)).toBe("2026-09-01T18:00:00.000Z");
    expect(parseEffective("9/16/26", NOW)).toBe(NOW.toISOString());
    expect(parseEffective("2026-09-16T06:00:00Z", NOW)).toBe("2026-09-16T06:00:00.000Z");
    expect(parseEffective("2026-09-15 06:30", NOW)).toBe("2026-09-15T06:30:00.000Z");
    expect(parseEffective("no date here", NOW)).toBeUndefined();
    expect(parsePrice("$2.4725")).toBe(2.4725);
    expect(parsePrice("+0.0125 2.4725")).toBe(2.4725);
    expect(parsePrice("12")).toBeUndefined();
    expect(parseChange("+0.0125")).toBe(0.0125);
    expect(parseChange("(0.0075)")).toBe(-0.0075);
    expect(parseChange("-.004")).toBe(-0.004);
    expect(parseChange("2.47")).toBeUndefined();
    expect([...columnRoles(["Terminal Name", "Product", "Posted Price ($/gal)", "Eff. Date"]).values()]).toEqual(["terminal", "product", "price", "effective"]);
  });
});
