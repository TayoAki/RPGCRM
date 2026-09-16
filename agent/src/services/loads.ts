import type { OpsStore } from "../domain/store.js";
import type {
  BillingStatus,
  Bol,
  BolLine,
  Carrier,
  Customer,
  Delivery,
  IntegrationRun,
  Load,
  LoadStatus,
  LoadStatusEvent,
  Order,
  Product,
  RackPrice,
  Supplier,
  Terminal,
} from "../domain/types.js";
import { BILLING_STATUSES } from "../domain/types.js";
import { dedupeHash, findBestLoad } from "../bols/match.js";
import { latestRackPrice } from "../pricing/engine.js";
import { taxesPerGallon } from "../pricing/taxes.js";
import { loadSample } from "../samples/loader.js";
import { freightRatePerGallon } from "../margin/compute.js";
import { marginContext, recomputeAll } from "./context.js";
import { setOrderStatus } from "./orders.js";

export interface CreateLoadInput {
  orderId: string;
  carrierId: string;
  terminalId: string;
  supplierId: string;
  scheduledPickupAt: string;
  scheduledDeliveryAt: string;
  driverName?: string;
  plannedGallons?: number;
}

export function createLoadForOrder(store: OpsStore, input: CreateLoadInput, actorId: string, now: Date = new Date()): Load {
  const order = store.order(input.orderId);
  if (["delivered", "cancelled"].includes(order.status)) throw new Error(`order ${order.orderNumber} is ${order.status}`);
  if (order.creditHold || store.customer(order.customerId).status === "on_hold")
    throw new Error(`order ${order.orderNumber} is on credit hold; release it before dispatching`);
  store.require<Carrier>("carriers", input.carrierId);
  const terminal = store.terminal(input.terminalId);
  if (!terminal.supplierIds.includes(input.supplierId)) throw new Error(`${terminal.name} does not host supplier ${input.supplierId}`);
  const existing = store.all<Load>("loads").find((l) => l.orderIds.includes(order.id) && l.status !== "closed");
  if (existing) throw new Error(`order ${order.orderNumber} already has load ${existing.loadNumber}`);
  const seq = store.nextId("loads", "l-");
  const load: Load = {
    id: seq,
    loadNumber: `LD-${seq.slice(2)}`,
    orderIds: [order.id],
    customerId: order.customerId,
    deliveryLocationId: order.deliveryLocationId,
    productId: order.productId,
    carrierId: input.carrierId,
    driverName: input.driverName,
    terminalId: input.terminalId,
    supplierId: input.supplierId,
    plannedGallons: input.plannedGallons ?? order.requestedGallons,
    scheduledPickupAt: input.scheduledPickupAt,
    scheduledDeliveryAt: input.scheduledDeliveryAt,
    status: "planned",
    billingStatus: null,
    freightCost: 0,
  };
  store.save("loads", load);
  appendLoadEvent(store, load, null, "planned", actorId, now);
  if (order.status === "received") setOrderStatus(store, order.id, "confirmed", actorId, `Load ${load.loadNumber} planned`, now);
  store.audit(actorId, "load.created", "load", load.id, `${load.loadNumber} for ${order.orderNumber}`);
  recomputeAll(store, now);
  return load;
}

const LOAD_FLOW: Record<LoadStatus, LoadStatus[]> = {
  planned: ["dispatched"],
  dispatched: ["loading", "in_transit"],
  loading: ["in_transit"],
  in_transit: ["delivered"],
  delivered: ["closed"],
  closed: [],
};

