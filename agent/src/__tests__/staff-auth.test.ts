import { describe, it, expect } from "vitest";
import { changeStaffPassword, purgeExpiredStaffSessions, staffLogin, staffLogout, staffSessionFor, STAFF_SESSION_DAYS } from "../services/staffAuth.js";
import { currentActor, currentStaff, runAsActor } from "../services/actor.js";
import { STAFF_DEMO_PASSWORD } from "../domain/seed.js";
import { freshStore, NOW } from "./helpers.js";

describe("staff sign-in (AUTH_PLAN Phase 1)", () => {
  it("signs in a seeded staff account with the demo password and resolves the session to that user", () => {
    const store = freshStore();
    const login = staffLogin(store, "  Dana@RPGFuel.example ", STAFF_DEMO_PASSWORD, NOW);
    expect(login.user).toEqual({ id: "u-dana", name: "Dana Whitfield", email: "dana@rpgfuel.example", role: "management" });
    expect(login.token.length).toBeGreaterThan(30);
    expect(login.expiresAt).toBe(new Date(NOW.getTime() + STAFF_SESSION_DAYS * 86_400_000).toISOString());
    const identity = staffSessionFor(store, login.token, NOW)!;
    expect(identity.user.id).toBe("u-dana");
    expect(identity.session.staffUserId).toBe("u-dana");
    expect(store.require<any>("staff", "u-dana").lastLoginAt).toBe(NOW.toISOString());
    expect(store.all<any>("auditLog").at(-1).action).toBe("auth.login");
  });

  it("rejects wrong passwords and unknown emails with one message, then locks after repeated failures", () => {
    const store = freshStore();
    expect(() => staffLogin(store, "marcus@rpgfuel.example", "nope", NOW)).toThrow(/Invalid email or password/);
    expect(() => staffLogin(store, "nobody@rpgfuel.example", STAFF_DEMO_PASSWORD, NOW)).toThrow(/Invalid email or password/);
    expect(() => staffLogin(store, "marcus@rpgfuel.example", "", NOW)).toThrow(/Invalid email or password/);
    for (let i = 0; i < 3; i++) expect(() => staffLogin(store, "marcus@rpgfuel.example", "wrong", NOW)).toThrow(/Invalid email or password/);
    // Five failures: the sixth attempt is refused even with the right password until the lockout lapses.
    expect(() => staffLogin(store, "marcus@rpgfuel.example", STAFF_DEMO_PASSWORD, NOW)).toThrow(/Too many sign-in attempts/);
    const later = new Date(NOW.getTime() + 16 * 60_000);
    expect(staffLogin(store, "marcus@rpgfuel.example", STAFF_DEMO_PASSWORD, later).user.id).toBe("u-marcus");
  });

  it("expires sessions, signs out, refuses disabled accounts, and never puts credentials or sessions in the UI snapshot", () => {
    const store = freshStore();
    const login = staffLogin(store, "priya@rpgfuel.example", STAFF_DEMO_PASSWORD, NOW);
    const afterExpiry = new Date(NOW.getTime() + (STAFF_SESSION_DAYS + 1) * 86_400_000);
    expect(staffSessionFor(store, login.token, afterExpiry)).toBeNull();
    expect(store.find("staffSessions", login.token)).toBeUndefined();
    const again = staffLogin(store, "priya@rpgfuel.example", STAFF_DEMO_PASSWORD, NOW);
    expect(staffLogout(store, again.token)).toBe(true);
    expect(staffLogout(store, again.token)).toBe(false);
    expect(staffSessionFor(store, again.token, NOW)).toBeNull();
    expect(staffSessionFor(store, undefined, NOW)).toBeNull();
    expect(staffSessionFor(store, "forged-token", NOW)).toBeNull();
    const third = staffLogin(store, "priya@rpgfuel.example", STAFF_DEMO_PASSWORD, NOW);
    store.save("staff", { ...store.require<any>("staff", "u-priya"), status: "disabled" });
    expect(staffSessionFor(store, third.token, NOW)).toBeNull();
    expect(() => staffLogin(store, "priya@rpgfuel.example", STAFF_DEMO_PASSWORD, NOW)).toThrow(/Invalid email or password/);
    staffLogin(store, "sam@rpgfuel.example", STAFF_DEMO_PASSWORD, NOW);
    expect(purgeExpiredStaffSessions(store, afterExpiry)).toBe(2);
    const ui = store.uiSnapshot(NOW);
    expect(ui.staffSessions).toEqual([]);
    expect(ui.staff.length).toBe(5);
    expect(ui.staff.every((u) => u.passwordHash === "" && u.salt === "")).toBe(true);
    expect(JSON.stringify(ui)).not.toContain(third.token);
  });

  it("changes a password with the current one, keeps the calling session, and signs out the others", () => {
    const store = freshStore();
    const a = staffLogin(store, "elena@rpgfuel.example", STAFF_DEMO_PASSWORD, NOW);
    const b = staffLogin(store, "elena@rpgfuel.example", STAFF_DEMO_PASSWORD, NOW);
    expect(() => changeStaffPassword(store, "u-elena", "wrong", "Longer-secret-1", a.token, NOW)).toThrow(/Current password is incorrect/);
    expect(() => changeStaffPassword(store, "u-elena", STAFF_DEMO_PASSWORD, "short", a.token, NOW)).toThrow(/at least 10 characters/);
    expect(() => changeStaffPassword(store, "u-elena", STAFF_DEMO_PASSWORD, STAFF_DEMO_PASSWORD, a.token, NOW)).toThrow(/must differ/);
    changeStaffPassword(store, "u-elena", STAFF_DEMO_PASSWORD, "Longer-secret-1", a.token, NOW);
    expect(staffSessionFor(store, a.token, NOW)?.user.id).toBe("u-elena");
    expect(staffSessionFor(store, b.token, NOW)).toBeNull();
    expect(() => staffLogin(store, "elena@rpgfuel.example", STAFF_DEMO_PASSWORD, NOW)).toThrow(/Invalid email or password/);
    expect(staffLogin(store, "elena@rpgfuel.example", "Longer-secret-1", NOW).user.id).toBe("u-elena");
    expect(store.all<any>("auditLog").some((e) => e.action === "auth.password_changed" && e.actorId === "u-elena")).toBe(true);
  });

  it("attributes work to the signed-in user only inside a request context", async () => {
    expect(() => currentActor()).toThrow(/Please sign in/);
    expect(currentStaff()).toBeUndefined();
    const user = { id: "u-marcus", name: "Marcus Lee", email: "marcus@rpgfuel.example", role: "dispatch" as const };
    expect(runAsActor(user, () => currentActor())).toBe("u-marcus");
    expect(runAsActor(user, () => currentStaff()?.role)).toBe("dispatch");
    // The context follows async continuations, which is how tools inside an agent run see it.
    const later = await runAsActor(user, async () => {
      await new Promise((r) => setTimeout(r, 2));
      return currentActor();
    });
    expect(later).toBe("u-marcus");
    expect(currentStaff()).toBeUndefined();
  });
});

