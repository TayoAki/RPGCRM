import type { OpsStore } from "../domain/store.js";
import { attachmentBytes, extractAttachment, rowToLabeledText } from "../intake/attachments.js";
import type { AttachmentInput } from "../intake/attachments.js";
import type {
  Contact,
  Customer,
  DeliveryLocation,
  EmailIntake,
  IntegrationRun,
  Order,
  OrderStatus,
  OrderStatusEvent,
  ParsedOrder,
  Product,
  IntakeAttachment,
} from "../domain/types.js";
import { ORDER_STATUSES } from "../domain/types.js";
import { mergeParsed, overallConfidence, parseOrderEmail } from "../intake/parser.js";
import { loadSample, resolveTokens } from "../samples/loader.js";
import { quotePrice } from "./pricing.js";
import { recomputeExceptions, SYSTEM_ACTOR } from "./context.js";

interface SampleEmail {
  attachments?: AttachmentInput[];
  messageId: string;
  receivedAtOffsetHours: number;
  from: string;
  subject: string;
  body: string;
}

/** Module H: pull the inbox (sample file), parse each email, queue for review. */
export async function runEmailIntake(store: OpsStore, now: Date = new Date()): Promise<{ run: IntegrationRun; queued: EmailIntake[]; skipped: number }> {
  const startedAt = now.toISOString();
  const file = loadSample<{ emails: SampleEmail[] }>("emails.json", now);
  const existing = new Set(store.all<EmailIntake>("emailIntakes").map((e) => e.messageId));
  const ref = {
    customers: store.all<Customer>("customers"),
    deliveryLocations: store.all<DeliveryLocation>("deliveryLocations"),
    products: store.all<Product>("products"),
    contacts: store.all<Contact>("contacts"),
  };
  const queued: EmailIntake[] = [];
  let skipped = 0;
  let emailsParsed = 0;
  let fromAttachments = 0;
  for (const em of file.emails) {
    if (existing.has(em.messageId)) {
      skipped++;
      continue;
    }
    const bodyDraft = parseOrderEmail(em, ref, now);
    // Attachments: spreadsheets give one draft per row, documents one draft; the body fills gaps.
    const attachments: IntakeAttachment[] = [];
    const attachmentDrafts: ParsedOrder[] = [];
    for (const att of em.attachments ?? []) {
      const meta: IntakeAttachment = { filename: att.filename, contentType: att.contentType, bytes: 0, status: "unsupported", drafts: 0 };
      try {
        meta.bytes = attachmentBytes(att)?.length ?? 0;
        const extracted = await extractAttachment(att);
        if (extracted.kind === "text") {
          const draft = parseOrderEmail({ from: em.from, subject: em.subject, body: resolveTokens(extracted.text, now) }, ref, now);
          draft.source = { attachment: att.filename };
          attachmentDrafts.push(draft);
          meta.status = "parsed";
          meta.drafts = 1;
        } else if (extracted.kind === "rows") {
          extracted.rows.forEach((row, i) => {
            const body = resolveTokens(rowToLabeledText(row), now);
            if (!body.trim()) return;
            const draft = parseOrderEmail({ from: em.from, subject: "", body }, ref, now);
            draft.source = { attachment: att.filename, row: i + 2 };
            attachmentDrafts.push(draft);
            meta.drafts += 1;
          });
          meta.status = "parsed";
          if (meta.drafts === 0) meta.note = "no order rows found";
        } else {
          meta.note = extracted.reason;
        }
      } catch (e) {
        meta.status = "error";
        meta.note = (e as Error).message;
      }
      attachments.push(meta);
    }
    const drafts = attachmentDrafts.length ? attachmentDrafts.map((d) => mergeParsed(d, bodyDraft)) : [bodyDraft];
    for (const parsed of drafts) {
      const intake: EmailIntake = {
        id: store.nextId("emailIntakes", "ei-"),
        messageId: em.messageId,
        receivedAt: new Date(now.getTime() + em.receivedAtOffsetHours * 3_600_000).toISOString(),
        from: em.from,
        subject: em.subject,
        body: em.body,
        attachments: attachments.length ? attachments : undefined,
        parsed,
        confidence: overallConfidence(parsed),
        issues: intakeIssues(store, parsed, queued),
        reviewStatus: "pending",
      };
      store.save("emailIntakes", intake);
      queued.push(intake);
      if (parsed.source) fromAttachments += 1;
    }
    emailsParsed += 1;
    existing.add(em.messageId);
  }
  const run: IntegrationRun = {
    id: store.nextId("integrationRuns", "run-"),
    kind: "email_intake",
    startedAt,
    finishedAt: new Date().toISOString(),
    status: "success",
    recordsIn: file.emails.length,
    recordsOut: queued.length,
    summary: `${queued.length} draft order(s) queued from ${emailsParsed} email(s)${fromAttachments ? ` (${fromAttachments} from attachments)` : ""}, ${skipped} already seen`,
  };
  store.save("integrationRuns", run);
  return { run, queued, skipped };
}

