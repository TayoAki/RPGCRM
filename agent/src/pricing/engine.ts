import type {
  Customer,
  CustomerPrice,
  DeliveryLocation,
  IndexPrice,
  PriceIndex,
  PricingRule,
  Product,
  RackPrice,
  TaxRate,
  Terminal,
} from "../domain/types.js";
import { round4, taxesPerGallon } from "./taxes.js";

/**
 * Pricing engine (Module A). Pure: takes the reference data it needs and
 * returns either a fully explained price or a typed reason it could not price.
 *
 * Rule selection: a rule applies when it is active, covers the product, is in
 * its effective window on the request date, and each of its scoping fields is
 * either null or equal to the request's value. Among applicable rules the most
 * specific wins (delivery location > terminal > customer), then the highest
 * priority, then the most recent effective start.
 */

export interface PriceRequest {
  customerId: string;
  productId: string;
  terminalId?: string;
  deliveryLocationId?: string;
  /** ISO date or datetime the price is for (rack/index as of this moment). */
  date: string;
}

export interface PricingContext {
  rules: PricingRule[];
  rackPrices: RackPrice[];
  indexPrices: IndexPrice[];
  priceIndexes: PriceIndex[];
  taxRates: TaxRate[];
  customers: Customer[];
  products: Product[];
  deliveryLocations: DeliveryLocation[];
  terminals: Terminal[];
}

export type PriceFailure =
  | "unknown_customer"
  | "unknown_product"
  | "no_rule"
  | "no_basis"
  | "no_terminal";

export type PriceResult =
  | { ok: true; price: Omit<CustomerPrice, "id">; rule: PricingRule }
  | { ok: false; reason: PriceFailure; message: string };

export function specificity(rule: PricingRule): number {
  return (
    (rule.deliveryLocationId ? 8 : 0) +
    (rule.terminalId ? 4 : 0) +
    (rule.customerId ? 2 : 0)
  );
}

export function ruleApplies(
  rule: PricingRule,
  req: PriceRequest,
  date: string,
): boolean {
  if (rule.status !== "active") return false;
  if (rule.productId !== req.productId) return false;
  if (rule.customerId && rule.customerId !== req.customerId) return false;
  if (rule.terminalId && req.terminalId && rule.terminalId !== req.terminalId)
    return false;
  if (
    rule.deliveryLocationId &&
    rule.deliveryLocationId !== (req.deliveryLocationId ?? null)
  )
    return false;
  if (rule.effectiveStart > date) return false;
  if (rule.effectiveEnd && rule.effectiveEnd <= date) return false;
  return true;
}

export function matchRules(ctx: PricingContext, req: PriceRequest): PricingRule[] {
  const date = normalizeDate(req.date);
  return ctx.rules
    .filter((r) => ruleApplies(r, req, date))
    .sort(
      (a, b) =>
        specificity(b) - specificity(a) ||
        b.priority - a.priority ||
        b.effectiveStart.localeCompare(a.effectiveStart),
    );
}

export function latestRackPrice(
  rackPrices: RackPrice[],
  terminalId: string,
  productId: string,
  asOf: string,
): RackPrice | undefined {
  let best: RackPrice | undefined;
  for (const rp of rackPrices) {
    if (rp.terminalId !== terminalId || rp.productId !== productId) continue;
    if (rp.effectiveAt > asOf) continue;
    if (!best || rp.effectiveAt > best.effectiveAt) best = rp;
  }
  return best;
}

export function latestIndexPrice(
  indexPrices: IndexPrice[],
  indexId: string,
  asOf: string,
): IndexPrice | undefined {
  const d = asOf.slice(0, 10);
  let best: IndexPrice | undefined;
  for (const ip of indexPrices) {
    if (ip.indexId !== indexId || ip.date > d) continue;
    if (!best || ip.date > best.date) best = ip;
  }
  return best;
}

/** Cheapest terminal (by latest rack price) that posts the product as of a date. */
export function cheapestTerminal(
  ctx: PricingContext,
  productId: string,
  asOf: string,
): { terminal: Terminal; rack: RackPrice } | undefined {
  let best: { terminal: Terminal; rack: RackPrice } | undefined;
  for (const t of ctx.terminals) {
    const rack = latestRackPrice(ctx.rackPrices, t.id, productId, asOf);
    if (!rack) continue;
    if (!best || rack.pricePerGallon < best.rack.pricePerGallon)
      best = { terminal: t, rack };
  }
  return best;
}

