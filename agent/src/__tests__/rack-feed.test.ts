import { describe, it, expect } from "vitest";
import { importRackFeed, quotePrice } from "../services/pricing.js";
import { loadSample } from "../samples/loader.js";
import type { RackPrice } from "../domain/types.js";
import { freshStore, NOW } from "./helpers.js";

const latest = (store: ReturnType<typeof freshStore>, supplierId: string, terminalId: string, productId: string): RackPrice | undefined =>
  store.all<RackPrice>("rackPrices").filter((r) => r.supplierId === supplierId && r.terminalId === terminalId && r.productId === productId).sort((a, b) => b.effectiveAt.localeCompare(a.effectiveAt))[0];

describe("rack feed import (Module A: daily base price import)", () => {
  it("applies feed moves to the latest stored rack and records absolute postings", () => {
    const store = freshStore();
    const before = latest(store, "sup-mot", "t-dal", "p-ulsd")!;
    const feed = loadSample<{ postings: { postingRef: string; supplierCode: string; terminalCode: string; productCode: string; change?: number; price?: number }[] }>("rack-feed.json", NOW);
    const move = feed.postings.find((p) => p.supplierCode === "MOT" && p.terminalCode === "DAL" && p.productCode === "ULSD")!.change!;
    const r = importRackFeed(store, "u-priya", NOW);
    expect(r.run.kind).toBe("rack_feed");
    expect(r.imported.length).toBe(feed.postings.length);
    expect(r.skipped).toEqual([]);
    const after = latest(store, "sup-mot", "t-dal", "p-ulsd")!;
    expect(after.id).not.toBe(before.id);
    expect(after.source).toBe("feed");
    expect(after.sourceRef).toBe(`MOT-DAL-ULSD-${NOW.toISOString().slice(0, 10)}`);
    expect(after.pricePerGallon).toBeCloseTo(before.pricePerGallon + move, 4);
    expect(latest(store, "sup-mot", "t-dal", "p-def")?.pricePerGallon).toBe(2.95);
    expect(store.all<any>("integrationRuns").at(-1).summary).toMatch(/rack posting\(s\) imported/);
  });

  it("is idempotent: the same feed imports nothing the second time", () => {
    const store = freshStore();
    const first = importRackFeed(store, "u-priya", NOW);
    const count = store.all("rackPrices").length;
    const second = importRackFeed(store, "u-priya", NOW);
    expect(first.imported.length).toBeGreaterThan(0);
    expect(second.imported).toEqual([]);
    expect(second.skipped.every((s) => s.reason === "already imported")).toBe(true);
    expect(store.all("rackPrices").length).toBe(count);
    expect(second.run.summary).toMatch(/already current/);
  });

  it("skips postings it cannot place and says why", () => {
    const store = freshStore();
    const r = importRackFeed(store, "u-priya", NOW, [
      { postingRef: "X-1", supplierCode: "ZZZ", terminalCode: "DAL", productCode: "ULSD", change: 0.01 },
      { postingRef: "X-2", supplierCode: "VLO", terminalCode: "DAL", productCode: "ULSD", change: 0.01 },
      { postingRef: "X-3", supplierCode: "MPC", terminalCode: "DAL", productCode: "DEF", change: 0.01 },
      { postingRef: "X-4", supplierCode: "MOT", terminalCode: "DAL", productCode: "ULSD" },
      { postingRef: "X-5", supplierCode: "MOT", terminalCode: "DAL", productCode: "ULSD", price: 2.6 },
    ]);
    expect(r.imported.map((x) => x.sourceRef)).toEqual(["X-5"]);
    expect(r.skipped.map((s) => s.reason)).toEqual([
      "unknown supplier ZZZ",
      "VLO does not post at DAL",
      "no prior rack for MPC DEF at DAL to apply a change to",
      "posting has neither price nor change",
    ]);
  });

  it("changes the quoted price basis once the feed is in", () => {
    const store = freshStore();
    const before = quotePrice(store, { customerId: "cust-lsa", productId: "p-ulsd", terminalId: "t-dal", date: NOW.toISOString().slice(0, 10) });
    importRackFeed(store, "u-priya", NOW);
    const after = quotePrice(store, { customerId: "cust-lsa", productId: "p-ulsd", terminalId: "t-dal", date: NOW.toISOString().slice(0, 10) });
    expect(before.ok && after.ok).toBe(true);
    if (before.ok && after.ok) {
      const cheapest = Math.min(latest(store, "sup-mot", "t-dal", "p-ulsd")!.pricePerGallon, latest(store, "sup-mpc", "t-dal", "p-ulsd")!.pricePerGallon);
      expect(after.price.basisValue).toBeCloseTo(cheapest, 4);
      expect(after.price.basisValue).not.toBeCloseTo(before.price.basisValue, 4);
    }
  });
});