export function intakeIssues(store: OpsStore, parsed: ParsedOrder, pendingInBatch: EmailIntake[] = []): string[] {
  const issues: string[] = [];
  if (!parsed.customerId) issues.push(parsed.customerName ? `Customer "${parsed.customerName}" not found` : "No customer matched");
  if (!parsed.deliveryLocationId) issues.push("Delivery location not matched");
  if (!parsed.productId) issues.push("Product not recognized");
  if (!parsed.gallons) issues.push("No gallons found");
  if (!parsed.requestedDate) issues.push("No requested date found");
  if (parsed.customerId) {
    const customer = store.find<Customer>("customers", parsed.customerId);
    if (customer?.status === "on_hold") issues.push(`${customer.name} is on credit hold`);
  }
  if (parsed.customerPo && parsed.customerId) {
    const dupOrder = store.all<Order>("orders").find((o) => o.customerId === parsed.customerId && o.customerPo === parsed.customerPo);
    const dupPending = [...store.all<EmailIntake>("emailIntakes"), ...pendingInBatch].find(
      (e) => e.reviewStatus === "pending" && e.parsed.customerId === parsed.customerId && e.parsed.customerPo === parsed.customerPo,
    );
    if (dupOrder) issues.push(`PO ${parsed.customerPo} already exists as ${dupOrder.orderNumber}`);
    else if (dupPending) issues.push(`PO ${parsed.customerPo} is already in the review queue`);
  }
  return issues;
}

export interface CreateOrderInput {
  customerId: string;
  deliveryLocationId: string;
  productId: string;
  requestedGallons: number;
  requestedDate: string;
  requestedWindow?: string;
  customerPo?: string;
  specialInstructions?: string;
  source: Order["source"];
  emailIntakeId?: string;
}

export function createOrder(store: OpsStore, input: CreateOrderInput, actorId: string, now: Date = new Date()): Order {
  const customer = store.customer(input.customerId);
  const location = store.location(input.deliveryLocationId);
  if (location.customerId !== customer.id) throw new Error("delivery location does not belong to the customer");
  store.product(input.productId);
  if (!(input.requestedGallons > 0)) throw new Error("requestedGallons must be positive");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.requestedDate)) throw new Error("requestedDate must be yyyy-mm-dd");
  const seq = store.nextId("orders", "o-");
  const n = seq.slice(2);
  const order: Order = {
    id: seq,
    orderNumber: `ORD-${n}`,
    customerId: customer.id,
    deliveryLocationId: location.id,
    productId: input.productId,
    requestedGallons: input.requestedGallons,
    requestedDate: input.requestedDate,
    requestedWindow: input.requestedWindow,
    customerPo: input.customerPo,
    specialInstructions: input.specialInstructions,
    source: input.source,
    emailIntakeId: input.emailIntakeId,
    status: "received",
    creditHold: customer.status === "on_hold",
    createdAt: now.toISOString(),
  };
  store.save("orders", order);
  appendOrderEvent(store, order, null, "received", actorId, now);
  quotePrice(store, { customerId: order.customerId, productId: order.productId, deliveryLocationId: order.deliveryLocationId, date: order.requestedDate }, actorId);
  store.audit(actorId, "order.created", "order", order.id, `${order.orderNumber} ${order.requestedGallons} gal ${order.productId} for ${customer.name}`);
  recomputeExceptions(store, now);
  return order;
}

