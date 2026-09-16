import { z } from "zod";
import { tool } from "@strands-agents/sdk";
import type { JSONValue } from "@strands-agents/sdk";
import { ops } from "../domain/store.js";
import type { Invoice, InvoiceStatus } from "../domain/types.js";
import { approveInvoice, prepareInvoices, rejectInvoice, syncInvoicesToQuickBooks, syncPaymentsFromQuickBooks } from "../services/billing.js";
import { currentActor } from "../services/actor.js";

const invoiceView = (i: Invoice) => ({
  ...i,
  customerName: ops.customer(i.customerId).name,
  loadNumber: ops.load(i.loadId).loadNumber,
  gallons: i.lines.reduce((s, l) => s + l.billedGallons, 0),
  productName: ops.product(i.lines[0]?.productId ?? "p-ulsd").name,
});

export const listInvoicesTool = tool({
  name: "list_invoices",
  description: "List invoices with status, totals, customer, and load.",
  inputSchema: z.object({ status: z.enum(["draft", "pending_approval", "approved", "synced", "paid", "void"] as [InvoiceStatus, ...InvoiceStatus[]]).optional() }),
  callback: ({ status }) => ({ invoices: ops.all<Invoice>("invoices").filter((i) => !status || i.status === status).map(invoiceView) }) as unknown as JSONValue,
});

export const prepareInvoicesTool = tool({
  name: "prepare_invoices",
  description: "Build draft invoices for every load that has a BOL and is not yet invoiced (BOL gallons × the price rule at time of lift + freight, fees, taxes). Drafts wait for management approval; nothing is sent to QuickBooks.",
  inputSchema: z.object({ loadIds: z.array(z.string()).optional() }),
  callback: ({ loadIds }) => ({ invoices: prepareInvoices(ops, currentActor(), new Date(), loadIds).map(invoiceView) }) as unknown as JSONValue,
});

export const approveInvoiceTool = tool({
  name: "approve_invoice",
  description: "Approve an invoice (management gate). Call ONLY after confirm_invoice returned approved=true for that invoice.",
  inputSchema: z.object({ invoiceId: z.string() }),
  callback: ({ invoiceId }) => invoiceView(approveInvoice(ops, invoiceId, currentActor())) as unknown as JSONValue,
});

export const rejectInvoiceTool = tool({
  name: "reject_invoice",
  description: "Void a draft/pending/approved invoice with a reason; the load returns to pricing_verified for re-billing.",
  inputSchema: z.object({ invoiceId: z.string(), reason: z.string() }),
  callback: ({ invoiceId, reason }) => invoiceView(rejectInvoice(ops, invoiceId, currentActor(), reason)) as unknown as JSONValue,
});

export const syncQuickBooksTool = tool({
  name: "sync_quickbooks",
  description: "Push approved invoices to QuickBooks and pull payments (mock QuickBooks backed by sample data in this MVP). Returns what was created and which invoices were paid.",
  inputSchema: z.object({}),
  callback: () => {
    const inv = syncInvoicesToQuickBooks(ops);
    const pay = syncPaymentsFromQuickBooks(ops);
    return {
      invoices: { summary: inv.run.summary, synced: inv.synced.map(invoiceView) },
      payments: { summary: pay.run.summary, applied: pay.applied.map((p) => ({ ...p, invoiceNumber: ops.require<Invoice>("invoices", p.invoiceId).invoiceNumber })) },
    } as unknown as JSONValue;
  },
});
