import { describe, it, expect } from "vitest";
import { dedupeHash, findBestLoad, scoreLoadMatch } from "../bols/match.js";
import { createLoadForOrder, ingestBol, pullBolFeed, recordDelivery, setBillingStatus, setLoadStatus } from "../services/loads.js";
import { freshStore, NOW } from "./helpers.js";

describe("BOL matching", () => {
  it("hashes on supplier + BOL number only", () => {
    expect(dedupeHash({ supplierId: "sup-mpc", bolNumber: "abc-1 " })).toBe(dedupeHash({ supplierId: "sup-mpc", bolNumber: "ABC-1" }));
    expect(dedupeHash({ supplierId: "sup-mpc", bolNumber: "abc-1" })).not.toBe(dedupeHash({ supplierId: "sup-vlo", bolNumber: "abc-1" }));
  });

  it("scores the right load and refuses wrong terminal/product", () => {
    const store = freshStore();
    const loads = store.all<any>("loads");
    const customers = store.all<any>("customers");
    const bol = { terminalId: "t-hou", carrierId: "c-bluebonnet", liftedAt: new Date(NOW.getTime() - 5 * 3600e3).toISOString(), customerRef: "GCF", lines: [{ productId: "p-dyed", grossGallons: 7820, netGallons: 7702, supplierCostPerGallon: 2.4, taxesPerGallon: 0, feesPerGallon: 0 }] };
    const best = findBestLoad(bol, loads, customers);
    expect(best?.load.id).toBe("l-506");
    expect(scoreLoadMatch({ ...bol, terminalId: "t-dal" }, loads.find((l: any) => l.id === "l-506"), customers)).toBe(-1);
  });
});

describe("loads service", () => {
  it("pulls the sample feed: matches, flags duplicate and unmatched, starts billing", async () => {
    const store = freshStore();
    const { run, results } = await pullBolFeed(store, NOW);
    expect(run.recordsIn).toBe(5);
    expect(results.map((r) => r.outcome).sort()).toEqual(["duplicate", "matched", "matched", "matched", "unmatched"]);
    const l506 = store.load("l-506");
    expect(l506.bolId).toBeTruthy();
    expect(l506.billingStatus).toBe("bol_received");
    const l507 = store.load("l-507");
    expect(l507.status).toBe("in_transit"); // dispatched load with a BOL is lifting
    expect(store.order("o-1007").status).toBe("in_transit");
    const open = store.all<any>("exceptions").filter((e) => e.status === "open");
    expect(open.some((e) => e.type === "unassigned_customer")).toBe(true);
    expect(open.some((e) => e.type === "duplicate_bol")).toBe(true);
    expect(open.some((e) => e.type === "missing_bol" && e.entityId === "l-505")).toBe(false); // resolved by the feed
  });

  it("creates a load for an order, walks statuses, records delivery", () => {
    const store = freshStore();
    const load = createLoadForOrder(store, { orderId: "o-1008", carrierId: "c-lonestar", terminalId: "t-dal", supplierId: "sup-mot", scheduledPickupAt: NOW.toISOString(), scheduledDeliveryAt: new Date(NOW.getTime() + 4 * 3600e3).toISOString() }, "u-marcus", NOW);
    expect(load.status).toBe("planned");
    expect(store.order("o-1008").status).toBe("confirmed");
    setLoadStatus(store, load.id, "dispatched", "u-marcus", undefined, NOW);
    expect(store.order("o-1008").status).toBe("carrier_confirmed");
    ingestBol(store, { bolNumber: "MOT-DAL-TEST1", supplierId: "sup-mot", terminalId: "t-dal", carrierId: "c-lonestar", liftedAt: NOW.toISOString(), destinationText: "LSA PIT 7", customerRef: "LSA", source: "manual", lines: [{ productId: "p-dyed", grossGallons: 7500, netGallons: 7400 }] }, "u-marcus", NOW);
    expect(store.load(load.id).bolId).toBeTruthy();
    expect(store.load(load.id).status).toBe("in_transit");
    recordDelivery(store, load.id, { deliveredGallons: 7400, receiverName: "R. Hollis", ticketNumber: "T-1" }, "u-marcus", NOW);
    expect(store.load(load.id).status).toBe("delivered");
    expect(store.order("o-1008").status).toBe("delivered");
    setBillingStatus(store, load.id, "pricing_verified", "u-priya", NOW);
    expect(() => setBillingStatus(store, load.id, "invoiced", "u-elena", NOW)).toThrow(/require an invoice/);
  });

  it("refuses to dispatch an order on credit hold", () => {
    const store = freshStore();
    expect(() => createLoadForOrder(store, { orderId: "o-1009", carrierId: "c-rpg", terminalId: "t-dal", supplierId: "sup-mot", scheduledPickupAt: NOW.toISOString(), scheduledDeliveryAt: NOW.toISOString() }, "u-marcus", NOW)).toThrow(/credit hold/);
  });
});