export function evaluatePrice(ctx: PricingContext, req: PriceRequest): PriceResult {
  const customer = ctx.customers.find((c) => c.id === req.customerId);
  if (!customer)
    return { ok: false, reason: "unknown_customer", message: `Unknown customer ${req.customerId}` };
  const product = ctx.products.find((p) => p.id === req.productId);
  if (!product)
    return { ok: false, reason: "unknown_product", message: `Unknown product ${req.productId}` };

  const asOf = req.date.length === 10 ? `${req.date}T23:59:59.000Z` : req.date;
  const date = normalizeDate(req.date);
  const rules = matchRules(ctx, req);
  const rule = rules[0];
  if (!rule)
    return {
      ok: false,
      reason: "no_rule",
      message: `No active pricing rule for ${customer.name} / ${product.name} on ${date}`,
    };

  const explanation: string[] = [];
  explanation.push(
    `Rule "${rule.name}" (${rule.customerId ? "customer-specific" : "default"}, priority ${rule.priority})`,
  );

  // Resolve the lift terminal: request > rule scope > rule rack basis > cheapest rack.
  let terminalId = req.terminalId ?? rule.terminalId ?? undefined;
  if (!terminalId && rule.basisType === "rack" && rule.basisRef) terminalId = rule.basisRef;
  if (!terminalId) {
    const cheapest = cheapestTerminal(ctx, product.id, asOf);
    if (cheapest) {
      terminalId = cheapest.terminal.id;
      explanation.push(`Lift terminal not specified; using cheapest rack (${cheapest.terminal.name})`);
    }
  }
  if (!terminalId)
    return { ok: false, reason: "no_terminal", message: `No terminal posts ${product.name}` };
  const terminal = ctx.terminals.find((t) => t.id === terminalId);

  // Basis value.
  let basisValue: number;
  if (rule.basisType === "fixed") {
    if (rule.fixedPrice === null)
      return { ok: false, reason: "no_basis", message: `Rule ${rule.name} has no fixed price` };
    basisValue = rule.fixedPrice;
    explanation.push(`Fixed contract price $${basisValue.toFixed(4)}/gal`);
  } else if (rule.basisType === "index") {
    const idx = ctx.priceIndexes.find((i) => i.id === rule.basisRef);
    const ip = rule.basisRef ? latestIndexPrice(ctx.indexPrices, rule.basisRef, asOf) : undefined;
    if (!idx || !ip)
      return { ok: false, reason: "no_basis", message: `No index value for ${idx?.code ?? rule.basisRef} as of ${date}` };
    basisValue = ip.value;
    explanation.push(`Index ${idx.code} = $${ip.value.toFixed(4)} (${ip.date})`);
  } else {
    const rackTerminal = rule.basisRef ?? terminalId;
    const rp = latestRackPrice(ctx.rackPrices, rackTerminal, product.id, asOf);
    if (!rp) {
      const tname = ctx.terminals.find((t) => t.id === rackTerminal)?.name ?? rackTerminal;
      return { ok: false, reason: "no_basis", message: `No rack price for ${product.name} at ${tname} as of ${date}` };
    }
    basisValue = rp.pricePerGallon;
    const tname = ctx.terminals.find((t) => t.id === rackTerminal)?.name ?? rackTerminal;
    explanation.push(`Rack ${tname} = $${rp.pricePerGallon.toFixed(4)} (posted ${rp.effectiveAt.slice(0, 16).replace("T", " ")})`);
  }

  explanation.push(
    `Differential ${fmtSigned(rule.differential)}, freight ${fmtSigned(rule.freightPerGallon)}, fees ${fmtSigned(rule.feesPerGallon)}`,
  );

  // Taxes: rule treatment, then customer exemption; jurisdiction from the delivery location
  // when given, else the terminal's state.
  let taxes = 0;
  const location = req.deliveryLocationId
    ? ctx.deliveryLocations.find((l) => l.id === req.deliveryLocationId)
    : undefined;
  const state = location?.state ?? terminal?.state ?? "TX";
  if (rule.taxTreatment === "exempt" || customer.taxExempt) {
    explanation.push(
      customer.taxExempt ? "Customer is tax exempt (certificate on file)" : "Rule is tax exempt",
    );
  } else {
    taxes = taxesPerGallon(ctx.taxRates, state, product.taxCategory, date);
    explanation.push(`Taxes ${state} ${product.taxCategory}: $${taxes.toFixed(4)}/gal`);
  }

  const sell = round4(
    basisValue + rule.differential + rule.freightPerGallon + rule.feesPerGallon + taxes,
  );
  explanation.push(`Sell price $${sell.toFixed(4)}/gal`);

  return {
    ok: true,
    rule,
    price: {
      customerId: customer.id,
      productId: product.id,
      terminalId,
      deliveryLocationId: req.deliveryLocationId ?? null,
      priceDate: date,
      computedAt: new Date().toISOString(),
      pricingRuleId: rule.id,
      basisType: rule.basisType,
      basisValue: round4(basisValue),
      differential: rule.differential,
      freight: rule.freightPerGallon,
      fees: rule.feesPerGallon,
      taxesPerGallon: taxes,
      sellPricePerGallon: sell,
      explanation,
    },
  };
}

export function normalizeDate(d: string): string {
  return d.slice(0, 10);
}

function fmtSigned(n: number): string {
  return `${n >= 0 ? "+" : "-"}$${Math.abs(n).toFixed(4)}`;
}
