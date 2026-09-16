import type {
  Contact,
  Customer,
  DeliveryLocation,
  ParsedOrder,
  Product,
} from "../domain/types.js";
import { guessProduct, tokenOverlap } from "../domain/store.js";

/**
 * Order email parser (Module H). Labeled lines ("Gallons: 7,500") are taken
 * verbatim with high confidence; free-form emails fall back to pattern
 * matching with lower confidence. Names are matched against reference data
 * (customers, delivery locations, products) so the review queue can show a
 * resolved order rather than raw text. Everything lands in the review queue;
 * nothing becomes an order without a human approving it.
 */

export interface ParserRefData {
  customers: Customer[];
  deliveryLocations: DeliveryLocation[];
  products: Product[];
  contacts: Contact[];
}

export interface InboundEmail {
  from: string;
  subject: string;
  body: string;
}

const LABELS: Record<string, string[]> = {
  customer: ["customer", "account", "company"],
  location: ["location", "site", "deliver to", "delivery location", "ship to", "destination"],
  product: ["product", "fuel", "grade"],
  gallons: ["gallons", "gal", "qty", "quantity", "volume"],
  date: ["requested date", "delivery date", "date", "needed by", "deliver on", "when"],
  po: ["po", "po #", "po#", "p.o.", "purchase order", "reference", "ref"],
  notes: ["notes", "note", "instructions", "special instructions", "comments"],
};

