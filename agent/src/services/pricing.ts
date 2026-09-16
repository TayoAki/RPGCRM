import type { OpsStore } from "../domain/store.js";
import type { Customer, CustomerPrice, IntegrationRun, PricingRule, Product, RackPrice, Supplier, Terminal } from "../domain/types.js";
import { loadSample } from "../samples/loader.js";
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

/** One line of a supplier rack feed (see agent/samples/rack-feed.json). */
export interface RackFeedPosting {
  postingRef: string;
  supplierCode: string;
  terminalCode: string;
  productCode: string;
  effectiveAt?: string;
  /** Absolute posting, $/gal. */
  price?: number;
  /** Or a move against the last stored rack for the same supplier, terminal, and product. */
  change?: number;
}

export interface RackFeedResult {
  run: IntegrationRun;
  imported: (RackPrice & { supplierCode: string; terminalCode: string; productCode: string; previous: number | null; change: number | null })[];
  skipped: { postingRef: string; reason: string }[];
}

/**
 * Module A, "daily base fuel price import": bring in supplier rack postings
 * from the rack feed instead of typing them. Postings carry a reference so a
 * feed can be re-imported safely; moves apply to the latest stored rack.
 */
export function importRackFeed(store: OpsStore, actorId: string, now: Date = new Date(), postings?: RackFeedPosting[]): RackFeedResult {
  const startedAt = now.toISOString();
  const today = now.toISOString().slice(0, 10);
  const feed = postings ?? loadSample<{ postings: RackFeedPosting[] }>("rack-feed.json", now).postings;
  const suppliers = store.all<Supplier>("suppliers");
  const terminals = store.all<Terminal>("terminals");
  const products = store.all<Product>("products");
  const seen = new Set(store.all<RackPrice>("rackPrices").map((r) => r.sourceRef).filter((x): x is string => !!x));
  const imported: RackFeedResult["imported"] = [];
  const skipped: RackFeedResult["skipped"] = [];
  for (const posting of feed) {
    const ref = posting.postingRef;
    if (!ref) { skipped.push({ postingRef: "(none)", reason: "posting has no postingRef" }); continue; }
    if (seen.has(ref)) { skipped.push({ postingRef: ref, reason: "already imported" }); continue; }
    const supplier = suppliers.find((x) => x.code.toLowerCase() === posting.supplierCode.toLowerCase());
    const terminal = terminals.find((x) => x.code.toLowerCase() === posting.terminalCode.toLowerCase());
    const product = products.find((x) => x.code.toLowerCase() === posting.productCode.toLowerCase());
    if (!supplier) { skipped.push({ postingRef: ref, reason: `unknown supplier ${posting.supplierCode}` }); continue; }
    if (!terminal) { skipped.push({ postingRef: ref, reason: `unknown terminal ${posting.terminalCode}` }); continue; }
    if (!product) { skipped.push({ postingRef: ref, reason: `unknown product ${posting.productCode}` }); continue; }
    if (!terminal.supplierIds.includes(supplier.id)) { skipped.push({ postingRef: ref, reason: `${supplier.code} does not post at ${terminal.code}` }); continue; }
    const previous = store
      .all<RackPrice>("rackPrices")
      .filter((r) => r.supplierId === supplier.id && r.terminalId === terminal.id && r.productId === product.id)
      .sort((a, b) => b.effectiveAt.localeCompare(a.effectiveAt))[0];
    let value: number;
    if (typeof posting.price === "number") value = posting.price;
    else if (typeof posting.change === "number") {
      if (!previous) { skipped.push({ postingRef: ref, reason: `no prior rack for ${supplier.code} ${product.code} at ${terminal.code} to apply a change to` }); continue; }
      value = previous.pricePerGallon + posting.change;
    } else { skipped.push({ postingRef: ref, reason: "posting has neither price nor change" }); continue; }
    if (!(value > 0)) { skipped.push({ postingRef: ref, reason: "price must be positive" }); continue; }
    const rp: RackPrice = {
      id: store.nextId("rackPrices", "rp-"),
      terminalId: terminal.id,
      supplierId: supplier.id,
      productId: product.id,
      effectiveAt: posting.effectiveAt ?? now.toISOString(),
      pricePerGallon: Math.round(value * 10000) / 10000,
      source: "feed",
      enteredBy: actorId,
      sourceRef: ref,
    };
    store.save("rackPrices", rp);
    seen.add(ref);
    imported.push({ ...rp, supplierCode: supplier.code, terminalCode: terminal.code, productCode: product.code, previous: previous?.pricePerGallon ?? null, change: previous ? Math.round((rp.pricePerGallon - previous.pricePerGallon) * 10000) / 10000 : null });
  }
  const run: IntegrationRun = {
    id: store.nextId("integrationRuns", "run-"),
    kind: "rack_feed",
    startedAt,
    finishedAt: new Date().toISOString(),
    status: "success",
    recordsIn: feed.length,
    recordsOut: imported.length,
    summary: imported.length
      ? `${imported.length} rack posting(s) imported for ${today}${skipped.length ? `, ${skipped.length} skipped` : ""}`
      : `Rack postings already current for ${today}${skipped.length ? ` (${skipped.length} skipped)` : ""}`,
  };
  store.save("integrationRuns", run);
  store.audit(actorId, "rackPrice.imported", "integrationRun", run.id, run.summary);
  if (imported.length) recomputeExceptions(store, now);
  return { run, imported, skipped };
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
