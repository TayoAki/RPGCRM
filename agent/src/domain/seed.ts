import { scryptSync } from "node:crypto";
import type {
  AuditLogEntry,
  BillingStatus,
  Bol,
  Carrier,
  CarrierRate,
  Contact,
  Customer,
  CustomerPrice,
  Delivery,
  DeliveryLocation,
  EmailIntake,
  Forecast,
  IndexPrice,
  IntegrationRun,
  Invoice,
  InvoiceStatus,
  Load,
  LoadStatus,
  LoadStatusEvent,
  OpsException,
  OpsState,
  Order,
  OrderStatus,
  OrderStatusEvent,
  Payment,
  PriceIndex,
  PricingRule,
  Product,
  QbInvoice,
  RackPrice,
  StaffUser,
  Supplier,
  TaxRate,
  Terminal,
  PortalUser,
} from "./types.js";
import { evaluatePrice } from "../pricing/engine.js";
import type { PricingContext } from "../pricing/engine.js";
import { taxesPerGallon } from "../pricing/taxes.js";
import { buildInvoiceForLoad } from "../billing/invoices.js";
import { computeLoadMargin } from "../margin/compute.js";
import { detectExceptions, reconcileExceptions } from "../exceptions/rules.js";
import { backtest, estimateDirection, MODEL_VERSION, realizedDirection } from "../market/forecast.js";
import { createQuickBooksInvoice } from "../integrations/quickbooks/mock.js";
import { dedupeHash } from "../bols/match.js";

/**
 * RPG Fuel sample dataset. Everything is relative to `now` so the demo always
 * shows "today"; the random walks are seeded so two seeds of the same day are
 * identical. Texas geography and Gulf Coast terminals are placeholders: swap
 * the reference data for RPG's real customers, terminals, and suppliers.
 */

const DAY = 86_400_000;
const HOUR = 3_600_000;

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const r4 = (n: number): number => Math.round(n * 10000) / 10000;
const r2 = (n: number): number => Math.round(n * 100) / 100;

export const PORTAL_DEMO_PASSWORD = "RPGportal!2026";

/**
 * One customer portal account per customer, for its ordering contact, with the
 * shared demo password (documented in the README; real deployments reset it).
 * Also used by the store's startup migration for databases created before
 * portal accounts existed.
 */
export function buildPortalUsers(customers: Customer[], contacts: Contact[], createdAt: string): PortalUser[] {
  return customers.flatMap((c) => {
    const contact = contacts.find((x) => x.customerId === c.id && x.role === "ordering") ?? contacts.find((x) => x.customerId === c.id);
    if (!contact) return [];
    const salt = `portal-${c.id}`;
    return [{
      id: `pu-${c.code.toLowerCase()}`,
      customerId: c.id,
      email: contact.email.toLowerCase(),
      name: contact.name,
      passwordHash: scryptSync(PORTAL_DEMO_PASSWORD, salt, 64).toString("hex"),
      salt,
      status: "active" as const,
      createdAt,
    }];
  });
}