export function setLoadStatus(store: OpsStore, loadId: string, to: LoadStatus, actorId: string, note?: string, now: Date = new Date()): Load {
  const load = store.load(loadId);
  if (load.status === to) return load;
  if (!LOAD_FLOW[load.status].includes(to)) throw new Error(`cannot move load from ${load.status} to ${to}`);
  const updated: Load = { ...load, status: to };
  store.save("loads", updated);
  appendLoadEvent(store, updated, load.status, to, actorId, now, note);
  // Keep the customer-facing order milestones in step with the load.
  const orderTarget: Partial<Record<LoadStatus, Order["status"]>> = {
    dispatched: "carrier_confirmed",
    loading: "in_transit",
    in_transit: "in_transit",
    delivered: "delivered",
  };
  const target = orderTarget[to];
  if (target) {
    for (const orderId of load.orderIds) {
      const order = store.order(orderId);
      const path: Order["status"][] = ["received", "confirmed", "carrier_confirmed", "in_transit", "delivered"];
      let idx = path.indexOf(order.status);
      const want = path.indexOf(target);
      while (idx >= 0 && idx < want) {
        idx++;
        try {
          setOrderStatus(store, orderId, path[idx], actorId, `via ${load.loadNumber}`, now);
        } catch {
          break; // e.g. credit hold; leave the order where it is
        }
      }
    }
  }
  store.audit(actorId, "load.status", "load", load.id, `${load.status} → ${to}`);
  recomputeAll(store, now);
  return updated;
}

export interface DeliveryInput {
  deliveredGallons: number;
  receiverName: string;
  ticketNumber: string;
  deliveredAt?: string;
}

export function recordDelivery(store: OpsStore, loadId: string, input: DeliveryInput, actorId: string, now: Date = new Date()): Delivery {
  const load = store.load(loadId);
  if (["planned"].includes(load.status)) throw new Error("load has not been dispatched");
  const delivery: Delivery = {
    id: store.nextId("deliveries", "dl-"),
    loadId: load.id,
    deliveredAt: input.deliveredAt ?? now.toISOString(),
    deliveredGallons: input.deliveredGallons,
    receiverName: input.receiverName,
    ticketNumber: input.ticketNumber,
  };
  store.save("deliveries", delivery);
  if (load.status !== "delivered" && load.status !== "closed") setLoadStatus(store, load.id, "delivered", actorId, `Ticket ${input.ticketNumber}`, now);
  store.audit(actorId, "delivery.recorded", "load", load.id, `${input.deliveredGallons} gal, ticket ${input.ticketNumber}`);
  recomputeAll(store, now);
  return delivery;
}

export function setBillingStatus(store: OpsStore, loadId: string, to: BillingStatus, actorId: string, now: Date = new Date()): Load {
  const load = store.load(loadId);
  if (!BILLING_STATUSES.includes(to)) throw new Error(`invalid billing status ${to}`);
  if (!load.bolId) throw new Error(`load ${load.loadNumber} has no BOL; billing starts when a BOL is received`);
  const order = BILLING_STATUSES.indexOf(to);
  const current = load.billingStatus ? BILLING_STATUSES.indexOf(load.billingStatus) : -1;
  if (order > 2 && !load.invoiceId) throw new Error(`invoiced/paid require an invoice; prepare one first`);
  if (order < current && current >= 3) throw new Error(`cannot move an invoiced load back to ${to}`);
  const updated: Load = { ...load, billingStatus: to };
  store.save("loads", updated);
  store.audit(actorId, "load.billingStatus", "load", load.id, `${load.billingStatus ?? "none"} → ${to}`);
  recomputeAll(store, now);
  return updated;
}

export function appendLoadEvent(store: OpsStore, load: Load, from: LoadStatus | null, to: LoadStatus, actorId: string, now: Date, note?: string): LoadStatusEvent {
  const ev: LoadStatusEvent = { id: store.nextId("loadEvents", "le-"), loadId: load.id, from, to, occurredAt: now.toISOString(), actorId, note };
  return store.save("loadEvents", ev);
}

// ---------------------------------------------------------------------------
// BOLs (Module E)
// ---------------------------------------------------------------------------

interface SampleBolLine {
  productCode: string;
  grossGallons: number;
  netGallons: number;
  supplierCostPerGallon: number | "{{RACK}}";
  taxesPerGallon?: number;
  feesPerGallon?: number;
}

