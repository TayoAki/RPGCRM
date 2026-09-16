import { z } from "zod";
import { tool } from "@strands-agents/sdk";
import type { JSONValue } from "@strands-agents/sdk";
import { ops } from "../domain/store.js";
import type { CustomerPrice } from "../domain/types.js";
import { enterRackPrice, importRackFeed, priceBoard, quotePrice } from "../services/pricing.js";
import { currentActor } from "../services/actor.js";
import { resolveCustomer, resolveLocation, resolveProduct, resolveTerminal } from "./resolve.js";

const today = () => new Date().toISOString().slice(0, 10);

/** Result shape rendered by the PriceQuoteCard. */
export const quotePriceTool = tool({
  name: "quote_price",
  description:
    "Price a product for a customer using the pricing rules (rack/index/fixed basis + differential + freight + fees + taxes). Pass the customer and product as the user said them; terminal and delivery location are optional. Returns the per-gallon price with a line-by-line explanation and, when gallons are given, the estimated total. Read-only; the snapshot is saved for audit.",
  inputSchema: z.object({
    customer: z.string().describe("Customer name, code, or id"),
    product: z.string().describe('Product name or code, e.g. "ULSD", "dyed diesel", "87"'),
    terminal: z.string().optional().describe("Terminal name or code (optional; cheapest rack is used otherwise)"),
    location: z.string().optional().describe("Delivery location name (optional; affects tax jurisdiction)"),
    gallons: z.number().positive().optional(),
    date: z.string().optional().describe("yyyy-mm-dd; defaults to today"),
  }),
  callback: ({ customer, product, terminal, location, gallons, date }) => {
    const c = resolveCustomer(customer);
    const p = resolveProduct(product);
    const t = terminal ? resolveTerminal(terminal) : undefined;
    const l = location ? resolveLocation(c, location) : undefined;
    const r = quotePrice(ops, { customerId: c.id, productId: p.id, terminalId: t?.id, deliveryLocationId: l?.id, date: date ?? today() }, currentActor());
    if (!r.ok) return { ok: false, reason: r.reason, message: r.message, customerName: c.name, productName: p.name } as unknown as JSONValue;
    const snap = r.snapshot!;
    return {
      ok: true,
      customerPriceId: snap.id,
      customerName: c.name,
      productName: p.name,
      terminalName: ops.terminal(snap.terminalId).name,
      locationName: l?.name ?? null,
      priceDate: snap.priceDate,
      ruleName: r.rule.name,
      basisType: snap.basisType,
      basisValue: snap.basisValue,
      differential: snap.differential,
      freight: snap.freight,
      fees: snap.fees,
      taxesPerGallon: snap.taxesPerGallon,
      sellPricePerGallon: snap.sellPricePerGallon,
      gallons: gallons ?? null,
      estimatedTotal: gallons ? Math.round(gallons * snap.sellPricePerGallon * 100) / 100 : null,
      explanation: snap.explanation,
    } as unknown as JSONValue;
  },
});

export const explainPriceTool = tool({
  name: "explain_price",
  description: "Explain a previously computed customer price snapshot (by customerPriceId) line by line.",
  inputSchema: z.object({ customerPriceId: z.string() }),
  callback: ({ customerPriceId }) => {
    const cp = ops.require<CustomerPrice>("customerPrices", customerPriceId);
    return { ...cp, customerName: ops.customer(cp.customerId).name, productName: ops.product(cp.productId).name } as unknown as JSONValue;
  },
});

export const priceBoardTool = tool({
  name: "price_board",
  description: "Today's auto-calculated selling price for every customer/product pair that has a pricing rule (Module A dashboard). Optionally filter by customer.",
  inputSchema: z.object({ customer: z.string().optional(), date: z.string().optional() }),
  callback: ({ customer, date }) => {
    const rows = priceBoard(ops, date ?? today());
    const c = customer ? resolveCustomer(customer) : undefined;
    return { date: date ?? today(), rows: c ? rows.filter((r) => r.customerId === c.id) : rows } as unknown as JSONValue;
  },
});

export const enterRackPriceTool = tool({
  name: "enter_rack_price",
  description: "Record a supplier rack (base) price for a product at a terminal. Only after the user has explicitly given the number; never invent a price.",
  inputSchema: z.object({
    terminal: z.string(),
    supplier: z.string().describe("Supplier name or code"),
    product: z.string(),
    pricePerGallon: z.number().positive(),
  }),
  callback: ({ terminal, supplier, product, pricePerGallon }) => {
    const t = resolveTerminal(terminal);
    const p = resolveProduct(product);
    const s = ops.all<{ id: string; code: string; name: string }>("suppliers").find((x) => x.code.toLowerCase() === supplier.toLowerCase() || x.name.toLowerCase().includes(supplier.toLowerCase()));
    if (!s) throw new Error(`Supplier not found: ${supplier}`);
    return enterRackPrice(ops, { terminalId: t.id, supplierId: s.id, productId: p.id, pricePerGallon }, currentActor()) as unknown as JSONValue;
  },
});

/** Rendered as a result card. */
export const importRackPricesTool = tool({
  name: "import_rack_prices",
  description: "Import today's supplier rack (base price) postings from the rack feed (a sample file in this MVP; a DTN or supplier price feed in production). Use for 'import racks', 'refresh rack prices', 'pull today's rack postings'. Safe to repeat: postings already imported are skipped.",
  inputSchema: z.object({}),
  callback: () => {
    const r = importRackFeed(ops, currentActor());
    return {
      summary: r.run.summary,
      imported: r.imported.map((x) => ({ supplier: x.supplierCode, terminal: x.terminalCode, product: x.productCode, pricePerGallon: x.pricePerGallon, previous: x.previous, change: x.change })),
      skipped: r.skipped,
    } as unknown as JSONValue;
  },
});