export function buildSeed(now: Date = new Date()): OpsState {
  const rng = mulberry32(20260916);
  const dayIso = (offset: number): string => new Date(now.getTime() + offset * DAY).toISOString().slice(0, 10);
  const hoursAgo = (h: number): string => new Date(now.getTime() - h * HOUR).toISOString();
  const today = dayIso(0);

  // ---- Reference data --------------------------------------------------------
  const staff: StaffUser[] = [
    { id: "u-dana", name: "Dana Whitfield", email: "dana@rpgfuel.example", role: "management" },
    { id: "u-marcus", name: "Marcus Lee", email: "marcus@rpgfuel.example", role: "dispatch" },
    { id: "u-priya", name: "Priya Natarajan", email: "priya@rpgfuel.example", role: "pricing" },
    { id: "u-elena", name: "Elena Ortiz", email: "elena@rpgfuel.example", role: "billing" },
    { id: "u-sam", name: "Sam Carter", email: "sam@rpgfuel.example", role: "admin" },
  ];

  const products: Product[] = [
    { id: "p-ulsd", code: "ULSD", name: "ULSD (Clear #2 Diesel)", category: "diesel", dyed: false, taxCategory: "clear_diesel" },
    { id: "p-dyed", code: "DYED", name: "Dyed ULSD (Off-Road)", category: "diesel", dyed: true, taxCategory: "dyed_diesel" },
    { id: "p-unl87", code: "UNL87", name: "Regular Unleaded 87 (E10)", category: "ethanol_blend", dyed: false, taxCategory: "gasoline" },
    { id: "p-prm93", code: "PRM93", name: "Premium Unleaded 93", category: "gasoline", dyed: false, taxCategory: "gasoline" },
    { id: "p-def", code: "DEF", name: "DEF (Bulk)", category: "def", dyed: false, taxCategory: "def" },
  ];

  const suppliers: Supplier[] = [
    { id: "sup-mpc", code: "MPC", name: "Marathon Petroleum", bolSource: "feed" },
    { id: "sup-vlo", code: "VLO", name: "Valero", bolSource: "feed" },
    { id: "sup-mot", code: "MOT", name: "Motiva", bolSource: "email" },
  ];

  const terminals: Terminal[] = [
    { id: "t-dal", code: "DAL", name: "Dallas Terminal", city: "Dallas", state: "TX", supplierIds: ["sup-mot", "sup-mpc"] },
    { id: "t-ftw", code: "FTW", name: "Fort Worth Terminal", city: "Fort Worth", state: "TX", supplierIds: ["sup-mpc", "sup-vlo"] },
    { id: "t-hou", code: "HOU", name: "Houston Pasadena Terminal", city: "Pasadena", state: "TX", supplierIds: ["sup-vlo", "sup-mot"] },
  ];

  const carriers: Carrier[] = [
    { id: "c-lonestar", code: "LONESTAR", name: "Lone Star Transport", defaultRatePerGallon: 0.045 },
    { id: "c-bluebonnet", code: "BLUEBONNET", name: "Bluebonnet Carriers", defaultRatePerGallon: 0.05 },
    { id: "c-rpg", code: "RPG", name: "RPG Fleet (owned)", defaultRatePerGallon: 0.035 },
  ];

  const carrierRates: CarrierRate[] = [
    { id: "cr-1", carrierId: "c-lonestar", terminalId: "t-dal", destinationState: "TX", ratePerGallon: 0.042, minimumCharge: 250 },
    { id: "cr-2", carrierId: "c-lonestar", terminalId: "t-ftw", destinationState: "TX", ratePerGallon: 0.044, minimumCharge: 250 },
    { id: "cr-3", carrierId: "c-bluebonnet", terminalId: "t-hou", destinationState: "TX", ratePerGallon: 0.048, minimumCharge: 275 },
    { id: "cr-4", carrierId: "c-bluebonnet", terminalId: "t-ftw", destinationState: "TX", ratePerGallon: 0.05, minimumCharge: 275 },
    { id: "cr-5", carrierId: "c-rpg", terminalId: "t-dal", destinationState: "TX", ratePerGallon: 0.033, minimumCharge: 0 },
  ];

  const customers: Customer[] = [
    { id: "cust-lsa", code: "LSA", name: "Lone Star Aggregates", industry: "Quarry / aggregates", billingBasis: "net", paymentTermsDays: 30, creditLimit: 150000, taxExempt: false, status: "active", quickbooksCustomerId: "QB-114" },
    { id: "cust-bcr", code: "BCR", name: "Brazos County Roads", industry: "Municipal", billingBasis: "gross", paymentTermsDays: 45, creditLimit: 250000, taxExempt: true, status: "active", quickbooksCustomerId: "QB-121" },
    { id: "cust-ptf", code: "PTF", name: "Prairie Trucking Fleet", industry: "Trucking", billingBasis: "net", paymentTermsDays: 15, creditLimit: 100000, taxExempt: false, status: "active", quickbooksCustomerId: "QB-133" },
    { id: "cust-gcf", code: "GCF", name: "Gulf Coast Farms Co-op", industry: "Agriculture", billingBasis: "gross", paymentTermsDays: 30, creditLimit: 80000, taxExempt: true, status: "active", quickbooksCustomerId: "QB-140" },
    { id: "cust-qsm", code: "QSM", name: "QuickStop Markets", industry: "Convenience stores", billingBasis: "net", paymentTermsDays: 10, creditLimit: 200000, taxExempt: false, status: "active", quickbooksCustomerId: "QB-152" },
    { id: "cust-hpr", code: "HPR", name: "Hill Peak Ready-Mix", industry: "Construction", billingBasis: "net", paymentTermsDays: 30, creditLimit: 60000, taxExempt: false, status: "on_hold", notes: "Past due 62 days; hold new deliveries until payment." },
    { id: "cust-trc", code: "TRC", name: "Trinity River Contractors", industry: "Construction", billingBasis: "net", paymentTermsDays: 30, creditLimit: 120000, taxExempt: false, status: "active", quickbooksCustomerId: "QB-160" },
  ];

  const deliveryLocations: DeliveryLocation[] = [
    { id: "loc-lsa-pit4", customerId: "cust-lsa", name: "Pit 4", address: "4100 FM 879", city: "Ennis", state: "TX", zip: "75119", deliveryInstructions: "Call the gate 30 minutes before arrival." },
    { id: "loc-lsa-pit7", customerId: "cust-lsa", name: "Pit 7", address: "2200 Old Fort Worth Rd", city: "Midlothian", state: "TX", zip: "76065" },
    { id: "loc-bcr-yard", customerId: "cust-bcr", name: "County Yard", address: "1500 W Villa Maria Rd", city: "Bryan", state: "TX", zip: "77801" },
    { id: "loc-ptf-fw", customerId: "cust-ptf", name: "Fort Worth Yard", address: "7800 Blue Mound Rd", city: "Fort Worth", state: "TX", zip: "76131" },
    { id: "loc-gcf-alvin", customerId: "cust-gcf", name: "Alvin Bulk Tank", address: "3300 County Rd 172", city: "Alvin", state: "TX", zip: "77511" },
    { id: "loc-qsm-12", customerId: "cust-qsm", name: "Store 12", address: "1400 N Hwy 77", city: "Waxahachie", state: "TX", zip: "75165", deliveryInstructions: "Deliver after 9 PM; tanks behind the store." },
    { id: "loc-qsm-21", customerId: "cust-qsm", name: "Store 21", address: "900 S Main St", city: "Cleburne", state: "TX", zip: "76033" },
    { id: "loc-qsm-33", customerId: "cust-qsm", name: "Store 33", address: "2100 W 7th Ave", city: "Corsicana", state: "TX", zip: "75110" },
    { id: "loc-hpr-denton", customerId: "cust-hpr", name: "Denton Plant", address: "5001 N Loop 288", city: "Denton", state: "TX", zip: "76208" },
    { id: "loc-trc-dallas", customerId: "cust-trc", name: "Dallas Laydown Yard", address: "3900 Irving Blvd", city: "Dallas", state: "TX", zip: "75247" },
  ];

  const contacts: Contact[] = [
    { id: "ct-1", customerId: "cust-lsa", name: "Ray Hollis", title: "Site Manager", email: "orders@lonestaraggregates.com", phone: "972-555-0141", role: "ordering" },
    { id: "ct-2", customerId: "cust-lsa", name: "Marta Nguyen", title: "AP Clerk", email: "ap@lonestaraggregates.com", role: "billing" },
    { id: "ct-3", customerId: "cust-bcr", name: "Curtis Bell", title: "Fleet Supervisor", email: "cbell@brazoscounty.example", role: "ordering" },
    { id: "ct-4", customerId: "cust-ptf", name: "Dale Kirk", title: "Dispatch Lead", email: "dispatch@prairietrucking.com", role: "ordering" },
    { id: "ct-5", customerId: "cust-gcf", name: "Lupe Herrera", title: "Purchasing", email: "purchasing@gulfcoastfarms.coop", role: "ordering" },
    { id: "ct-6", customerId: "cust-qsm", name: "Tom Alvarez", title: "Fuel Buyer", email: "fuel@quickstopmarkets.com", phone: "214-555-0199", role: "ordering" },
    { id: "ct-7", customerId: "cust-qsm", name: "Jen Park", title: "Controller", email: "ap@quickstopmarkets.com", role: "billing" },
    { id: "ct-8", customerId: "cust-hpr", name: "Owen Reyes", title: "Plant Manager", email: "owen@hillpeakreadymix.example", role: "ordering" },
    { id: "ct-9", customerId: "cust-trc", name: "Alicia Grant", title: "Project Coordinator", email: "agrant@trinityriverco.example", role: "ordering" },
  ];

  const taxRates: TaxRate[] = [
    { id: "tax-1", state: "TX", taxCategory: "clear_diesel", component: "federal_excise", ratePerGallon: 0.244, effectiveStart: "2025-01-01", effectiveEnd: null },
    { id: "tax-2", state: "TX", taxCategory: "clear_diesel", component: "state_excise", ratePerGallon: 0.2, effectiveStart: "2025-01-01", effectiveEnd: null },
    { id: "tax-3", state: "TX", taxCategory: "clear_diesel", component: "lust", ratePerGallon: 0.001, effectiveStart: "2025-01-01", effectiveEnd: null },
    { id: "tax-4", state: "TX", taxCategory: "clear_diesel", component: "environmental", ratePerGallon: 0.0005, effectiveStart: "2025-01-01", effectiveEnd: null },
    { id: "tax-5", state: "TX", taxCategory: "gasoline", component: "federal_excise", ratePerGallon: 0.184, effectiveStart: "2025-01-01", effectiveEnd: null },
    { id: "tax-6", state: "TX", taxCategory: "gasoline", component: "state_excise", ratePerGallon: 0.2, effectiveStart: "2025-01-01", effectiveEnd: null },
    { id: "tax-7", state: "TX", taxCategory: "gasoline", component: "lust", ratePerGallon: 0.001, effectiveStart: "2025-01-01", effectiveEnd: null },
    { id: "tax-8", state: "TX", taxCategory: "gasoline", component: "environmental", ratePerGallon: 0.0005, effectiveStart: "2025-01-01", effectiveEnd: null },
    { id: "tax-9", state: "TX", taxCategory: "dyed_diesel", component: "environmental", ratePerGallon: 0.0025, effectiveStart: "2025-01-01", effectiveEnd: null },
  ];

  // ---- Market history and rack prices ---------------------------------------
  const priceIndexes: PriceIndex[] = [
    { id: "idx-opis-dal-ulsd", code: "OPIS-DAL-ULSD", name: "OPIS Dallas ULSD rack average", source: "OPIS", productId: "p-ulsd" },
    { id: "idx-opis-dal-87", code: "OPIS-DAL-UNL87", name: "OPIS Dallas Unleaded 87 rack average", source: "OPIS", productId: "p-unl87" },
    { id: "idx-nymex-ho", code: "NYMEX-HO", name: "NYMEX ULSD futures (front month)", source: "CME" },
    { id: "idx-nymex-rbob", code: "NYMEX-RBOB", name: "NYMEX RBOB futures (front month)", source: "CME" },
  ];
  const indexPrices: IndexPrice[] = [];
  const series: Record<string, number[]> = {};
  const bases: Record<string, number> = { "idx-opis-dal-ulsd": 2.46, "idx-opis-dal-87": 2.14, "idx-nymex-ho": 2.31, "idx-nymex-rbob": 2.04 };
  let ipSeq = 0;
  for (const idx of priceIndexes) {
    let v = bases[idx.id];
    series[idx.id] = [];
    for (let d = -60; d <= 0; d++) {
      const prev = v;
      v = r4(Math.max(1.2, v + (rng() - 0.5) * 0.06 + (d % 7 === 0 ? (rng() - 0.5) * 0.04 : 0)));
      series[idx.id].push(v);
      // History ends yesterday so the market feed refresh has today's value to add.
      if (d <= -1) indexPrices.push({ id: `ip-${++ipSeq}`, indexId: idx.id, date: dayIso(d), value: v, change: d === -60 ? 0 : r4(v - prev) });
    }
  }
  const indexOn = (indexId: string, dayOffset: number): number => series[indexId][dayOffset + 60];

  const rackPrices: RackPrice[] = [];
  const terminalOffset: Record<string, number> = { "t-dal": 0, "t-ftw": 0.012, "t-hou": -0.018 };
  const supplierOffset: Record<string, number> = { "sup-mpc": 0.004, "sup-vlo": -0.003, "sup-mot": 0.0 };
  let rpSeq = 0;
  for (let d = -30; d <= 0; d++) {
    const effectiveAt = new Date(new Date(dayIso(d) + "T06:00:00.000Z").getTime()).toISOString();
    for (const t of terminals) {
      for (const supplierId of t.supplierIds) {
        const ulsd = r4(indexOn("idx-opis-dal-ulsd", d) + terminalOffset[t.id] + supplierOffset[supplierId] + (rng() - 0.5) * 0.006);
        const unl87 = r4(indexOn("idx-opis-dal-87", d) + terminalOffset[t.id] + supplierOffset[supplierId] + (rng() - 0.5) * 0.006);
        const post = (productId: string, price: number) =>
          rackPrices.push({ id: `rp-${++rpSeq}`, terminalId: t.id, supplierId, productId, effectiveAt, pricePerGallon: price, source: "feed" });
        post("p-ulsd", ulsd);
        post("p-dyed", r4(ulsd - 0.015));
        post("p-unl87", unl87);
        post("p-prm93", r4(unl87 + 0.42));
        if (supplierId === "sup-mot") post("p-def", r4(2.85 + (rng() - 0.5) * 0.02));
      }
    }
  }

  // ---- Pricing rules -----------------------------------------------------------
  const start90 = dayIso(-90);
  const pricingRules: PricingRule[] = [
    { id: "rule-def-ulsd", name: "Default ULSD: rack + $0.12", customerId: null, productId: "p-ulsd", terminalId: null, deliveryLocationId: null, basisType: "rack", basisRef: null, fixedPrice: null, differential: 0.12, freightPerGallon: 0.06, feesPerGallon: 0.005, taxTreatment: "taxable", effectiveStart: start90, effectiveEnd: null, priority: 0, status: "active" },
    { id: "rule-def-dyed", name: "Default dyed: rack + $0.10", customerId: null, productId: "p-dyed", terminalId: null, deliveryLocationId: null, basisType: "rack", basisRef: null, fixedPrice: null, differential: 0.1, freightPerGallon: 0.06, feesPerGallon: 0.005, taxTreatment: "taxable", effectiveStart: start90, effectiveEnd: null, priority: 0, status: "active" },
    { id: "rule-def-87", name: "Default 87: rack + $0.10", customerId: null, productId: "p-unl87", terminalId: null, deliveryLocationId: null, basisType: "rack", basisRef: null, fixedPrice: null, differential: 0.1, freightPerGallon: 0.05, feesPerGallon: 0.005, taxTreatment: "taxable", effectiveStart: start90, effectiveEnd: null, priority: 0, status: "active" },
    { id: "rule-def-93", name: "Default 93: rack + $0.14", customerId: null, productId: "p-prm93", terminalId: null, deliveryLocationId: null, basisType: "rack", basisRef: null, fixedPrice: null, differential: 0.14, freightPerGallon: 0.05, feesPerGallon: 0.005, taxTreatment: "taxable", effectiveStart: start90, effectiveEnd: null, priority: 0, status: "active" },
    { id: "rule-def-def", name: "Default DEF: fixed $3.15 (draft, pending pricing review)", customerId: null, productId: "p-def", terminalId: null, deliveryLocationId: null, basisType: "fixed", basisRef: null, fixedPrice: 3.15, differential: 0, freightPerGallon: 0.05, feesPerGallon: 0, taxTreatment: "exempt", effectiveStart: start90, effectiveEnd: null, priority: 0, status: "draft" },
    { id: "rule-lsa-dyed", name: "Lone Star Aggregates dyed: OPIS Dallas ULSD − $0.02 (contract)", customerId: "cust-lsa", productId: "p-dyed", terminalId: null, deliveryLocationId: null, basisType: "index", basisRef: "idx-opis-dal-ulsd", fixedPrice: null, differential: -0.02, freightPerGallon: 0.055, feesPerGallon: 0.005, taxTreatment: "taxable", effectiveStart: dayIso(-60), effectiveEnd: dayIso(120), priority: 10, status: "active" },
    { id: "rule-qsm-87-dal", name: "QuickStop 87 ex Dallas: rack + $0.06", customerId: "cust-qsm", productId: "p-unl87", terminalId: "t-dal", deliveryLocationId: null, basisType: "rack", basisRef: "t-dal", fixedPrice: null, differential: 0.06, freightPerGallon: 0.04, feesPerGallon: 0.003, taxTreatment: "taxable", effectiveStart: start90, effectiveEnd: null, priority: 10, status: "active" },
    { id: "rule-qsm-93-dal", name: "QuickStop 93 ex Dallas: rack + $0.09", customerId: "cust-qsm", productId: "p-prm93", terminalId: "t-dal", deliveryLocationId: null, basisType: "rack", basisRef: "t-dal", fixedPrice: null, differential: 0.09, freightPerGallon: 0.04, feesPerGallon: 0.003, taxTreatment: "taxable", effectiveStart: start90, effectiveEnd: null, priority: 10, status: "active" },
    { id: "rule-bcr-ulsd-fixed", name: "Brazos County ULSD fixed contract $2.79", customerId: "cust-bcr", productId: "p-ulsd", terminalId: null, deliveryLocationId: null, basisType: "fixed", basisRef: null, fixedPrice: 2.79, differential: 0, freightPerGallon: 0.05, feesPerGallon: 0, taxTreatment: "exempt", effectiveStart: dayIso(-45), effectiveEnd: dayIso(30), priority: 10, status: "active" },
    { id: "rule-gcf-dyed", name: "Gulf Coast Farms dyed ex Houston: rack + $0.08", customerId: "cust-gcf", productId: "p-dyed", terminalId: "t-hou", deliveryLocationId: null, basisType: "rack", basisRef: "t-hou", fixedPrice: null, differential: 0.08, freightPerGallon: 0.07, feesPerGallon: 0.005, taxTreatment: "exempt", effectiveStart: start90, effectiveEnd: null, priority: 10, status: "active" },
    { id: "rule-ptf-ulsd-ftw", name: "Prairie Trucking ULSD ex Fort Worth: rack + $0.09", customerId: "cust-ptf", productId: "p-ulsd", terminalId: "t-ftw", deliveryLocationId: null, basisType: "rack", basisRef: "t-ftw", fixedPrice: null, differential: 0.09, freightPerGallon: 0.045, feesPerGallon: 0.005, taxTreatment: "taxable", effectiveStart: start90, effectiveEnd: null, priority: 10, status: "active" },
  ];

  const pricingCtx: PricingContext = {
    rules: pricingRules, rackPrices, indexPrices, priceIndexes, taxRates, customers, products, deliveryLocations, terminals,
  };

  // ---- Operational scenarios ---------------------------------------------------
  const customerPrices: CustomerPrice[] = [];
  const orders: Order[] = [];
  const orderEvents: OrderStatusEvent[] = [];
  const loads: Load[] = [];
  const loadEvents: LoadStatusEvent[] = [];
  const bols: Bol[] = [];
  const deliveries: Delivery[] = [];
  const invoices: Invoice[] = [];
  const payments: Payment[] = [];
  const qbInvoices: QbInvoice[] = [];
  const auditLog: AuditLogEntry[] = [];
  let cpSeq = 0;
  let evSeq = 0;
  let alSeq = 0;
  let qbSeq = 0;

  const snapshotPrice = (customerId: string, productId: string, deliveryLocationId: string, terminalId: string | undefined, date: string): CustomerPrice | undefined => {
    const r = evaluatePrice(pricingCtx, { customerId, productId, deliveryLocationId, terminalId, date });
    if (!r.ok) return undefined;
    const cp: CustomerPrice = { id: `cp-${++cpSeq}`, ...r.price, computedAt: date.length === 10 ? `${date}T12:00:00.000Z` : date };
    customerPrices.push(cp);
    return cp;
  };

  interface Scenario {
    n: number;
    customerId: string;
    locationId: string;
    productId: string;
    gallons: number;
    requestedDay: number;
    status: OrderStatus;
    source: Order["source"];
    po?: string;
    instructions?: string;
    creditHold?: boolean;
    load?: {
      n: number;
      carrierId: string;
      terminalId: string;
      supplierId: string;
      status: LoadStatus;
      pickupHoursAgo: number;
      deliveryHoursAgo: number;
      billing: BillingStatus | null;
      bol?: { number: string; gross: number; net: number };
      delivered?: { gallons: number; receiver: string; ticket: string };
      invoice?: { n: number; status: InvoiceStatus; paid?: boolean; approvedHoursAgo?: number };
    };
  }

  const scenarios: Scenario[] = [
    { n: 1, customerId: "cust-lsa", locationId: "loc-lsa-pit4", productId: "p-dyed", gallons: 7500, requestedDay: -3, status: "delivered", source: "email", po: "LSA-4471", load: { n: 1, carrierId: "c-lonestar", terminalId: "t-dal", supplierId: "sup-mot", status: "delivered", pickupHoursAgo: 78, deliveryHoursAgo: 74, billing: "paid", bol: { number: "MOT-DAL-441877", gross: 7520, net: 7409 }, delivered: { gallons: 7409, receiver: "R. Hollis", ticket: "T-88121" }, invoice: { n: 1001, status: "paid", paid: true, approvedHoursAgo: 60 } } },
    { n: 12, customerId: "cust-qsm", locationId: "loc-qsm-33", productId: "p-unl87", gallons: 8000, requestedDay: -5, status: "delivered", source: "manual", po: "QSM-7690", load: { n: 8, carrierId: "c-lonestar", terminalId: "t-dal", supplierId: "sup-mpc", status: "delivered", pickupHoursAgo: 124, deliveryHoursAgo: 120, billing: "invoiced", bol: { number: "MPC-DAL-990201", gross: 8010, net: 7898 }, delivered: { gallons: 7898, receiver: "Store 33 mgr", ticket: "T-88090" }, invoice: { n: 1002, status: "synced", approvedHoursAgo: 100 } } },
    { n: 2, customerId: "cust-qsm", locationId: "loc-qsm-12", productId: "p-unl87", gallons: 8000, requestedDay: -2, status: "delivered", source: "email", po: "QSM-7701", load: { n: 2, carrierId: "c-lonestar", terminalId: "t-dal", supplierId: "sup-mpc", status: "delivered", pickupHoursAgo: 52, deliveryHoursAgo: 49, billing: "invoiced", bol: { number: "MPC-DAL-990288", gross: 8020, net: 7905 }, delivered: { gallons: 7905, receiver: "Store 12 mgr", ticket: "T-88130" }, invoice: { n: 1003, status: "synced", approvedHoursAgo: 40 } } },
    { n: 3, customerId: "cust-ptf", locationId: "loc-ptf-fw", productId: "p-ulsd", gallons: 6500, requestedDay: -2, status: "delivered", source: "email", po: "PTF-0902", load: { n: 3, carrierId: "c-bluebonnet", terminalId: "t-ftw", supplierId: "sup-vlo", status: "delivered", pickupHoursAgo: 50, deliveryHoursAgo: 47, billing: "ready_to_invoice", bol: { number: "VLO-FTW-119904", gross: 6510, net: 6418 }, delivered: { gallons: 6418, receiver: "D. Kirk", ticket: "T-88133" }, invoice: { n: 1004, status: "pending_approval" } } },
    { n: 4, customerId: "cust-bcr", locationId: "loc-bcr-yard", productId: "p-ulsd", gallons: 7000, requestedDay: -1, status: "delivered", source: "manual", po: "BCR-PO-3310", load: { n: 4, carrierId: "c-bluebonnet", terminalId: "t-hou", supplierId: "sup-vlo", status: "delivered", pickupHoursAgo: 27, deliveryHoursAgo: 23, billing: "pricing_verified", bol: { number: "VLO-HOU-330112", gross: 7015, net: 6920 }, delivered: { gallons: 6920, receiver: "C. Bell", ticket: "T-88140" } } },
    { n: 5, customerId: "cust-trc", locationId: "loc-trc-dallas", productId: "p-ulsd", gallons: 5000, requestedDay: -1, status: "delivered", source: "manual", po: "TRC-2288", load: { n: 5, carrierId: "c-rpg", terminalId: "t-dal", supplierId: "sup-mot", status: "delivered", pickupHoursAgo: 30, deliveryHoursAgo: 26, billing: null, delivered: { gallons: 4941, receiver: "A. Grant", ticket: "T-88142" } } },
    { n: 6, customerId: "cust-gcf", locationId: "loc-gcf-alvin", productId: "p-dyed", gallons: 7800, requestedDay: 0, status: "in_transit", source: "email", po: "GCF-2199", load: { n: 6, carrierId: "c-bluebonnet", terminalId: "t-hou", supplierId: "sup-mot", status: "in_transit", pickupHoursAgo: 5, deliveryHoursAgo: -2, billing: null } },
    { n: 7, customerId: "cust-qsm", locationId: "loc-qsm-21", productId: "p-unl87", gallons: 8500, requestedDay: 0, status: "carrier_confirmed", source: "portal", po: "QSM-7708", load: { n: 7, carrierId: "c-lonestar", terminalId: "t-dal", supplierId: "sup-mpc", status: "dispatched", pickupHoursAgo: 3, deliveryHoursAgo: -4, billing: null } },
    { n: 8, customerId: "cust-lsa", locationId: "loc-lsa-pit7", productId: "p-dyed", gallons: 7500, requestedDay: 1, status: "confirmed", source: "email", po: "LSA-4480" },
    { n: 9, customerId: "cust-hpr", locationId: "loc-hpr-denton", productId: "p-ulsd", gallons: 4500, requestedDay: 1, status: "received", source: "manual", po: "HPR-118", creditHold: true },
    { n: 10, customerId: "cust-trc", locationId: "loc-trc-dallas", productId: "p-def", gallons: 1000, requestedDay: 2, status: "received", source: "manual", po: "TRC-2291" },
    { n: 11, customerId: "cust-ptf", locationId: "loc-ptf-fw", productId: "p-ulsd", gallons: 6500, requestedDay: 2, status: "received", source: "email", po: "PTF-0911", instructions: "Same as last time." },
  ];

  const transitions: Record<OrderStatus, OrderStatus[]> = {
    received: ["received"],
    confirmed: ["received", "confirmed"],
    carrier_confirmed: ["received", "confirmed", "carrier_confirmed"],
    in_transit: ["received", "confirmed", "carrier_confirmed", "in_transit"],
    delivered: ["received", "confirmed", "carrier_confirmed", "in_transit", "delivered"],
    cancelled: ["received", "cancelled"],
  };
  const loadPath: Record<LoadStatus, LoadStatus[]> = {
    planned: ["planned"],
    dispatched: ["planned", "dispatched"],
    loading: ["planned", "dispatched", "loading"],
    in_transit: ["planned", "dispatched", "loading", "in_transit"],
    delivered: ["planned", "dispatched", "loading", "in_transit", "delivered"],
    closed: ["planned", "dispatched", "loading", "in_transit", "delivered", "closed"],
  };

  for (const sc of scenarios) {
    const createdAt = hoursAgo((0 - sc.requestedDay) * 24 + 30);
    const order: Order = {
      id: `o-${1000 + sc.n}`,
      orderNumber: `ORD-${1000 + sc.n}`,
      customerId: sc.customerId,
      deliveryLocationId: sc.locationId,
      productId: sc.productId,
      requestedGallons: sc.gallons,
      requestedDate: dayIso(sc.requestedDay),
      customerPo: sc.po,
      specialInstructions: sc.instructions,
      source: sc.source,
      status: sc.status,
      creditHold: sc.creditHold ?? false,
      createdAt,
    };
    orders.push(order);
    snapshotPrice(order.customerId, order.productId, order.deliveryLocationId, sc.load?.terminalId, createdAt.slice(0, 10));
    let prev: OrderStatus | null = null;
    transitions[sc.status].forEach((st, i) => {
      orderEvents.push({ id: `oe-${++evSeq}`, orderId: order.id, from: prev, to: st, occurredAt: new Date(new Date(createdAt).getTime() + i * 5 * HOUR).toISOString(), actorId: i === 0 ? "system" : "u-marcus" });
      prev = st;
    });

    if (!sc.load) continue;
    const L = sc.load;
    const load: Load = {
      id: `l-${500 + L.n}`,
      loadNumber: `LD-${500 + L.n}`,
      orderIds: [order.id],
      customerId: sc.customerId,
      deliveryLocationId: sc.locationId,
      productId: sc.productId,
      carrierId: L.carrierId,
      driverName: L.carrierId === "c-rpg" ? "J. Mata" : undefined,
      terminalId: L.terminalId,
      supplierId: L.supplierId,
      plannedGallons: sc.gallons,
      scheduledPickupAt: hoursAgo(L.pickupHoursAgo),
      scheduledDeliveryAt: hoursAgo(L.deliveryHoursAgo),
      status: L.status,
      billingStatus: L.billing,
      freightCost: 0,
    };
    loads.push(load);
    let lprev: LoadStatus | null = null;
    loadPath[L.status].forEach((st, i) => {
      loadEvents.push({ id: `le-${++evSeq}`, loadId: load.id, from: lprev, to: st, occurredAt: hoursAgo(L.pickupHoursAgo + 6 - i * 2), actorId: i === 0 ? "u-marcus" : "u-marcus" });
      lprev = st;
    });

    if (L.bol) {
      const product = products.find((p) => p.id === sc.productId)!;
      const rack = rackPrices
        .filter((rp) => rp.terminalId === L.terminalId && rp.productId === sc.productId && rp.effectiveAt <= load.scheduledPickupAt)
        .sort((a, b) => b.effectiveAt.localeCompare(a.effectiveAt))[0];
      const bol: Bol = {
        id: `bol-${L.n}`,
        bolNumber: L.bol.number,
        supplierId: L.supplierId,
        terminalId: L.terminalId,
        carrierId: L.carrierId,
        loadId: load.id,
        liftedAt: hoursAgo(L.pickupHoursAgo - 1),
        destinationText: `${customers.find((c) => c.id === sc.customerId)!.name.toUpperCase()} / ${deliveryLocations.find((d) => d.id === sc.locationId)!.city.toUpperCase()} TX`,
        customerRef: customers.find((c) => c.id === sc.customerId)!.code,
        source: suppliers.find((s) => s.id === L.supplierId)!.bolSource === "feed" ? "feed" : "email",
        dedupeHash: "",
        matchStatus: "matched",
        lines: [
          {
            productId: sc.productId,
            grossGallons: L.bol.gross,
            netGallons: L.bol.net,
            supplierCostPerGallon: rack?.pricePerGallon ?? 2.5,
            taxesPerGallon: taxesPerGallon(taxRates, "TX", product.taxCategory, load.scheduledPickupAt),
            feesPerGallon: 0.0025,
          },
        ],
      };
      bol.dedupeHash = dedupeHash(bol);
      bols.push(bol);
      load.bolId = bol.id;
    }
    if (L.delivered) {
      deliveries.push({ id: `dl-${L.n}`, loadId: load.id, deliveredAt: hoursAgo(L.deliveryHoursAgo), deliveredGallons: L.delivered.gallons, receiverName: L.delivered.receiver, ticketNumber: L.delivered.ticket });
    }
    if (L.invoice && load.bolId) {
      const bol = bols.find((b) => b.id === load.bolId)!;
      const customer = customers.find((c) => c.id === sc.customerId)!;
      const location = deliveryLocations.find((d) => d.id === sc.locationId)!;
      const liftPrice = snapshotPrice(sc.customerId, sc.productId, sc.locationId, L.terminalId, bol.liftedAt)!;
      const invoice = buildInvoiceForLoad({
        id: `inv-${L.invoice.n}`,
        invoiceNumber: `INV-${L.invoice.n}`,
        load, bol, customer, location, products, price: liftPrice, taxRates,
        now: new Date(now.getTime() - (L.invoice.approvedHoursAgo ?? 12) * HOUR - 4 * HOUR),
      });
      invoice.status = L.invoice.status;
      if (["approved", "synced", "paid"].includes(L.invoice.status)) {
        invoice.approvedBy = "u-dana";
        invoice.approvedAt = hoursAgo(L.invoice.approvedHoursAgo ?? 12);
        auditLog.push({ id: `al-${++alSeq}`, actorId: "u-dana", action: "invoice.approved", entityType: "invoice", entityId: invoice.id, detail: `Approved ${invoice.invoiceNumber} for $${invoice.total.toFixed(2)}`, occurredAt: invoice.approvedAt });
      }
      if (["synced", "paid"].includes(L.invoice.status)) {
        const { ledger } = createQuickBooksInvoice(invoice, customer, (pid) => products.find((p) => p.id === pid)?.name ?? pid, ++qbSeq, new Date(now.getTime() - (L.invoice.approvedHoursAgo ?? 12) * HOUR + HOUR));
        invoice.quickbooksInvoiceId = ledger.id;
        invoice.syncedAt = hoursAgo((L.invoice.approvedHoursAgo ?? 12) - 1);
        if (L.invoice.paid) {
          ledger.balance = 0;
          ledger.status = "paid";
          payments.push({ id: `pay-${L.invoice.n}`, invoiceId: invoice.id, quickbooksPaymentId: `QBP-${29000 + L.invoice.n}`, amount: invoice.total, receivedAt: hoursAgo(8), method: "ACH" });
        }
        qbInvoices.push(ledger);
      }
      invoices.push(invoice);
      load.invoiceId = invoice.id;
    }
  }

  // ---- Historical intake, integration runs -------------------------------------
  const emailIntakes: EmailIntake[] = [
    {
      id: "ei-1", messageId: "<ptf-0911@prairietrucking.com>", receivedAt: hoursAgo(20), from: "dispatch@prairietrucking.com", subject: "Fuel for the yard",
      body: "Need 6500 gallons of diesel at the Fort Worth yard on " + dayIso(2) + ". Reference PTF-0911. Same as last time.",
      parsed: { customerId: "cust-ptf", customerName: "Prairie Trucking Fleet", deliveryLocationId: "loc-ptf-fw", deliveryLocationName: "Fort Worth Yard", productId: "p-ulsd", productName: "ULSD (Clear #2 Diesel)", gallons: 6500, requestedDate: dayIso(2), customerPo: "PTF-0911", specialInstructions: "Same as last time.", fieldConfidence: { customer: 0.9, location: 0.7, product: 0.65, gallons: 0.7, date: 0.7, po: 0.7 } },
      confidence: 0.73, issues: [], reviewStatus: "approved", reviewedBy: "u-marcus", reviewedAt: hoursAgo(19), orderId: "o-1011",
    },
    {
      id: "ei-2", messageId: "<promo-9911@fuelcards.example>", receivedAt: hoursAgo(26), from: "offers@fuelcards.example", subject: "Save 12% on fleet cards this month",
      body: "Limited time offer for fleet fuel cards. Reply to learn more.",
      parsed: { fieldConfidence: { customer: 0, location: 0, product: 0, gallons: 0, date: 0 } },
      confidence: 0, issues: ["No customer matched", "No gallons found", "No requested date found"], reviewStatus: "rejected", reviewedBy: "u-marcus", reviewedAt: hoursAgo(25),
    },
  ];

  const integrationRuns: IntegrationRun[] = [
    { id: "run-1", kind: "index_feed", startedAt: hoursAgo(26), finishedAt: hoursAgo(26), status: "success", recordsIn: 4, recordsOut: 4, summary: "4 index values updated for " + dayIso(-1) },
    { id: "run-2", kind: "bol_feed", startedAt: hoursAgo(25), finishedAt: hoursAgo(25), status: "success", recordsIn: 2, recordsOut: 2, summary: "2 BOLs ingested, 2 matched" },
    { id: "run-3", kind: "email_intake", startedAt: hoursAgo(20), finishedAt: hoursAgo(20), status: "success", recordsIn: 2, recordsOut: 2, summary: "2 emails parsed, 2 queued for review" },
    { id: "run-4", kind: "quickbooks_invoices", startedAt: hoursAgo(39), finishedAt: hoursAgo(39), status: "success", recordsIn: 1, recordsOut: 1, summary: "INV-1003 created in QuickBooks" },
  ];

  // ---- Derived: forecasts, margins, exceptions -----------------------------------
  const forecasts: Forecast[] = [];
  let fSeq = 0;
  for (const idx of priceIndexes) {
    const hist = indexPrices.filter((p) => p.indexId === idx.id);
    // Backfill the last ten days so the hit rate is visible, then tomorrow's estimate.
    for (let d = -10; d <= 0; d++) {
      const upTo = hist.filter((p) => p.date <= dayIso(d - 1));
      const est = estimateDirection(upTo);
      const realized = hist.find((p) => p.date === dayIso(d));
      const prevVal = upTo[upTo.length - 1]?.value;
      forecasts.push({
        id: `fc-${++fSeq}`, indexId: idx.id, targetDate: dayIso(d), direction: est.direction, confidence: est.confidence, modelVersion: MODEL_VERSION, rationale: est.rationale,
        realizedDirection: realized && prevVal !== undefined ? realizedDirection(prevVal, realized.value) : undefined,
      });
    }
    const est = estimateDirection(hist);
    const bt = backtest(hist);
    forecasts.push({ id: `fc-${++fSeq}`, indexId: idx.id, targetDate: dayIso(1), direction: est.direction, confidence: est.confidence, modelVersion: MODEL_VERSION, rationale: `${est.rationale}. Backtest hit rate ${(bt.hitRate * 100).toFixed(0)}% over ${bt.total} days` });
  }

  const marginCtx = { bols, invoices, customerPrices, rackPrices, carrierRates, carriers, customers, deliveryLocations };
  const loadMargins = loads.map((l) => computeLoadMargin(l, marginCtx, now));

  const portalUsers = buildPortalUsers(customers, contacts, hoursAgo(24 * 30));

  const state: OpsState = {
    staff, customers, deliveryLocations, contacts, products, suppliers, terminals, carriers, carrierRates,
    priceIndexes, indexPrices, rackPrices, pricingRules, customerPrices, forecasts,
    emailIntakes, orders, orderEvents, loads, loadEvents, bols, deliveries,
    taxRates, invoices, payments, qbInvoices, loadMargins, exceptions: [], auditLog, integrationRuns, portalUsers, portalSessions: [],
  };
  let exSeq = 0;
  const detected = detectExceptions(state, now, (req) => evaluatePrice(pricingCtx, req));
  const { changed } = reconcileExceptions([], detected, () => `ex-${++exSeq}`, now);
  const exceptions: OpsException[] = changed;
  auditLog.push({ id: `al-${++alSeq}`, actorId: "system", action: "seed.loaded", entityType: "system", entityId: "seed", detail: `Sample dataset loaded for ${today}`, occurredAt: now.toISOString() });

  return { ...state, exceptions, auditLog };
}
