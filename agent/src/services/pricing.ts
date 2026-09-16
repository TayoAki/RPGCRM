import type { OpsStore } from "../domain/store.js";
import type { Customer, CustomerPrice, PricingRule, Product, RackPrice, Terminal } from "../domain/types.js";
import { evaluatePrice } from "../pricing/engine.js";
import type { PriceRequest, PriceResult } from "../pricing/engine.js";
import { pricingContext, recomputeExceptions, SYSTEM_ACTOR } from "./context.js";

/** Evaluate and persist a price snapshot (the audit trail for "why this price"). */
export function quotePrice(
  store: OpsStore,
  req: PriceRequest,
  actorId = SYSTEM_ACTOR,
): PriceResult & { snapshot?: CustomerPrice } {
  const result = evaluatePrice(pricingContext(store), req);
  if (!result.ok) return result;
  const snapshot: CustomerPrice = { id: store.nextId("customerPrices", "cp-"), ...result.price };
  store.save("customerPrices", snapshot);
  store.audit(actorId, "price.quoted", "customerPrice", snapshot.id, `${snapshot.sellPricePerGallon.toFixed(4)}/gal via ${result.rule.name}`);
  return { ...result, snapshot };
}

export interface RackPriceInput {
  terminalId: string;
  supplierId: string;
  productId: string;
  pricePerGallon: number;
  effectiveAt?: string;
}

export function enterRackPrice(store: OpsStore, input: RackPriceInput, actorId: string, now: Date = new Date()): RackPrice {
  store.terminal(input.terminalId);
  store.product(input.productId);
  if (!(input.pricePerGallon > 0)) throw new Error("pricePerGallon must be positive");
  const rp: RackPrice = {
    id: store.nextId("rackPrices", "rp-"),
    terminalId: input.terminalId,
    supplierId: input.supplierId,
    productId: input.productId,
    effectiveAt: input.effectiveAt ?? now.toISOString(),
    pricePerGallon: Math.round(input.pricePerGallon * 10000) / 10000,
    source: "manual",
    enteredBy: actorId,
  };
  store.save("rackPrices", rp);
  store.audit(actorId, "rackPrice.entered", "rackPrice", rp.id, `${input.productId} @ ${input.terminalId} = ${rp.pricePerGallon}`);
  recomputeExceptions(store, now);
  return rp;
}

export type PricingRuleInput = Omit<PricingRule, "id"> & { id?: string };

export function upsertPricingRule(store: OpsStore, input: PricingRuleInput, actorId: string, now: Date = new Date()): PricingRule {
  store.product(input.productId);
  if (input.customerId) store.customer(input.customerId);
  if (input.basisType === "fixed" && !(input.fixedPrice && input.fixedPrice > 0)) throw new Error("fixed rules need a positive fixedPrice");
  if (input.basisType === "index" && !input.basisRef) throw new Error("index rules need basisRef (an index id)");
  const rule: PricingRule = { ...input, id: input.id ?? store.nextId("pricingRules", "rule-") };
  store.save("pricingRules", rule);
  store.audit(actorId, input.id ? "pricingRule.updated" : "pricingRule.created", "pricingRule", rule.id, rule.name);
  recomputeExceptions(store, now);
  return rule;
}

export interface PriceBoardRow {
  customerId: string;
  customerName: string;
  productId: string;
  productName: string;
  terminalId: string | null;
  terminalName: string | null;
  sellPricePerGallon: number | null;
  basisType: string | null;
  ruleName: string | null;
  error: string | null;
}

/** Today's auto-calculated price for every customer/product pair a rule covers (Module A dashboard). */
export function priceBoard(store: OpsStore, date: string): PriceBoardRow[] {
  const ctx = pricingContext(store);
  const rows: PriceBoardRow[] = [];
  for (const c of store.all<Customer>("customers")) {
    if (c.status === "inactive") continue;
    for (const p of store.all<Product>("products")) {
      const covered = ctx.rules.some((r) => r.productId === p.id && (r.customerId === null || r.customerId === c.id));
      if (!covered) continue;
      const r = evaluatePrice(ctx, { customerId: c.id, productId: p.id, date });
      const terminal = r.ok ? store.all<Terminal>("terminals").find((t) => t.id === r.price.terminalId) : undefined;
      rows.push({
        customerId: c.id,
        customerName: c.name,
        productId: p.id,
        productName: p.name,
        terminalId: r.ok ? r.price.terminalId : null,
        terminalName: terminal?.name ?? null,
        sellPricePerGallon: r.ok ? r.price.sellPricePerGallon : null,
        basisType: r.ok ? r.price.basisType : null,
        ruleName: r.ok ? r.rule.name : null,
        error: r.ok ? null : r.message,
      });
    }
  }
  return rows;
}
