import type {
  Bol,
  Customer,
  CustomerPrice,
  DeliveryLocation,
  Invoice,
  InvoiceLine,
  Load,
  Product,
  TaxRate,
} from "../domain/types.js";
import { round2, taxLinesFor } from "../pricing/taxes.js";

/**
 * Invoice builder (Module I). Pure: given the load, its BOL, the customer, and
 * the price snapshot that applies, produce a draft invoice. The product price
 * on the line is pre-tax (basis + differential); freight, fees, and each tax
 * component are shown separately so the customer can reconcile it and so
 * margin math can exclude pass-through taxes.
 */

export interface BuildInvoiceInput {
  id: string;
  invoiceNumber: string;
  load: Load;
  bol: Bol;
  customer: Customer;
  location: DeliveryLocation;
  products: Product[];
  price: CustomerPrice;
  taxRates: TaxRate[];
  now: Date;
}

export function buildInvoiceForLoad(input: BuildInvoiceInput): Invoice {
  const { load, bol, customer, location, price, taxRates, now } = input;
  const issueDate = now.toISOString().slice(0, 10);
  const due = new Date(now.getTime() + customer.paymentTermsDays * 86_400_000)
    .toISOString()
    .slice(0, 10);
  const exempt = customer.taxExempt || price.taxesPerGallon === 0;

  const lines: InvoiceLine[] = bol.lines.map((bl, i) => {
    const product = input.products.find((p) => p.id === bl.productId);
    const billedGallons = customer.billingBasis === "net" ? bl.netGallons : bl.grossGallons;
    const productPrice = round4(price.basisValue + price.differential);
    const freight = round2(price.freight * billedGallons);
    const fees = round2(price.fees * billedGallons);
    const taxes = exempt
      ? []
      : taxLinesFor(taxRates, location.state, product?.taxCategory ?? "clear_diesel", bol.liftedAt, billedGallons);
    const taxTotal = round2(taxes.reduce((s, t) => s + t.amount, 0));
    const lineTotal = round2(productPrice * billedGallons + freight + fees + taxTotal);
    return {
      id: `${input.id}-l${i + 1}`,
      bolId: bol.id,
      productId: bl.productId,
      billedGallons,
      basis: customer.billingBasis,
      pricePerGallon: productPrice,
      customerPriceId: price.id,
      freight,
      fees,
      taxes,
      lineTotal,
    };
  });

  const subtotal = round2(lines.reduce((s, l) => s + l.pricePerGallon * l.billedGallons, 0));
  const freightTotal = round2(lines.reduce((s, l) => s + l.freight, 0));
  const feesTotal = round2(lines.reduce((s, l) => s + l.fees, 0));
  const taxTotal = round2(lines.reduce((s, l) => s + l.taxes.reduce((a, t) => a + t.amount, 0), 0));
  const total = round2(subtotal + freightTotal + feesTotal + taxTotal);

  return {
    id: input.id,
    invoiceNumber: input.invoiceNumber,
    customerId: customer.id,
    loadId: load.id,
    status: "draft",
    issueDate,
    dueDate: due,
    lines,
    subtotal,
    taxTotal,
    freightTotal,
    feesTotal,
    total,
    createdAt: now.toISOString(),
  };
}

export function invoiceGallons(inv: Invoice): number {
  return inv.lines.reduce((s, l) => s + l.billedGallons, 0);
}

/** Revenue excluding pass-through taxes (what margin is measured on). */
export function invoiceNetRevenue(inv: Invoice): number {
  return round2(inv.subtotal + inv.freightTotal + inv.feesTotal);
}

const round4 = (n: number): number => Math.round(n * 10000) / 10000;
