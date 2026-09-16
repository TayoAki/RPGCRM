import type { OpsStore } from "../domain/store.js";
import type {
  Bol,
  Carrier,
  CarrierRate,
  Customer,
  CustomerPrice,
  DeliveryLocation,
  IndexPrice,
  Invoice,
  Load,
  LoadMargin,
  OpsException,
  PriceIndex,
  PricingRule,
  Product,
  RackPrice,
  TaxRate,
  Terminal,
} from "../domain/types.js";
import type { PricingContext, PriceRequest, PriceResult } from "../pricing/engine.js";
import { evaluatePrice } from "../pricing/engine.js";
import type { MarginContext } from "../margin/compute.js";
import { computeLoadMargin } from "../margin/compute.js";
import { detectExceptions, reconcileExceptions } from "../exceptions/rules.js";

export const SYSTEM_ACTOR = "system";

export function pricingContext(store: OpsStore): PricingContext {
  return {
    rules: store.all<PricingRule>("pricingRules"),
    rackPrices: store.all<RackPrice>("rackPrices"),
    indexPrices: store.all<IndexPrice>("indexPrices"),
    priceIndexes: store.all<PriceIndex>("priceIndexes"),
    taxRates: store.all<TaxRate>("taxRates"),
    customers: store.all<Customer>("customers"),
    products: store.all<Product>("products"),
    deliveryLocations: store.all<DeliveryLocation>("deliveryLocations"),
    terminals: store.all<Terminal>("terminals"),
  };
}

export function marginContext(store: OpsStore): MarginContext {
  return {
    bols: store.all<Bol>("bols"),
    invoices: store.all<Invoice>("invoices"),
    customerPrices: store.all<CustomerPrice>("customerPrices"),
    rackPrices: store.all<RackPrice>("rackPrices"),
    carrierRates: store.all<CarrierRate>("carrierRates"),
    carriers: store.all<Carrier>("carriers"),
    customers: store.all<Customer>("customers"),
    deliveryLocations: store.all<DeliveryLocation>("deliveryLocations"),
  };
}

export function priceWith(store: OpsStore): (req: PriceRequest) => PriceResult {
  const ctx = pricingContext(store);
  return (req) => evaluatePrice(ctx, req);
}

export function recomputeMargins(store: OpsStore, now: Date = new Date()): LoadMargin[] {
  const ctx = marginContext(store);
  const margins = store.all<Load>("loads").map((l) => computeLoadMargin(l, ctx, now));
  store.docs.clear("loadMargins");
  store.saveMany("loadMargins", margins);
  return margins;
}

export function recomputeExceptions(store: OpsStore, now: Date = new Date()): { opened: number; autoResolved: number; open: number } {
  const state = store.snapshot();
  const detected = detectExceptions(state, now, priceWith(store));
  const existing = store.all<OpsException>("exceptions");
  // Allocate ids from a local counter: nextId() scans the collection, which does
  // not change until the batch is saved, so it would hand out the same id twice.
  let counter = parseInt(store.nextId("exceptions", "ex-").slice(3), 10);
  const { changed, opened, autoResolved } = reconcileExceptions(existing, detected, () => `ex-${counter++}`, now);
  store.saveMany("exceptions", changed);
  const open = store.all<OpsException>("exceptions").filter((e) => e.status !== "resolved").length;
  return { opened, autoResolved, open };
}

/** Margins depend on BOLs/invoices; exceptions depend on margins. Run both after any mutation. */
export function recomputeAll(store: OpsStore, now: Date = new Date()): void {
  recomputeMargins(store, now);
  recomputeExceptions(store, now);
}