describe("startup migration and demo reset (staff)", () => {
  it("adds sign-in credentials to staff rows that predate authentication", () => {
    const store = freshStore();
    for (const u of store.all<any>("staff")) store.save("staff", { id: u.id, name: u.name, email: u.email, role: u.role });
    expect(store.migrate(NOW)).toEqual(["staff_accounts"]);
    expect(store.all<any>("staff").every((u) => u.passwordHash && u.salt && u.status === "active")).toBe(true);
    expect(staffLogin(store, "dana@rpgfuel.example", STAFF_DEMO_PASSWORD, NOW).user.id).toBe("u-dana");
    expect(store.migrate(NOW)).toEqual([]);
  });

  it("keeps logins, changed passwords, and sessions across a demo reset", () => {
    const store = freshStore();
    const login = staffLogin(store, "sam@rpgfuel.example", STAFF_DEMO_PASSWORD, NOW);
    changeStaffPassword(store, "u-sam", STAFF_DEMO_PASSWORD, "Sam-new-secret-9", login.token, NOW);
    store.reseed(NOW);
    expect(store.all("orders").length).toBeGreaterThan(0);
    expect(staffSessionFor(store, login.token, NOW)?.user.id).toBe("u-sam");
    expect(staffLogin(store, "sam@rpgfuel.example", "Sam-new-secret-9", NOW).user.id).toBe("u-sam");
  });

  it("uses STAFF_BOOTSTRAP_PASSWORD for new accounts when it is set", () => {
    process.env.STAFF_BOOTSTRAP_PASSWORD = "Bootstrap-pass-1";
    try {
      const store = freshStore();
      expect(() => staffLogin(store, "priya@rpgfuel.example", STAFF_DEMO_PASSWORD, NOW)).toThrow(/Invalid email or password/);
      expect(staffLogin(store, "priya@rpgfuel.example", "Bootstrap-pass-1", NOW).user.id).toBe("u-priya");
    } finally {
      delete process.env.STAFF_BOOTSTRAP_PASSWORD;
    }
  });
});
