import { describe, it, expect } from "vitest";
import { overallConfidence, parseDate, parseGallons, parseOrderEmail, parsePo } from "../intake/parser.js";
import { reviewIntake, runEmailIntake, setOrderStatus } from "../services/orders.js";
import { freshStore, NOW } from "./helpers.js";

function ref(store: ReturnType<typeof freshStore>) {
  return {
    customers: store.all("customers") as never,
    deliveryLocations: store.all("deliveryLocations") as never,
    products: store.all("products") as never,
    contacts: store.all("contacts") as never,
  };
}

describe("email parser", () => {
  it("parses labeled fields with high confidence", () => {
    const store = freshStore();
    const p = parseOrderEmail(
      { from: "orders@lonestaraggregates.com", subject: "Fuel order", body: "Customer: Lone Star Aggregates\nLocation: Pit 4 - Ennis, TX\nProduct: Dyed ULSD\nGallons: 7,500\nRequested date: 2026-09-18\nPO: LSA-4488\nNotes: Call the gate." },
      ref(store),
      NOW,
    );
    expect(p.customerId).toBe("cust-lsa");
    expect(p.deliveryLocationId).toBe("loc-lsa-pit4");
    expect(p.productId).toBe("p-dyed");
    expect(p.gallons).toBe(7500);
    expect(p.requestedDate).toBe("2026-09-18");
    expect(p.customerPo).toBe("LSA-4488");
    expect(p.specialInstructions).toBe("Call the gate.");
    expect(overallConfidence(p)).toBeGreaterThan(0.85);
  });

  it("parses free-form text with lower confidence", () => {
    const store = freshStore();
    const p = parseOrderEmail(
      { from: "dispatch@prairietrucking.com", subject: "diesel", body: "can we get 6500 gallons of diesel to our Fort Worth yard on 2026-09-18? Reference PTF-0915." },
      ref(store),
      NOW,
    );
    expect(p.customerId).toBe("cust-ptf");
    expect(p.deliveryLocationId).toBe("loc-ptf-fw");
    expect(p.productId).toBe("p-ulsd");
    expect(p.gallons).toBe(6500);
    expect(p.customerPo).toBe("PTF-0915");
    const c = overallConfidence(p);
    expect(c).toBeGreaterThan(0.5);
    expect(c).toBeLessThan(0.85);
  });

  it("leaves unknown customers unresolved", () => {
    const store = freshStore();
    const p = parseOrderEmail({ from: "ops@bayoumarine.example", subject: "New account", body: "Bayou Marine Services would like 3,000 gallons of ULSD on 2026-09-20." }, ref(store), NOW);
    expect(p.customerId).toBeUndefined();
    expect(p.gallons).toBe(3000);
  });

  it("helpers parse gallons, dates, and POs", () => {
    expect(parseGallons("7,500 gallons")).toBe(7500);
    expect(parseGallons("no numbers")).toBeUndefined();
    expect(parseDate("Sept 18, 2026", NOW)).toBe("2026-09-18");
    expect(parseDate("9/18/2026", NOW)).toBe("2026-09-18");
    expect(parsePo("PO: QSM-7712")).toBe("QSM-7712");
  });
});

describe("intake service", () => {
  it("queues sample emails once, flags issues, and approves into an order", () => {
    const store = freshStore();
    const first = runEmailIntake(store, NOW);
    expect(first.queued.length).toBe(6);
    const again = runEmailIntake(store, NOW);
    expect(again.queued.length).toBe(0);
    expect(again.skipped).toBe(6);
    const dup = first.queued.find((e) => e.subject.startsWith("RE:"))!;
    expect(dup.issues.join(" ")).toContain("already in the review queue");
    const unknown = first.queued.find((e) => e.from.includes("bayou"))!;
    expect(unknown.issues).toContain("No customer matched");
    expect(() => reviewIntake(store, unknown.id, "approve", "u-marcus", {}, NOW)).toThrow(/cannot approve/);
    const ok = reviewIntake(store, first.queued[0].id, "approve", "u-marcus", {}, NOW);
    expect(ok.reviewStatus).toBe("approved");
    const order = store.order(ok.orderId!);
    expect(order.requestedGallons).toBe(7500);
    expect(order.source).toBe("email");
    expect(store.all<any>("orderEvents").filter((e) => e.orderId === order.id).length).toBe(1);
  });

  it("enforces the order workflow and credit holds", () => {
    const store = freshStore();
    expect(() => setOrderStatus(store, "o-1009", "confirmed", "u-marcus", undefined, NOW)).toThrow(/credit hold/);
    expect(() => setOrderStatus(store, "o-1008", "delivered", "u-marcus", undefined, NOW)).toThrow(/cannot move/);
    const o = setOrderStatus(store, "o-1008", "carrier_confirmed", "u-marcus", undefined, NOW);
    expect(o.status).toBe("carrier_confirmed");
  });
});