function labeledFields(body: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const raw of body.split(/\r?\n/)) {
    const line = raw.trim();
    const m = line.match(/^([A-Za-z .#]{2,24}?)\s*[:\-]\s*(.+)$/);
    if (!m) continue;
    const label = m[1].trim().toLowerCase();
    const value = m[2].trim();
    for (const [field, names] of Object.entries(LABELS)) {
      if (names.includes(label) && !(field in out)) out[field] = value;
    }
  }
  return out;
}

export function parseGallons(text: string): number | undefined {
  const m = text.match(/(\d{1,3}(?:,\d{3})+|\d{3,6})(?:\s*(?:gal|gallons|gals))?/i);
  if (!m) return undefined;
  const n = parseInt(m[1].replace(/,/g, ""), 10);
  return Number.isFinite(n) && n > 0 ? n : undefined;
}

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];

/** ISO date from "2026-09-18", "9/18/2026", "Sept 18", or "September 18, 2026". */
export function parseDate(text: string, now: Date): string | undefined {
  const iso = text.match(/(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  const us = text.match(/\b(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?\b/);
  if (us) {
    const y = us[3] ? (us[3].length === 2 ? 2000 + Number(us[3]) : Number(us[3])) : now.getUTCFullYear();
    return `${y}-${pad(Number(us[1]))}-${pad(Number(us[2]))}`;
  }
  const named = text.match(
    /\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+(\d{1,2})(?:st|nd|rd|th)?(?:,?\s+(\d{4}))?/i,
  );
  if (named) {
    const month = MONTHS.indexOf(named[1].toLowerCase().slice(0, 3)) + 1;
    const y = named[3] ? Number(named[3]) : now.getUTCFullYear();
    return `${y}-${pad(month)}-${pad(Number(named[2]))}`;
  }
  return undefined;
}

export function parsePo(text: string): string | undefined {
  const m = text.match(/\b(?:PO|P\.O\.|purchase order|reference|ref)\s*[:#]?\s*([A-Z]{2,6}-?\d{3,6})\b/i);
  if (m) return m[1].toUpperCase();
  const bare = text.match(/\b([A-Z]{2,5}-\d{3,6})\b/);
  return bare ? bare[1] : undefined;
}

function domainOf(email: string): string {
  const m = email.toLowerCase().match(/@([a-z0-9.-]+)/);
  return m ? m[1] : "";
}

export function parseOrderEmail(
  email: InboundEmail,
  ref: ParserRefData,
  now: Date = new Date(),
): ParsedOrder {
  const text = `${email.subject}\n${email.body}`;
  const fields = labeledFields(email.body);
  const conf: Record<string, number> = {};
  const parsed: ParsedOrder = { fieldConfidence: conf };

  // Customer: sender domain beats everything; then the labeled name; then any name in the text.
  const senderDomain = domainOf(email.from);
  let customer: Customer | undefined;
  if (senderDomain) {
    const contact = ref.contacts.find((c) => domainOf(c.email) === senderDomain);
    if (contact) {
      customer = ref.customers.find((c) => c.id === contact.customerId);
      if (customer) conf.customer = 0.9;
    }
  }
  if (!customer && fields.customer) {
    customer = bestByName(ref.customers, fields.customer);
    if (customer) conf.customer = customer.name.toLowerCase() === fields.customer.toLowerCase() ? 0.95 : 0.75;
  }
  if (!customer) {
    customer = bestByName(ref.customers, text, 0.5);
    if (customer) conf.customer = 0.55;
  }
  if (customer) {
    parsed.customerId = customer.id;
    parsed.customerName = customer.name;
  } else {
    parsed.customerName = fields.customer;
    conf.customer = 0;
  }

  // Location: among the customer's locations (or all), by labeled value then free text.
  const candidates = customer
    ? ref.deliveryLocations.filter((l) => l.customerId === customer.id)
    : ref.deliveryLocations;
  let location: DeliveryLocation | undefined;
  if (fields.location) {
    location = bestLocation(candidates, fields.location);
    if (location) conf.location = 0.85;
  }
  if (!location) {
    location = bestLocation(candidates, text, 0.5);
    if (location) conf.location = 0.6;
  }
  if (!location && candidates.length === 1) {
    location = candidates[0];
    conf.location = 0.7;
  }
  if (location) {
    parsed.deliveryLocationId = location.id;
    parsed.deliveryLocationName = location.name;
  } else {
    parsed.deliveryLocationName = fields.location;
    conf.location = 0;
  }

  // Product.
  const productText = fields.product ?? text;
  const product = guessProduct(productText, ref.products);
  if (product) {
    parsed.productId = product.id;
    parsed.productName = product.name;
    conf.product = fields.product ? 0.9 : 0.65;
  } else {
    parsed.productName = fields.product;
    conf.product = 0;
  }

  // Gallons.
  const gallons = fields.gallons ? parseGallons(fields.gallons) : parseGallons(text);
  if (gallons) {
    parsed.gallons = gallons;
    conf.gallons = fields.gallons ? 0.95 : 0.7;
  } else conf.gallons = 0;

  // Date.
  const date = fields.date ? parseDate(fields.date, now) : parseDate(text, now);
  if (date) {
    parsed.requestedDate = date;
    conf.date = fields.date ? 0.95 : 0.7;
  } else conf.date = 0;

  // PO and notes (optional).
  const po = fields.po ? parsePo(fields.po) ?? fields.po : parsePo(text);
  if (po) {
    parsed.customerPo = po;
    conf.po = fields.po ? 0.95 : 0.7;
  }
  if (fields.notes) parsed.specialInstructions = fields.notes;

  return parsed;
}

/** Mean confidence over the five required fields. */
export function overallConfidence(p: ParsedOrder): number {
  const keys = ["customer", "location", "product", "gallons", "date"];
  const sum = keys.reduce((s, k) => s + (p.fieldConfidence[k] ?? 0), 0);
  return Math.round((sum / keys.length) * 100) / 100;
}

function bestByName(customers: Customer[], text: string, minOverlap = 0.6): Customer | undefined {
  const t = text.toLowerCase();
  const exact = customers.find(
    (c) => t.includes(c.name.toLowerCase()) || t.includes(c.code.toLowerCase() + " "),
  );
  if (exact) return exact;
  let best: { c: Customer; score: number } | undefined;
  for (const c of customers) {
    const score = tokenOverlap(text, c.name);
    if (score >= minOverlap && (!best || score > best.score)) best = { c, score };
  }
  return best?.c;
}

function bestLocation(locations: DeliveryLocation[], text: string, minOverlap = 0.5): DeliveryLocation | undefined {
  const t = text.toLowerCase();
  let best: { l: DeliveryLocation; score: number } | undefined;
  for (const l of locations) {
    let score = tokenOverlap(text, `${l.name} ${l.city}`);
    if (t.includes(l.city.toLowerCase())) score += 0.5;
    if (t.includes(l.name.toLowerCase())) score += 1;
    if (score >= minOverlap && (!best || score > best.score)) best = { l, score };
  }
  return best?.l;
}

function pad(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}
