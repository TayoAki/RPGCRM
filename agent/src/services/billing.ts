import type { OpsStore } from "../domain/store.js";
import type { Bol, IntegrationRun, Invoice, Load, Payment, Product, QbInvoice, TaxRate } from "../domain/types.js";
import { buildInvoiceForLoad } from "../billing/invoices.js";
import { createQuickBooksInvoice } from "../integrations/quickbooks/mock.js";
import type { SamplePayment } from "../integrations/quickbooks/mock.js";
import { loadSample } from "../samples/loader.js";
import { quotePrice } from "./pricing.js";
import { recomputeAll } from "./context.js";

/** Module I step 1: draft invoices for every load that has a BOL and is not yet invoiced. */
export function prepareInvoices(store: OpsStore, actorId: string, now: Date = new Date(), loadIds?: string[]): Invoice[] {
  const candidates = store
    .all<Load>("loads")
    .filter((l) => l.bolId && !l.invoiceId && l.billingStatus && ["bol_received", "pricing_verified", "ready_to_invoice"].includes(l.billingStatus))
    .filter((l) => !loadIds || loadIds.includes(l.id));
  const created: Invoice[] = [];
  for (const load of candidates) {
    const bol = store.require<Bol>("bols", load.bolId!);
    const customer = store.customer(load.customerId);
    const location = store.location(load.deliveryLocationId);
    const priced = quotePrice(store, { customerId: load.customerId, productId: load.productId, terminalId: load.terminalId, deliveryLocationId: load.deliveryLocationId, date: bol.liftedAt }, actorId);
    if (!priced.ok || !priced.snapshot) {
      store.audit(actorId, "invoice.skipped", "load", load.id, priced.ok ? "no snapshot" : priced.message);
      continue;
    }
    const id = store.nextId("invoices", "inv-");
    const invoice = buildInvoiceForLoad({
      id,
      invoiceNumber: `INV-${id.slice(4)}`,
      load,
      bol,
      customer,
      location,
      products: store.all<Product>("products"),
      price: priced.snapshot,
      taxRates: store.all<TaxRate>("taxRates"),
      now,
    });
    invoice.status = "pending_approval";
    store.save("invoices", invoice);
    store.save("loads", { ...load, invoiceId: invoice.id, billingStatus: "ready_to_invoice" });
    store.audit(actorId, "invoice.drafted", "invoice", invoice.id, `${invoice.invoiceNumber} $${invoice.total.toFixed(2)} for ${customer.name}`);
    created.push(invoice);
  }
  recomputeAll(store, now);
  return created;
}

/** Module I step 2: the hard gate. Management approval, recorded with the actor. */
export function approveInvoice(store: OpsStore, invoiceId: string, actorId: string, now: Date = new Date()): Invoice {
  const inv = store.require<Invoice>("invoices", invoiceId);
  if (inv.status !== "pending_approval" && inv.status !== "draft") throw new Error(`invoice ${inv.invoiceNumber} is ${inv.status}`);
  const actor = store.find<{ id: string; role: string }>("staff", actorId);
  if (actor && !["management", "admin"].includes(actor.role)) throw new Error(`${actor.id} (${actor.role}) may not approve invoices; management approval required`);
  const updated: Invoice = { ...inv, status: "approved", approvedBy: actorId, approvedAt: now.toISOString(), rejectionReason: undefined };
  store.save("invoices", updated);
  store.audit(actorId, "invoice.approved", "invoice", inv.id, `${inv.invoiceNumber} $${inv.total.toFixed(2)}`);
  recomputeAll(store, now);
  return updated;
}

export function rejectInvoice(store: OpsStore, invoiceId: string, actorId: string, reason: string, now: Date = new Date()): Invoice {
  const inv = store.require<Invoice>("invoices", invoiceId);
  if (!["pending_approval", "draft", "approved"].includes(inv.status)) throw new Error(`invoice ${inv.invoiceNumber} is ${inv.status}`);
  const updated: Invoice = { ...inv, status: "void", rejectionReason: reason };
  store.save("invoices", updated);
  const load = store.load(inv.loadId);
  store.save("loads", { ...load, invoiceId: undefined, billingStatus: "pricing_verified" });
  store.audit(actorId, "invoice.rejected", "invoice", inv.id, reason);
  recomputeAll(store, now);
  return updated;
}

