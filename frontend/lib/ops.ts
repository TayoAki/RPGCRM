import type {
  BillingStatus,
  Customer,
  InvoiceStatus,
  Load,
  LoadStatus,
  OpsException,
  OpsState,
  Order,
  OrderStatus,
  Severity,
} from "./domain";
import { BILLING_STATUS_LABEL, LOAD_STATUS_LABEL, ORDER_STATUS_LABEL } from "./domain";

export const EMPTY_STATE: OpsState = {
  staff: [], customers: [], deliveryLocations: [], contacts: [], products: [], suppliers: [], terminals: [], carriers: [], carrierRates: [],
  priceIndexes: [], indexPrices: [], rackPrices: [], pricingRules: [], customerPrices: [], forecasts: [],
  emailIntakes: [], orders: [], orderEvents: [], loads: [], loadEvents: [], bols: [], deliveries: [],
  taxRates: [], invoices: [], payments: [], qbInvoices: [], loadMargins: [], exceptions: [], auditLog: [], integrationRuns: [],
  portalUsers: [], portalSessions: [],
};

export function isOpsState(s: unknown): s is OpsState {
  return !!s && typeof s === "object" && Array.isArray((s as OpsState).customers) && Array.isArray((s as OpsState).orders);
}

// ---- formatting ---------------------------------------------------------------

export const money = (n: number | null | undefined, digits = 2): string =>
  n === null || n === undefined ? "—" : `$${n.toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits })}`;
export const ppg = (n: number | null | undefined): string => (n === null || n === undefined ? "—" : `$${n.toFixed(4)}`);
export const gal = (n: number | null | undefined): string => (n === null || n === undefined ? "—" : `${Math.round(n).toLocaleString("en-US")} gal`);
export const pct = (n: number | null | undefined): string => (n === null || n === undefined ? "—" : `${Math.round(n * 100)}%`);
export const signed = (n: number, digits = 4): string => `${n > 0 ? "+" : n < 0 ? "−" : ""}$${Math.abs(n).toFixed(digits)}`;

export function fmtDate(iso?: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso.length === 10 ? `${iso}T12:00:00Z` : iso);
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: iso.length === 10 ? "UTC" : undefined });
}

export function fmtDateTime(iso?: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

export function relativeTime(iso: string, now: number = Date.now()): string {
  const diff = now - new Date(iso).getTime();
  const abs = Math.abs(diff);
  const m = Math.round(abs / 60000);
  const h = Math.round(abs / 3600000);
  const d = Math.round(abs / 86400000);
  const s = m < 1 ? "just now" : m < 60 ? `${m}m` : h < 24 ? `${h}h` : `${d}d`;
  if (s === "just now") return s;
  return diff >= 0 ? `${s} ago` : `in ${s}`;
}

export const titleCase = (s: string): string => s.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());

// ---- lookups ----------------------------------------------------------------------

export const customerName = (s: OpsState, id: string): string => s.customers.find((c) => c.id === id)?.name ?? id;
export const productName = (s: OpsState, id: string): string => s.products.find((p) => p.id === id)?.name ?? id;
export const productCode = (s: OpsState, id: string): string => s.products.find((p) => p.id === id)?.code ?? id;
export const terminalName = (s: OpsState, id: string): string => s.terminals.find((t) => t.id === id)?.name ?? id;
export const carrierName = (s: OpsState, id: string): string => s.carriers.find((c) => c.id === id)?.name ?? id;
export const supplierName = (s: OpsState, id: string): string => s.suppliers.find((c) => c.id === id)?.name ?? id;
export const locationName = (s: OpsState, id: string): string => s.deliveryLocations.find((l) => l.id === id)?.name ?? id;
export const staffName = (s: OpsState, id: string): string => (id === "system" ? "System" : (s.staff.find((u) => u.id === id)?.name ?? id));
export const loadForOrder = (s: OpsState, orderId: string): Load | undefined => s.loads.find((l) => l.orderIds.includes(orderId));
export const openExceptions = (s: OpsState): OpsException[] => s.exceptions.filter((e) => e.status !== "resolved");