export function reviewIntake(
  store: OpsStore,
  intakeId: string,
  decision: "approve" | "reject",
  actorId: string,
  edits: Partial<ParsedOrder> = {},
  now: Date = new Date(),
): EmailIntake {
  const intake = store.require<EmailIntake>("emailIntakes", intakeId);
  if (intake.reviewStatus !== "pending") throw new Error(`intake ${intakeId} already ${intake.reviewStatus}`);
  const parsed: ParsedOrder = { ...intake.parsed, ...edits, fieldConfidence: intake.parsed.fieldConfidence };
  if (decision === "reject") {
    const updated: EmailIntake = { ...intake, parsed, reviewStatus: "rejected", reviewedBy: actorId, reviewedAt: now.toISOString() };
    store.save("emailIntakes", updated);
    store.audit(actorId, "intake.rejected", "emailIntake", intake.id, intake.subject);
    return updated;
  }
  if (!parsed.customerId || !parsed.deliveryLocationId || !parsed.productId || !parsed.gallons || !parsed.requestedDate)
    throw new Error("cannot approve: customer, location, product, gallons, and date are required");
  const order = createOrder(
    store,
    {
      customerId: parsed.customerId,
      deliveryLocationId: parsed.deliveryLocationId,
      productId: parsed.productId,
      requestedGallons: parsed.gallons,
      requestedDate: parsed.requestedDate,
      customerPo: parsed.customerPo,
      specialInstructions: parsed.specialInstructions,
      source: "email",
      emailIntakeId: intake.id,
    },
    actorId,
    now,
  );
  const updated: EmailIntake = { ...intake, parsed, reviewStatus: "approved", reviewedBy: actorId, reviewedAt: now.toISOString(), orderId: order.id, issues: [] };
  store.save("emailIntakes", updated);
  store.audit(actorId, "intake.approved", "emailIntake", intake.id, `→ ${order.orderNumber}`);
  return updated;
}

const ORDER_FLOW: Record<OrderStatus, OrderStatus[]> = {
  received: ["confirmed", "cancelled"],
  confirmed: ["carrier_confirmed", "cancelled"],
  carrier_confirmed: ["in_transit", "cancelled"],
  in_transit: ["delivered"],
  delivered: [],
  cancelled: [],
};

export function setOrderStatus(store: OpsStore, orderId: string, to: OrderStatus, actorId: string, note?: string, now: Date = new Date()): Order {
  const order = store.order(orderId);
  if (!ORDER_STATUSES.includes(to)) throw new Error(`invalid status ${to}`);
  if (order.status === to) return order;
  if (!ORDER_FLOW[order.status].includes(to)) throw new Error(`cannot move order from ${order.status} to ${to}`);
  if (to === "confirmed" && (order.creditHold || store.customer(order.customerId).status === "on_hold"))
    throw new Error(`order ${order.orderNumber} is on credit hold; release the hold first`);
  const updated: Order = { ...order, status: to };
  store.save("orders", updated);
  appendOrderEvent(store, updated, order.status, to, actorId, now, note);
  store.audit(actorId, "order.status", "order", order.id, `${order.status} → ${to}`);
  recomputeExceptions(store, now);
  return updated;
}

export function releaseCreditHold(store: OpsStore, orderId: string, actorId: string, now: Date = new Date()): Order {
  const order = store.order(orderId);
  const updated: Order = { ...order, creditHold: false };
  store.save("orders", updated);
  store.audit(actorId, "order.creditHoldReleased", "order", order.id, order.orderNumber);
  recomputeExceptions(store, now);
  return updated;
}

export function appendOrderEvent(store: OpsStore, order: Order, from: OrderStatus | null, to: OrderStatus, actorId: string, now: Date, note?: string): OrderStatusEvent {
  const ev: OrderStatusEvent = { id: store.nextId("orderEvents", "oe-"), orderId: order.id, from, to, occurredAt: now.toISOString(), actorId, note };
  return store.save("orderEvents", ev);
}

export { SYSTEM_ACTOR };