interface SampleBol {
  bolNumber: string;
  supplierCode: string;
  terminalCode: string;
  carrierCode: string;
  liftedAt: string;
  destinationText: string;
  customerRef: string;
  lines: SampleBolLine[];
}

export interface BolInput {
  bolNumber: string;
  supplierId: string;
  terminalId: string;
  carrierId: string;
  liftedAt: string;
  destinationText: string;
  customerRef: string;
  source: Bol["source"];
  lines: { productId: string; grossGallons: number; netGallons: number; supplierCostPerGallon?: number; taxesPerGallon?: number; feesPerGallon?: number }[];
}

export interface IngestResult {
  bol: Bol;
  outcome: "matched" | "unmatched" | "duplicate";
  load?: Load;
}

/** Ingest one BOL: dedupe, resolve costs, match to a load, start the billing workflow. */
export function ingestBol(store: OpsStore, input: BolInput, actorId: string, now: Date = new Date()): IngestResult {
  const hash = dedupeHash({ supplierId: input.supplierId, bolNumber: input.bolNumber });
  const existing = store.all<Bol>("bols").find((b) => b.dedupeHash === hash);
  const lines: BolLine[] = input.lines.map((l) => {
    const product = store.product(l.productId);
    const rack = latestRackPrice(store.all<RackPrice>("rackPrices"), input.terminalId, l.productId, input.liftedAt);
    return {
      productId: l.productId,
      grossGallons: l.grossGallons,
      netGallons: l.netGallons,
      supplierCostPerGallon: l.supplierCostPerGallon ?? rack?.pricePerGallon ?? 0,
      taxesPerGallon: l.taxesPerGallon ?? taxesPerGallon(store.all("taxRates"), store.terminal(input.terminalId).state, product.taxCategory, input.liftedAt),
      feesPerGallon: l.feesPerGallon ?? 0.0025,
    };
  });
  if (existing) {
    const dup: Bol = {
      ...input,
      id: store.nextId("bols", "bol-"),
      loadId: null,
      dedupeHash: hash,
      matchStatus: "duplicate",
      lines,
    };
    store.save("bols", dup);
    store.audit(actorId, "bol.duplicate", "bol", dup.id, `${input.bolNumber} duplicates ${existing.id}`);
    return { bol: dup, outcome: "duplicate" };
  }
  const bol: Bol = { ...input, id: store.nextId("bols", "bol-"), loadId: null, dedupeHash: hash, matchStatus: "unmatched", lines };
  const match = findBestLoad(bol, store.all<Load>("loads"), store.all<Customer>("customers"));
  if (match) {
    bol.loadId = match.load.id;
    bol.matchStatus = "matched";
    store.save("bols", bol);
    const load = attachBol(store, match.load, bol, actorId, now);
    store.audit(actorId, "bol.matched", "bol", bol.id, `${bol.bolNumber} → ${load.loadNumber} (score ${match.score})`);
    return { bol, outcome: "matched", load };
  }
  store.save("bols", bol);
  store.audit(actorId, "bol.unmatched", "bol", bol.id, `${bol.bolNumber} for "${bol.destinationText}"`);
  return { bol, outcome: "unmatched" };
}