export function groupBy<T, K extends string>(items: T[], key: (t: T) => K): Record<K, T[]> {
  const out = {} as Record<K, T[]>;
  for (const it of items) (out[key(it)] ??= []).push(it);
  return out;
}

// ---- status presentation -----------------------------------------------------------

export const ORDER_STATUS_STYLE: Record<OrderStatus, string> = {
  received: "bg-secondary text-secondary-foreground",
  confirmed: "bg-sky-100 text-sky-800",
  carrier_confirmed: "bg-violet-100 text-violet-800",
  in_transit: "bg-amber-100 text-amber-800",
  delivered: "bg-emerald-100 text-emerald-800",
  cancelled: "bg-zinc-200 text-zinc-600",
};

export const LOAD_STATUS_STYLE: Record<LoadStatus, string> = {
  planned: "bg-secondary text-secondary-foreground",
  dispatched: "bg-sky-100 text-sky-800",
  loading: "bg-violet-100 text-violet-800",
  in_transit: "bg-amber-100 text-amber-800",
  delivered: "bg-emerald-100 text-emerald-800",
  closed: "bg-zinc-200 text-zinc-600",
};

export const BILLING_STATUS_STYLE: Record<BillingStatus, string> = {
  bol_received: "bg-secondary text-secondary-foreground",
  pricing_verified: "bg-sky-100 text-sky-800",
  ready_to_invoice: "bg-violet-100 text-violet-800",
  invoiced: "bg-amber-100 text-amber-800",
  paid: "bg-emerald-100 text-emerald-800",
};

export const INVOICE_STATUS_STYLE: Record<InvoiceStatus, string> = {
  draft: "bg-secondary text-secondary-foreground",
  pending_approval: "bg-amber-100 text-amber-800",
  approved: "bg-sky-100 text-sky-800",
  synced: "bg-violet-100 text-violet-800",
  paid: "bg-emerald-100 text-emerald-800",
  void: "bg-zinc-200 text-zinc-600",
};

export const SEVERITY_STYLE: Record<Severity, string> = {
  critical: "bg-rose-100 text-rose-800",
  warning: "bg-amber-100 text-amber-800",
  info: "bg-sky-100 text-sky-800",
};

export const CUSTOMER_STATUS_STYLE: Record<Customer["status"], string> = {
  active: "bg-emerald-100 text-emerald-800",
  on_hold: "bg-rose-100 text-rose-800",
  inactive: "bg-zinc-200 text-zinc-600",
};

export const orderStatusLabel = (s: OrderStatus): string => ORDER_STATUS_LABEL[s] ?? titleCase(s);
export const loadStatusLabel = (s: LoadStatus): string => LOAD_STATUS_LABEL[s] ?? titleCase(s);
export const billingStatusLabel = (s: BillingStatus): string => BILLING_STATUS_LABEL[s] ?? titleCase(s);

export const NEXT_LOAD_STATUS: Record<LoadStatus, LoadStatus | null> = {
  planned: "dispatched", dispatched: "in_transit", loading: "in_transit", in_transit: "delivered", delivered: "closed", closed: null,
};
export const NEXT_ORDER_STATUS: Record<OrderStatus, OrderStatus | null> = {
  received: "confirmed", confirmed: "carrier_confirmed", carrier_confirmed: "in_transit", in_transit: "delivered", delivered: null, cancelled: null,
};

export const isOpenOrder = (o: Order): boolean => !["delivered", "cancelled"].includes(o.status);

// ---- acting user (MVP stand-in for authentication) ------------------------------------

const ACTOR_KEY = "rpg.actorId";
export const DEFAULT_ACTOR_ID = "u-dana";

export function getActorId(): string {
  try {
    return typeof window !== "undefined" ? window.localStorage.getItem(ACTOR_KEY) || DEFAULT_ACTOR_ID : DEFAULT_ACTOR_ID;
  } catch {
    return DEFAULT_ACTOR_ID;
  }
}

export function setActorId(id: string): void {
  try {
    window.localStorage.setItem(ACTOR_KEY, id);
    window.dispatchEvent(new Event("rpg-actor-change"));
  } catch {
    /* ignore */
  }
}
