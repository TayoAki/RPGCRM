import { z } from "zod";
import { tool } from "@strands-agents/sdk";
import type { JSONValue } from "@strands-agents/sdk";
import { ops } from "../domain/store.js";
import type { Bol, EmailIntake, Load, LoadStatus, Order, OrderStatus } from "../domain/types.js";
import { ORDER_STATUSES, LOAD_STATUSES, BILLING_STATUSES } from "../domain/types.js";
import { createOrder, releaseCreditHold, reviewIntake, runEmailIntake, setOrderStatus } from "../services/orders.js";
import { createLoadForOrder, matchBolToLoad, pullBolFeed, recordDelivery, setBillingStatus, setLoadStatus } from "../services/loads.js";
import { currentActor } from "../services/actor.js";
import { resolveCarrier, resolveCustomer, resolveLocation, resolveProduct, resolveSupplier, resolveTerminal } from "./resolve.js";

const orderView = (o: Order) => ({
  ...o,
  customerName: ops.customer(o.customerId).name,
  productName: ops.product(o.productId).name,
  locationName: ops.location(o.deliveryLocationId).name,
  loadNumber: ops.all<Load>("loads").find((l) => l.orderIds.includes(o.id))?.loadNumber ?? null,
});

const loadView = (l: Load) => ({
  ...l,
  customerName: ops.customer(l.customerId).name,
  productName: ops.product(l.productId).name,
  terminalName: ops.terminal(l.terminalId).name,
  carrierName: ops.require<{ id: string; name: string }>("carriers", l.carrierId).name,
  bolNumber: l.bolId ? ops.require<Bol>("bols", l.bolId).bolNumber : null,
});

const intakeView = (e: EmailIntake) => ({
  id: e.id,
  from: e.from,
  subject: e.subject,
  receivedAt: e.receivedAt,
  confidence: e.confidence,
  issues: e.issues,
  reviewStatus: e.reviewStatus,
  parsed: e.parsed,
  orderId: e.orderId ?? null,
});

// ---- Orders and intake (Modules G, H) ----------------------------------------

export const runEmailIntakeTool = tool({
  name: "run_email_intake",
  description: "Pull the order inbox (sample data in this MVP), parse each email into a draft order, and queue it for human review. Returns what was queued with confidence and issues. Nothing becomes an order until someone approves it.",
  inputSchema: z.object({}),
  callback: () => {
    const r = runEmailIntake(ops);
    return { summary: r.run.summary, skipped: r.skipped, queued: r.queued.map(intakeView) } as unknown as JSONValue;
  },
});

export const listIntakeQueueTool = tool({
  name: "list_intake_queue",
  description: "List order emails awaiting review (parsed fields, confidence, issues).",
  inputSchema: z.object({}),
  callback: () => ({ pending: ops.all<EmailIntake>("emailIntakes").filter((e) => e.reviewStatus === "pending").map(intakeView) }) as unknown as JSONValue,
});

export const reviewIntakeTool = tool({
  name: "review_intake",
  description: "Approve (creating the order) or reject a queued order email. Call ONLY after confirm_intake returned approved=true for that intake; pass along any edits the reviewer made.",
  inputSchema: z.object({
    intakeId: z.string(),
    decision: z.enum(["approve", "reject"]),
    edits: z
      .object({
        customerId: z.string().optional(),
        deliveryLocationId: z.string().optional(),
        productId: z.string().optional(),
        gallons: z.number().optional(),
        requestedDate: z.string().optional(),
        customerPo: z.string().optional(),
        specialInstructions: z.string().optional(),
      })
      .optional(),
  }),
  callback: ({ intakeId, decision, edits }) => {
    const r = reviewIntake(ops, intakeId, decision, currentActor(), edits ?? {});
    return { ...intakeView(r), order: r.orderId ? orderView(ops.order(r.orderId)) : null } as unknown as JSONValue;
  },
});