function attachBol(store: OpsStore, load: Load, bol: Bol, actorId: string, now: Date): Load {
  const freight = freightRatePerGallon(load, marginContext(store));
  const net = bol.lines.reduce((s, l) => s + l.netGallons, 0);
  const updated: Load = {
    ...load,
    bolId: bol.id,
    billingStatus: load.billingStatus ?? "bol_received",
    freightCost: load.freightCost > 0 ? load.freightCost : Math.round(Math.max(freight.rate * net, freight.minimum) * 100) / 100,
  };
  store.save("loads", updated);
  if (updated.status === "dispatched" || updated.status === "planned") {
    // A BOL proves the truck lifted product.
    const next: Load = { ...updated, status: "in_transit" };
    store.save("loads", next);
    appendLoadEvent(store, next, updated.status, "in_transit", actorId, now, `BOL ${bol.bolNumber} received`);
    for (const orderId of next.orderIds) {
      try {
        const o = store.order(orderId);
        if (o.status === "confirmed") setOrderStatus(store, orderId, "carrier_confirmed", actorId, undefined, now);
        if (store.order(orderId).status === "carrier_confirmed") setOrderStatus(store, orderId, "in_transit", actorId, `BOL ${bol.bolNumber}`, now);
      } catch { /* order may be on hold */ }
    }
    return next;
  }
  return updated;
}

export function matchBolToLoad(store: OpsStore, bolId: string, loadId: string, actorId: string, now: Date = new Date()): Bol {
  const bol = store.require<Bol>("bols", bolId);
  const load = store.load(loadId);
  if (load.bolId && load.bolId !== bol.id) throw new Error(`load ${load.loadNumber} already has a BOL`);
  const updated: Bol = { ...bol, loadId: load.id, matchStatus: "matched" };
  store.save("bols", updated);
  attachBol(store, load, updated, actorId, now);
  store.audit(actorId, "bol.matchedManually", "bol", bol.id, `${bol.bolNumber} → ${load.loadNumber}`);
  recomputeAll(store, now);
  return updated;
}

/** Module E: pull the supplier feed (sample file) and ingest every BOL in it. */
export function pullBolFeed(store: OpsStore, now: Date = new Date()): { run: IntegrationRun; results: IngestResult[] } {
  const startedAt = now.toISOString();
  const file = loadSample<{ bols: SampleBol[] }>("bol-feed.json", now);
  const suppliers = store.all<Supplier>("suppliers");
  const terminals = store.all<Terminal>("terminals");
  const carriers = store.all<Carrier>("carriers");
  const products = store.all<Product>("products");
  const results: IngestResult[] = [];
  for (const sb of file.bols) {
    const supplier = suppliers.find((s) => s.code === sb.supplierCode);
    const terminal = terminals.find((t) => t.code === sb.terminalCode);
    const carrier = carriers.find((c) => c.code === sb.carrierCode);
    if (!supplier || !terminal || !carrier) continue;
    const input: BolInput = {
      bolNumber: sb.bolNumber,
      supplierId: supplier.id,
      terminalId: terminal.id,
      carrierId: carrier.id,
      liftedAt: sb.liftedAt,
      destinationText: sb.destinationText,
      customerRef: sb.customerRef,
      source: "feed",
      lines: sb.lines.flatMap((l) => {
        const product = products.find((p) => p.code === l.productCode);
        if (!product) return [];
        return [{
          productId: product.id,
          grossGallons: l.grossGallons,
          netGallons: l.netGallons,
          supplierCostPerGallon: typeof l.supplierCostPerGallon === "number" ? l.supplierCostPerGallon : undefined,
          taxesPerGallon: l.taxesPerGallon,
          feesPerGallon: l.feesPerGallon,
        }];
      }),
    };
    results.push(ingestBol(store, input, "system", now));
  }
  const matched = results.filter((r) => r.outcome === "matched").length;
  const unmatched = results.filter((r) => r.outcome === "unmatched").length;
  const dup = results.filter((r) => r.outcome === "duplicate").length;
  const run: IntegrationRun = {
    id: store.nextId("integrationRuns", "run-"),
    kind: "bol_feed",
    startedAt,
    finishedAt: new Date().toISOString(),
    status: unmatched ? "partial" : "success",
    recordsIn: file.bols.length,
    recordsOut: results.length,
    summary: `${results.length} BOL(s) received: ${matched} matched, ${unmatched} unmatched, ${dup} duplicate`,
  };
  store.save("integrationRuns", run);
  recomputeAll(store, now);
  return { run, results };
}
