import type {
  Bol,
  Carrier,
  CarrierRate,
  Customer,
  CustomerPrice,
  DeliveryLocation,
  Invoice,
  Load,
  LoadMargin,
  RackPrice,
} from "../domain/types.js";
import { latestRackPrice } from "../pricing/engine.js";
import { round2 } from "../pricing/taxes.js";
import { invoiceNetRevenue } from "../billing/invoices.js";

/**
 * Expected vs. actual profit per load (Module B).
 *
 * expected = (sell price pre-tax − rack at scheduled lift − freight we pay) × planned gallons
 * actual   = (invoice revenue excl. taxes, or provisional price × BOL gallons)
 *            − BOL supplier cost − freight paid
 * Taxes are pass-through on both sides and excluded from margin.
 */

export interface MarginContext {
  bols: Bol[];
  invoices: Invoice[];
  customerPrices: CustomerPrice[];
  rackPrices: RackPrice[];
  carrierRates: CarrierRate[];
  carriers: Carrier[];
  customers: Customer[];
  deliveryLocations: DeliveryLocation[];
}

export function freightRatePerGallon(load: Load, ctx: MarginContext): { rate: number; minimum: number } {
  const loc = ctx.deliveryLocations.find((l) => l.id === load.deliveryLocationId);
  const lane = ctx.carrierRates.find(
    (r) =>
      r.carrierId === load.carrierId &&
      r.terminalId === load.terminalId &&
      (!loc || r.destinationState === loc.state),
  );
  if (lane) return { rate: lane.ratePerGallon, minimum: lane.minimumCharge };
  const carrier = ctx.carriers.find((c) => c.id === load.carrierId);
  return { rate: carrier?.defaultRatePerGallon ?? 0.05, minimum: 0 };
}

/** Latest price snapshot for the load's customer/product on or before its lift date. */
export function priceSnapshotForLoad(load: Load, ctx: MarginContext): CustomerPrice | undefined {
  const asOf = load.scheduledPickupAt.slice(0, 10);
  let best: CustomerPrice | undefined;
  for (const cp of ctx.customerPrices) {
    if (cp.customerId !== load.customerId || cp.productId !== load.productId) continue;
    if (cp.priceDate > asOf) continue;
    if (!best || cp.priceDate > best.priceDate || (cp.priceDate === best.priceDate && cp.computedAt > best.computedAt))
      best = cp;
  }
  return best;
}

export function computeLoadMargin(load: Load, ctx: MarginContext, now: Date): LoadMargin {
  const customer = ctx.customers.find((c) => c.id === load.customerId);
  const basis = customer?.billingBasis ?? "net";
  const snapshot = priceSnapshotForLoad(load, ctx);
  const preTaxSell = snapshot
    ? snapshot.basisValue + snapshot.differential + snapshot.freight + snapshot.fees
    : 0;
  const rack = latestRackPrice(ctx.rackPrices, load.terminalId, load.productId, load.scheduledPickupAt);
  const freight = freightRatePerGallon(load, ctx);
  const expectedFreight = Math.max(freight.rate * load.plannedGallons, freight.minimum);
  const expectedGrossProfit = snapshot && rack
    ? round2((preTaxSell - rack.pricePerGallon) * load.plannedGallons - expectedFreight)
    : 0;

  const bol = load.bolId ? ctx.bols.find((b) => b.id === load.bolId) : undefined;
  let gallons = load.plannedGallons;
  let revenue = round2(preTaxSell * load.plannedGallons);
  let supplierCost = rack ? round2(rack.pricePerGallon * load.plannedGallons) : 0;
  let taxesPassthrough = 0;
  let freightCost = round2(load.freightCost > 0 ? load.freightCost : expectedFreight);
  let actualGrossProfit: number | null = null;

  if (bol) {
    gallons = bol.lines.reduce((s, l) => s + (basis === "net" ? l.netGallons : l.grossGallons), 0);
    const netGallons = bol.lines.reduce((s, l) => s + l.netGallons, 0);
    supplierCost = round2(bol.lines.reduce((s, l) => s + l.supplierCostPerGallon * l.netGallons, 0));
    taxesPassthrough = round2(bol.lines.reduce((s, l) => s + l.taxesPerGallon * l.netGallons, 0));
    const invoice = ctx.invoices.find((i) => i.loadId === load.id && i.status !== "void");
    revenue = invoice ? invoiceNetRevenue(invoice) : round2(preTaxSell * gallons);
    freightCost = round2(load.freightCost > 0 ? load.freightCost : Math.max(freight.rate * netGallons, freight.minimum));
    actualGrossProfit = round2(revenue - supplierCost - freightCost);
  }

  return {
    id: load.id,
    loadId: load.id,
    customerId: load.customerId,
    productId: load.productId,
    gallons,
    revenue,
    supplierCost,
    taxesPassthrough,
    freightCost,
    expectedGrossProfit,
    actualGrossProfit,
    profitPerGallon: actualGrossProfit === null || gallons === 0 ? null : Math.round((actualGrossProfit / gallons) * 10000) / 10000,
    variance: actualGrossProfit === null ? null : round2(actualGrossProfit - expectedGrossProfit),
    computedAt: now.toISOString(),
  };
}