export const listOrdersTool = tool({
  name: "list_orders",
  description: "List orders, optionally filtered by status and/or customer.",
  inputSchema: z.object({ status: z.enum(ORDER_STATUSES as [OrderStatus, ...OrderStatus[]]).optional(), customer: z.string().optional() }),
  callback: ({ status, customer }) => {
    const c = customer ? resolveCustomer(customer) : undefined;
    return {
      orders: ops
        .all<Order>("orders")
        .filter((o) => (!status || o.status === status) && (!c || o.customerId === c.id))
        .sort((a, b) => b.requestedDate.localeCompare(a.requestedDate))
        .map(orderView),
    } as unknown as JSONValue;
  },
});

export const createOrderTool = tool({
  name: "create_order",
  description: "Create an order (manual or portal entry). Call ONLY after confirm_order returned approved=true with these exact values.",
  inputSchema: z.object({
    customer: z.string(),
    location: z.string().optional().describe("Delivery location name; required if the customer has more than one"),
    product: z.string(),
    gallons: z.number().positive(),
    requestedDate: z.string().describe("yyyy-mm-dd"),
    customerPo: z.string().optional(),
    specialInstructions: z.string().optional(),
  }),
  callback: ({ customer, location, product, gallons, requestedDate, customerPo, specialInstructions }) => {
    const c = resolveCustomer(customer);
    const l = resolveLocation(c, location);
    const p = resolveProduct(product);
    const o = createOrder(ops, { customerId: c.id, deliveryLocationId: l.id, productId: p.id, requestedGallons: gallons, requestedDate, customerPo, specialInstructions, source: "manual" }, currentActor());
    return orderView(o) as unknown as JSONValue;
  },
});

export const updateOrderStatusTool = tool({
  name: "update_order_status",
  description: "Move an order to the next milestone (received → confirmed → carrier_confirmed → in_transit → delivered) or cancel it. Loads move their orders automatically; use this for manual milestone updates.",
  inputSchema: z.object({ orderId: z.string(), status: z.enum(ORDER_STATUSES as [OrderStatus, ...OrderStatus[]]), note: z.string().optional() }),
  callback: ({ orderId, status, note }) => orderView(setOrderStatus(ops, orderId, status, currentActor(), note)) as unknown as JSONValue,
});

export const releaseCreditHoldTool = tool({
  name: "release_credit_hold",
  description: "Release the credit hold on an order so it can be confirmed and dispatched. Billing/management decision; confirm with the user first.",
  inputSchema: z.object({ orderId: z.string() }),
  callback: ({ orderId }) => orderView(releaseCreditHold(ops, orderId, currentActor())) as unknown as JSONValue,
});

// ---- Loads and BOLs (Modules E, F) ---------------------------------------------

export const listLoadsTool = tool({
  name: "list_loads",
  description: "List loads with their operational status, billing status, carrier, terminal, and BOL.",
  inputSchema: z.object({ status: z.enum(LOAD_STATUSES as [LoadStatus, ...LoadStatus[]]).optional(), awaitingBilling: z.boolean().optional() }),
  callback: ({ status, awaitingBilling }) =>
    ({
      loads: ops
        .all<Load>("loads")
        .filter((l) => (!status || l.status === status) && (!awaitingBilling || (l.billingStatus && !["invoiced", "paid"].includes(l.billingStatus))))
        .sort((a, b) => b.scheduledPickupAt.localeCompare(a.scheduledPickupAt))
        .map(loadView),
    }) as unknown as JSONValue,
});

export const createLoadTool = tool({
  name: "create_load",
  description: "Dispatch an order: create a load with carrier, terminal, supplier, and scheduled pickup/delivery times (ISO). Refuses orders on credit hold.",
  inputSchema: z.object({
    orderId: z.string(),
    carrier: z.string(),
    terminal: z.string(),
    supplier: z.string(),
    scheduledPickupAt: z.string(),
    scheduledDeliveryAt: z.string(),
    driverName: z.string().optional(),
  }),
  callback: ({ orderId, carrier, terminal, supplier, scheduledPickupAt, scheduledDeliveryAt, driverName }) => {
    const l = createLoadForOrder(
      ops,
      { orderId, carrierId: resolveCarrier(carrier).id, terminalId: resolveTerminal(terminal).id, supplierId: resolveSupplier(supplier).id, scheduledPickupAt, scheduledDeliveryAt, driverName },
      currentActor(),
    );
    return loadView(l) as unknown as JSONValue;
  },
});

