import { describe, it, expect } from "vitest";
import { portalData, portalLogin, portalLogout, portalSessionFor, purgeExpiredSessions, SESSION_DAYS } from "../services/portal.js";
import { PORTAL_DEMO_PASSWORD } from "../domain/seed.js";
import { freshStore, NOW } from "./helpers.js";

describe("customer portal sign-in (Module G)", () => {
  it("signs in a seeded customer account with the demo password and scopes data to that customer", () => {
    const store = freshStore();
    const login = portalLogin(store, "Orders@LoneStarAggregates.com", PORTAL_DEMO_PASSWORD, NOW);
    expect(login.customer.id).toBe("cust-lsa");
    expect(login.token.length).toBeGreaterThan(30);
    const identity = portalSessionFor(store, login.token, NOW)!;
    expect(identity.customer.id).toBe("cust-lsa");
    const data = portalData(store, identity.customer.id);
    expect(data.orders.length).toBeGreaterThan(0);
    expect(data.orders.every((o) => store.order(o.id).customerId === "cust-lsa")).toBe(true);
    expect(data.invoices.every((i) => store.all<any>("invoices").find((x) => x.invoiceNumber === i.invoiceNumber).customerId === "cust-lsa")).toBe(true);
    const audit = store.all<any>("auditLog").at(-1);
    expect(audit.action).toBe("portal.login");
  });

  it("rejects wrong passwords and unknown emails with the same message, then locks after repeated failures", () => {
    const store = freshStore();
    expect(() => portalLogin(store, "orders@lonestaraggregates.com", "nope", NOW)).toThrow(/Invalid email or password/);
    expect(() => portalLogin(store, "nobody@example.com", PORTAL_DEMO_PASSWORD, NOW)).toThrow(/Invalid email or password/);
    for (let i = 0; i < 5; i++) expect(() => portalLogin(store, "fuel@quickstopmarkets.com", "wrong", NOW)).toThrow(/Invalid email or password/);
    // The sixth attempt is refused even with the right password, until the lockout lapses.
    expect(() => portalLogin(store, "fuel@quickstopmarkets.com", PORTAL_DEMO_PASSWORD, NOW)).toThrow(/Too many sign-in attempts/);
    const later = new Date(NOW.getTime() + 16 * 60_000);
    expect(portalLogin(store, "fuel@quickstopmarkets.com", PORTAL_DEMO_PASSWORD, later).customer.id).toBe("cust-qsm");
  });

  it("expires sessions, signs out, and never puts credentials or sessions in the UI snapshot", () => {
    const store = freshStore();
    const login = portalLogin(store, "dispatch@prairietrucking.com", PORTAL_DEMO_PASSWORD, NOW);
    const afterExpiry = new Date(NOW.getTime() + (SESSION_DAYS + 1) * 86_400_000);
    expect(portalSessionFor(store, login.token, afterExpiry)).toBeNull();
    expect(store.find("portalSessions", login.token)).toBeUndefined();
    const again = portalLogin(store, "dispatch@prairietrucking.com", PORTAL_DEMO_PASSWORD, NOW);
    expect(portalLogout(store, again.token)).toBe(true);
    expect(portalSessionFor(store, again.token, NOW)).toBeNull();
    expect(portalSessionFor(store, undefined, NOW)).toBeNull();
    portalLogin(store, "dispatch@prairietrucking.com", PORTAL_DEMO_PASSWORD, NOW);
    expect(purgeExpiredSessions(store, afterExpiry)).toBe(1);
    const ui = store.uiSnapshot(NOW);
    expect(ui.portalSessions).toEqual([]);
    expect(ui.portalUsers.length).toBe(store.all("customers").length);
    expect(ui.portalUsers.every((u) => u.passwordHash === "" && u.salt === "")).toBe(true);
    expect(JSON.stringify(ui)).not.toContain("portalToken");
  });
});