/** Module I step 3: push approved invoices to QuickBooks (mock). */
export function syncInvoicesToQuickBooks(store: OpsStore, now: Date = new Date()): { run: IntegrationRun; synced: Invoice[]; responses: unknown[] } {
  const startedAt = now.toISOString();
  const approved = store.all<Invoice>("invoices").filter((i) => i.status === "approved");
  const synced: Invoice[] = [];
  const responses: unknown[] = [];
  let seq = store.all<QbInvoice>("qbInvoices").length;
  for (const inv of approved) {
    const customer = store.customer(inv.customerId);
    const { ledger, response } = createQuickBooksInvoice(inv, customer, (pid) => store.product(pid).name, ++seq, now);
    store.save("qbInvoices", ledger);
    const updated: Invoice = { ...inv, status: "synced", quickbooksInvoiceId: ledger.id, syncedAt: now.toISOString() };
    store.save("invoices", updated);
    const load = store.load(inv.loadId);
    store.save("loads", { ...load, billingStatus: "invoiced" });
    store.audit("system", "invoice.synced", "invoice", inv.id, `QuickBooks Id ${ledger.id}`);
    synced.push(updated);
    responses.push(response);
  }
  const run: IntegrationRun = {
    id: store.nextId("integrationRuns", "run-"),
    kind: "quickbooks_invoices",
    startedAt,
    finishedAt: new Date().toISOString(),
    status: "success",
    recordsIn: approved.length,
    recordsOut: synced.length,
    summary: synced.length ? `${synced.map((i) => i.invoiceNumber).join(", ")} created in QuickBooks` : "No approved invoices to sync",
  };
  store.save("integrationRuns", run);
  recomputeAll(store, now);
  return { run, synced, responses };
}

/** Module I step 4: pull payments (sample file) and close out paid invoices. */
export function syncPaymentsFromQuickBooks(store: OpsStore, now: Date = new Date()): { run: IntegrationRun; applied: Payment[] } {
  const startedAt = now.toISOString();
  const file = loadSample<{ payments: SamplePayment[] }>("quickbooks-payments.json", now);
  const applied: Payment[] = [];
  for (const p of file.payments) {
    const inv = store.all<Invoice>("invoices").find((i) => i.invoiceNumber === p.docNumber);
    if (!inv || inv.status !== "synced") continue;
    if (store.all<Payment>("payments").some((x) => x.quickbooksPaymentId === p.quickbooksPaymentId)) continue;
    const amount = p.amount === "full" ? inv.total : p.amount;
    const payment: Payment = {
      id: store.nextId("payments", "pay-"),
      invoiceId: inv.id,
      quickbooksPaymentId: p.quickbooksPaymentId,
      amount,
      receivedAt: p.receivedAt,
      method: p.method,
    };
    store.save("payments", payment);
    store.save("invoices", { ...inv, status: "paid" });
    const ledger = store.all<QbInvoice>("qbInvoices").find((q) => q.invoiceId === inv.id);
    if (ledger) store.save("qbInvoices", { ...ledger, balance: Math.max(0, ledger.balance - amount), status: "paid" });
    const load = store.load(inv.loadId);
    store.save("loads", { ...load, billingStatus: "paid" });
    store.audit("system", "payment.applied", "invoice", inv.id, `${p.quickbooksPaymentId} $${amount.toFixed(2)} ${p.method}`);
    applied.push(payment);
  }
  const run: IntegrationRun = {
    id: store.nextId("integrationRuns", "run-"),
    kind: "quickbooks_payments",
    startedAt,
    finishedAt: new Date().toISOString(),
    status: "success",
    recordsIn: file.payments.length,
    recordsOut: applied.length,
    summary: applied.length ? `${applied.length} payment(s) applied` : "No new payments matched open invoices",
  };
  store.save("integrationRuns", run);
  recomputeAll(store, now);
  return { run, applied };
}