export const updateLoadStatusTool = tool({
  name: "update_load_status",
  description: "Move a load: planned → dispatched → loading → in_transit → delivered → closed. Orders follow automatically.",
  inputSchema: z.object({ loadId: z.string(), status: z.enum(LOAD_STATUSES as [LoadStatus, ...LoadStatus[]]), note: z.string().optional() }),
  callback: ({ loadId, status, note }) => loadView(setLoadStatus(ops, loadId, status, currentActor(), note)) as unknown as JSONValue,
});

export const recordDeliveryTool = tool({
  name: "record_delivery",
  description: "Record proof of delivery for a load (delivered gallons, receiver, ticket number). Marks the load and order delivered.",
  inputSchema: z.object({ loadId: z.string(), deliveredGallons: z.number().positive(), receiverName: z.string(), ticketNumber: z.string() }),
  callback: ({ loadId, deliveredGallons, receiverName, ticketNumber }) => recordDelivery(ops, loadId, { deliveredGallons, receiverName, ticketNumber }, currentActor()) as unknown as JSONValue,
});

export const setBillingStatusTool = tool({
  name: "set_billing_status",
  description: "Move a load along the billing workflow: bol_received → pricing_verified → ready_to_invoice (invoiced/paid are set by the invoicing tools).",
  inputSchema: z.object({ loadId: z.string(), status: z.enum(BILLING_STATUSES as [string, ...string[]]) }),
  callback: ({ loadId, status }) => loadView(setBillingStatus(ops, loadId, status as never, currentActor())) as unknown as JSONValue,
});

export const pullBolFeedTool = tool({
  name: "pull_bol_feed",
  description: "Pull electronic BOLs from suppliers/terminals (sample feed in this MVP), deduplicate them, match each to a load, and start the billing workflow for matched loads. Returns per-BOL outcomes.",
  inputSchema: z.object({}),
  callback: () => {
    const r = pullBolFeed(ops);
    return {
      summary: r.run.summary,
      results: r.results.map((x) => ({
        bolId: x.bol.id,
        bolNumber: x.bol.bolNumber,
        outcome: x.outcome,
        loadNumber: x.load?.loadNumber ?? null,
        customerRef: x.bol.customerRef,
        destinationText: x.bol.destinationText,
        gallons: x.bol.lines.reduce((s, l) => s + l.netGallons, 0),
        product: ops.product(x.bol.lines[0]?.productId ?? "p-ulsd").name,
      })),
    } as unknown as JSONValue;
  },
});

export const matchBolTool = tool({
  name: "match_bol",
  description: "Manually attach an unmatched BOL to a load.",
  inputSchema: z.object({ bolId: z.string(), loadId: z.string() }),
  callback: ({ bolId, loadId }) => matchBolToLoad(ops, bolId, loadId, currentActor()) as unknown as JSONValue,
});

export const listBolsTool = tool({
  name: "list_bols",
  description: "List bills of lading with match status and the load they belong to.",
  inputSchema: z.object({ unmatchedOnly: z.boolean().optional() }),
  callback: ({ unmatchedOnly }) =>
    ({
      bols: ops
        .all<Bol>("bols")
        .filter((b) => !unmatchedOnly || b.matchStatus === "unmatched")
        .map((b) => ({ ...b, loadNumber: b.loadId ? ops.load(b.loadId).loadNumber : null, supplierName: ops.require<{ id: string; name: string }>("suppliers", b.supplierId).name, terminalName: ops.terminal(b.terminalId).name })),
    }) as unknown as JSONValue,
});
