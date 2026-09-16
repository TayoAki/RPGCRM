import { describe, it, expect } from "vitest";
import { buildInvoiceForLoad, invoiceNetRevenue } from "../billing/invoices.js";
import { approveInvoice, prepareInvoices, rejectInvoice, syncInvoicesToQuickBooks, syncPaymentsFromQuickBooks } from "../services/billing.js";
import { pullBolFeed } from "../services/loads.js";
import { freshStore, NOW } from "./helpers.js";

describe("invoice builder", () => {
  it("bills gross gallons for gross-basis customers and no tax for exempt ones", () => {
    const store = freshStore();
    const load = store.load("l-504"); // Brazos County: gross basis, exempt, fixed $2.79
    const bol = store.require<any>("bols", load.bolId!);
    const price = store.all<any>("customerPrices").find((p) => p.customerId === "cust-bcr")!;
    const inv = buildInvoiceForLoad({ id: "inv-t", invoiceNumber: "INV-T", load, bol, customer: store.customer("cust-bcr"), location: store.location(load.deliveryLocationId), products: store.all("products") as never, price, taxRates: store.all("taxRates") as never, now: NOW });
    expect(inv.lines[0].billedGallons).toBe(bol.lines[0].grossGallons);
    expect(inv.lines[0].pricePerGallon).toBe(2.79);
    expect(inv.taxTotal).toBe(0);
    expect(inv.total).toBeCloseTo(inv.subtotal + inv.freightTotal + inv.feesTotal, 2);
    expect(inv.dueDate > inv.issueDate).toBe(true);
    expect(invoiceNetRevenue(inv)).toBe(inv.total);
  });
});

describe("billing workflow", () => {
  it("prepare → approve (management only) → sync → pay", async () => {
    const store = freshStore();
    await pullBolFeed(store, NOW);
    const drafts = prepareInvoices(store, "u-elena", NOW);
    expect(drafts.length).toBeGreaterThanOrEqual(3);
    expect(drafts.every((d) => d.status === "pending_approval")).toBe(true);
    expect(() => approveInvoice(store, drafts[0].id, "u-elena", NOW)).toThrow(/management approval/);
    const approved = approveInvoice(store, drafts[0].id, "u-dana", NOW);
    expect(approved.status).toBe("approved");
    const { synced } = syncInvoicesToQuickBooks(store, NOW);
    expect(synced.map((s) => s.id)).toContain(approved.id);
    expect(store.load(approved.loadId).billingStatus).toBe("invoiced");
    expect(store.all<any>("qbInvoices").some((q) => q.invoiceId === approved.id && q.status === "open")).toBe(true);
    const { applied } = syncPaymentsFromQuickBooks(store, NOW);
    expect(applied.map((p) => p.invoiceId).sort()).toEqual(["inv-1002", "inv-1003"]);
    expect(store.require<any>("invoices", "inv-1002").status).toBe("paid");
    expect(store.load("l-508").billingStatus).toBe("paid");
  });

  it("rejecting an invoice voids it and reopens the load for billing", () => {
    const store = freshStore();
    const rejected = rejectInvoice(store, "inv-1004", "u-dana", "Wrong differential", NOW);
    expect(rejected.status).toBe("void");
    expect(store.load("l-503").invoiceId).toBeUndefined();
    expect(store.load("l-503").billingStatus).toBe("pricing_verified");
  });
});
