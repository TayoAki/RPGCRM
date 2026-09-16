import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import type { OpsStore } from "../domain/store.js";
import type { Customer, Invoice, Load, Order, PortalSession, PortalUser } from "../domain/types.js";

/**
 * Customer portal sign-in (Module G, "secure, customer-scoped login").
 * Email + password accounts per customer, scrypt-hashed; opaque bearer tokens
 * stored as sessions with a 7-day life; a short lockout after repeated
 * failures. Everything the portal shows is looked up by the session's
 * customerId, never by anything the browser supplies.
 */

export const SESSION_DAYS = 7;
const MAX_FAILURES = 5;
const LOCKOUT_MINUTES = 15;

const failures = new Map<string, { count: number; until: number }>();

export function hashPassword(password: string, salt: string): string {
  return scryptSync(password, salt, 64).toString("hex");
}

export function verifyPassword(password: string, salt: string, hash: string): boolean {
  const a = Buffer.from(hashPassword(password, salt), "hex");
  const b = Buffer.from(hash, "hex");
  return a.length === b.length && timingSafeEqual(a, b);
}

const normalizeEmail = (email: string): string => email.trim().toLowerCase();

export interface PortalLogin {
  token: string;
  expiresAt: string;
  user: { id: string; name: string; email: string };
  customer: { id: string; name: string; code: string };
}

export function portalLogin(store: OpsStore, email: string, password: string, now: Date = new Date()): PortalLogin {
  const key = normalizeEmail(email);
  const lock = failures.get(key);
  if (lock && lock.count >= MAX_FAILURES && lock.until > now.getTime()) {
    const minutes = Math.max(1, Math.ceil((lock.until - now.getTime()) / 60_000));
    throw new Error(`Too many sign-in attempts. Try again in ${minutes} minute${minutes === 1 ? "" : "s"}.`);
  }
  const user = store.all<PortalUser>("portalUsers").find((u) => u.email === key && u.status === "active");
  if (!user || !password || !verifyPassword(password, user.salt, user.passwordHash)) {
    const count = lock && lock.until > now.getTime() ? lock.count + 1 : 1;
    failures.set(key, { count, until: now.getTime() + LOCKOUT_MINUTES * 60_000 });
    throw new Error("Invalid email or password.");
  }
  failures.delete(key);
  purgeExpiredSessions(store, now);
  const customer = store.customer(user.customerId);
  const session: PortalSession = {
    id: randomBytes(32).toString("base64url"),
    portalUserId: user.id,
    customerId: user.customerId,
    createdAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + SESSION_DAYS * 86_400_000).toISOString(),
    lastSeenAt: now.toISOString(),
  };
  store.save("portalSessions", session);
  store.save("portalUsers", { ...user, lastLoginAt: now.toISOString() });
  store.audit(`portal:${user.id}`, "portal.login", "customer", customer.id, `${user.name} signed in to the customer portal`);
  return {
    token: session.id,
    expiresAt: session.expiresAt,
    user: { id: user.id, name: user.name, email: user.email },
    customer: { id: customer.id, name: customer.name, code: customer.code },
  };
}

export interface PortalIdentity {
  session: PortalSession;
  user: PortalUser;
  customer: Customer;
}

/** Resolve a bearer token to its session, dropping it if expired. */
export function portalSessionFor(store: OpsStore, token: string | undefined, now: Date = new Date()): PortalIdentity | null {
  if (!token) return null;
  const session = store.find<PortalSession>("portalSessions", token);
  if (!session) return null;
  if (session.expiresAt <= now.toISOString()) {
    store.delete("portalSessions", session.id);
    return null;
  }
  const user = store.find<PortalUser>("portalUsers", session.portalUserId);
  if (!user || user.status !== "active") return null;
  if (now.getTime() - new Date(session.lastSeenAt).getTime() > 5 * 60_000) store.save("portalSessions", { ...session, lastSeenAt: now.toISOString() });
  return { session, user, customer: store.customer(session.customerId) };
}

export function portalLogout(store: OpsStore, token: string | undefined): boolean {
  if (!token) return false;
  const session = store.find<PortalSession>("portalSessions", token);
  if (!session) return false;
  store.delete("portalSessions", token);
  store.audit(`portal:${session.portalUserId}`, "portal.logout", "customer", session.customerId, "Signed out of the customer portal");
  return true;
}

export function purgeExpiredSessions(store: OpsStore, now: Date = new Date()): number {
  const cutoff = now.toISOString();
  let n = 0;
  for (const s of store.all<PortalSession>("portalSessions")) {
    if (s.expiresAt <= cutoff) {
      store.delete("portalSessions", s.id);
      n++;
    }
  }
  return n;
}

/** Everything the portal shows for one customer: orders with milestones, deliveries, invoices. */
export function portalData(store: OpsStore, customerId: string) {
  const customer = store.customer(customerId);
  const orders = store.all<Order>("orders").filter((o) => o.customerId === customer.id);
  const loads = store.all<Load>("loads").filter((l) => l.customerId === customer.id);
  const invoices = store.all<Invoice>("invoices").filter((i) => i.customerId === customer.id && !["draft", "pending_approval", "void"].includes(i.status));
  const products = store.all<{ id: string; name: string }>("products");
  const locations = store.all<{ id: string; customerId: string; name: string; city: string; state: string }>("deliveryLocations").filter((l) => l.customerId === customer.id);
  const carriers = store.all<{ id: string; name: string }>("carriers");
  const events = store.all<{ id: string; orderId: string; to: string; occurredAt: string }>("orderEvents");
  const deliveries = store.all<{ id: string; loadId: string; deliveredAt: string; deliveredGallons: number; ticketNumber: string }>("deliveries");
  return {
    customer: { id: customer.id, name: customer.name, code: customer.code, paymentTermsDays: customer.paymentTermsDays },
    locations,
    orders: orders
      .sort((a, b) => b.requestedDate.localeCompare(a.requestedDate))
      .map((o) => {
        const load = loads.find((l) => l.orderIds.includes(o.id));
        const delivery = load ? deliveries.find((d) => d.loadId === load.id) : undefined;
        return {
          id: o.id,
          orderNumber: o.orderNumber,
          product: products.find((p) => p.id === o.productId)?.name ?? o.productId,
          gallons: o.requestedGallons,
          requestedDate: o.requestedDate,
          customerPo: o.customerPo,
          location: locations.find((l) => l.id === o.deliveryLocationId)?.name ?? "",
          status: o.status,
          milestones: events.filter((e) => e.orderId === o.id).map((e) => ({ status: e.to, at: e.occurredAt })),
          carrier: load ? carriers.find((c) => c.id === load.carrierId)?.name : undefined,
          scheduledDeliveryAt: load?.scheduledDeliveryAt,
          deliveredAt: delivery?.deliveredAt,
          deliveredGallons: delivery?.deliveredGallons,
          ticketNumber: delivery?.ticketNumber,
        };
      }),
    invoices: invoices
      .sort((a, b) => b.issueDate.localeCompare(a.issueDate))
      .map((i) => ({ invoiceNumber: i.invoiceNumber, issueDate: i.issueDate, dueDate: i.dueDate, total: i.total, status: i.status })),
  };
}
