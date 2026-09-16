import { describe, it, expect } from "vitest";
import { evaluatePrice, matchRules, specificity } from "../pricing/engine.js";
import { taxesPerGallon, taxLinesFor } from "../pricing/taxes.js";
import { pricingContext } from "../services/context.js";
import { priceBoard, quotePrice, upsertPricingRule } from "../services/pricing.js";
import { freshStore, NOW } from "./helpers.js";

const today = NOW.toISOString().slice(0, 10);

describe("taxes", () => {
  it("sums the components in force for a category", () => {
    const store = freshStore();
    const rates = store.all("taxRates") as never;
    expect(taxesPerGallon(rates, "TX", "clear_diesel", today)).toBeCloseTo(0.4455, 5);
    expect(taxesPerGallon(rates, "TX", "gasoline", today)).toBeCloseTo(0.3855, 5);
    expect(taxesPerGallon(rates, "TX", "dyed_diesel", today)).toBeCloseTo(0.0025, 5);
    expect(taxesPerGallon(rates, "TX", "def", today)).toBe(0);
    expect(taxesPerGallon(rates, "OK", "clear_diesel", today)).toBe(0);
  });

  it("produces tax lines with cent-rounded amounts", () => {
    const store = freshStore();
    const lines = taxLinesFor(store.all("taxRates") as never, "TX", "gasoline", today, 8000);
    expect(lines.map((l) => l.component).sort()).toEqual(["environmental", "federal_excise", "lust", "state_excise"]);
    expect(lines.find((l) => l.component === "federal_excise")!.amount).toBe(1472);
  });
});

describe("pricing engine", () => {
  it("prefers the most specific rule, then priority", () => {
    const store = freshStore();
    const ctx = pricingContext(store);
    const rules = matchRules(ctx, { customerId: "cust-qsm", productId: "p-unl87", terminalId: "t-dal", date: today });
    expect(rules[0].id).toBe("rule-qsm-87-dal");
    expect(specificity(rules[0])).toBeGreaterThan(specificity(rules[rules.length - 1]));
  });

  it("falls back to the default rule for an uncovered customer", () => {
    const store = freshStore();
    const r = evaluatePrice(pricingContext(store), { customerId: "cust-trc", productId: "p-ulsd", terminalId: "t-dal", date: today });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.rule.id).toBe("rule-def-ulsd");
      expect(r.price.sellPricePerGallon).toBeCloseTo(r.price.basisValue + 0.12 + 0.06 + 0.005 + 0.4455, 3);
    }
  });

  it("uses a fixed contract price and honors tax exemption", () => {
    const store = freshStore();
    const r = evaluatePrice(pricingContext(store), { customerId: "cust-bcr", productId: "p-ulsd", deliveryLocationId: "loc-bcr-yard", date: today });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.price.basisType).toBe("fixed");
      expect(r.price.basisValue).toBe(2.79);
      expect(r.price.taxesPerGallon).toBe(0);
      expect(r.price.sellPricePerGallon).toBeCloseTo(2.79 + 0.05, 4);
    }
  });

  it("prices an index-based contract off the latest index value", () => {
    const store = freshStore();
    const ctx = pricingContext(store);
    const r = evaluatePrice(ctx, { customerId: "cust-lsa", productId: "p-dyed", date: today });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.price.basisType).toBe("index");
      const latest = ctx.indexPrices.filter((p) => p.indexId === "idx-opis-dal-ulsd").sort((a, b) => b.date.localeCompare(a.date))[0];
      expect(r.price.basisValue).toBe(latest.value);
      expect(r.price.explanation.join(" ")).toContain("OPIS-DAL-ULSD");
    }
  });

  it("reports no_rule when only a draft rule exists", () => {
    const store = freshStore();
    const r = evaluatePrice(pricingContext(store), { customerId: "cust-trc", productId: "p-def", date: today });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("no_rule");
  });

  it("respects effective windows", () => {
    const store = freshStore();
    const r = evaluatePrice(pricingContext(store), { customerId: "cust-bcr", productId: "p-ulsd", date: "2030-01-01" });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.rule.id).toBe("rule-def-ulsd"); // fixed contract expired → default
  });
});

describe("pricing service", () => {
  it("quotePrice persists a snapshot and an audit entry", () => {
    const store = freshStore();
    const before = store.all("customerPrices").length;
    const r = quotePrice(store, { customerId: "cust-qsm", productId: "p-unl87", terminalId: "t-dal", date: today }, "u-priya");
    expect(r.ok).toBe(true);
    expect(store.all("customerPrices").length).toBe(before + 1);
    expect(store.all("auditLog").some((a: any) => a.action === "price.quoted")).toBe(true);
  });

  it("activating a rule clears a pricing_missing exception", () => {
    const store = freshStore();
    expect(store.all("exceptions").some((e: any) => e.type === "pricing_missing" && e.status === "open")).toBe(true);
    const draft = store.require<any>("pricingRules", "rule-def-def");
    upsertPricingRule(store, { ...draft, status: "active" }, "u-priya", NOW);
    const open = store.all<any>("exceptions").filter((e) => e.type === "pricing_missing" && e.status === "open");
    expect(open.length).toBe(0);
  });

  it("price board covers every customer/product pair a rule applies to", () => {
    const store = freshStore();
    const rows = priceBoard(store, today);
    expect(rows.length).toBe(35);
    expect(rows.filter((r) => r.error).every((r) => r.productName.startsWith("DEF"))).toBe(true);
  });
});
