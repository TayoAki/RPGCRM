import { randomBytes } from "node:crypto";
import type { NextFunction, Request, Response } from "express";
import type { OpsStore } from "../domain/store.js";
import type { StaffSession, StaffUser } from "../domain/types.js";
import { Lockout, hashPassword, newSalt, normalizeEmail, verifyPassword } from "./passwords.js";
import { runAsActor } from "./actor.js";
import type { ActingUser } from "./actor.js";

/**
 * Staff sign-in (AUTH_PLAN Phase 1, "lock the door"). Email + password
 * accounts in the store, scrypt-hashed; opaque bearer tokens stored as
 * sessions with a 7-day life; lockout after repeated failures. The Express
 * gate below refuses every workspace route and the agent endpoint without a
 * valid session and runs the request as that user.
 */

export const STAFF_SESSION_DAYS = 7;
export const MIN_PASSWORD_LENGTH = 10;

const lockout = new Lockout();

export const publicStaff = (u: StaffUser): ActingUser => ({ id: u.id, name: u.name, email: u.email, role: u.role });

export interface StaffLogin {
  token: string;
  expiresAt: string;
  user: ActingUser;
}

export function staffLogin(store: OpsStore, email: string, password: string, now: Date = new Date()): StaffLogin {
  const key = normalizeEmail(email);
  lockout.check(key, now);
  const user = store.all<StaffUser>("staff").find((u) => normalizeEmail(u.email) === key && u.status !== "disabled");
  if (!user || !password || !verifyPassword(password, user.salt, user.passwordHash)) {
    lockout.fail(key, now);
    throw new Error("Invalid email or password.");
  }
  lockout.clear(key);
  purgeExpiredStaffSessions(store, now);
  const session: StaffSession = {
    id: randomBytes(32).toString("base64url"),
    staffUserId: user.id,
    createdAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + STAFF_SESSION_DAYS * 86_400_000).toISOString(),
    lastSeenAt: now.toISOString(),
  };
  store.save("staffSessions", session);
  store.save("staff", { ...user, lastLoginAt: now.toISOString() });
  store.audit(user.id, "auth.login", "staff", user.id, `${user.name} signed in`);
  return { token: session.id, expiresAt: session.expiresAt, user: publicStaff(user) };
}

export interface StaffIdentity {
  session: StaffSession;
  user: StaffUser;
}

/** Resolve a bearer token to its session, dropping it if expired or if the account was disabled. */
export function staffSessionFor(store: OpsStore, token: string | undefined, now: Date = new Date()): StaffIdentity | null {
  if (!token) return null;
  const session = store.find<StaffSession>("staffSessions", token);
  if (!session) return null;
  if (session.expiresAt <= now.toISOString()) {
    store.delete("staffSessions", session.id);
    return null;
  }
  const user = store.find<StaffUser>("staff", session.staffUserId);
  if (!user || user.status === "disabled") return null;
  if (now.getTime() - new Date(session.lastSeenAt).getTime() > 5 * 60_000) store.save("staffSessions", { ...session, lastSeenAt: now.toISOString() });
  return { session, user };
}

export function staffLogout(store: OpsStore, token: string | undefined): boolean {
  if (!token) return false;
  const session = store.find<StaffSession>("staffSessions", token);
  if (!session) return false;
  store.delete("staffSessions", token);
  store.audit(session.staffUserId, "auth.logout", "staff", session.staffUserId, "Signed out");
  return true;
}

export function purgeExpiredStaffSessions(store: OpsStore, now: Date = new Date()): number {
  const cutoff = now.toISOString();
  let n = 0;
  for (const s of store.all<StaffSession>("staffSessions")) {
    if (s.expiresAt <= cutoff) {
      store.delete("staffSessions", s.id);
      n++;
    }
  }
  return n;
}

/**
 * Change the signed-in user's password. Requires the current password, keeps
 * the session that made the change, and revokes every other session for the
 * account (a changed password signs out other devices).
 */
export function changeStaffPassword(store: OpsStore, userId: string, currentPassword: string, newPassword: string, keepSessionId?: string, now: Date = new Date()): void {
  const user = store.require<StaffUser>("staff", userId);
  if (!verifyPassword(currentPassword, user.salt, user.passwordHash)) throw new Error("Current password is incorrect.");
  if (newPassword.length < MIN_PASSWORD_LENGTH) throw new Error(`New password must be at least ${MIN_PASSWORD_LENGTH} characters.`);
  if (newPassword === currentPassword) throw new Error("New password must differ from the current one.");
  const salt = newSalt();
  store.save("staff", { ...user, salt, passwordHash: hashPassword(newPassword, salt) });
  for (const s of store.all<StaffSession>("staffSessions")) {
    if (s.staffUserId === userId && s.id !== keepSessionId) store.delete("staffSessions", s.id);
  }
  store.audit(userId, "auth.password_changed", "staff", userId, `${user.name} changed their password${keepSessionId ? "; other sessions signed out" : ""}`);
  void now;
}

// ---- Express gate ----------------------------------------------------------

export function bearerToken(req: Request): string | undefined {
  const h = req.header("authorization") ?? "";
  return h.toLowerCase().startsWith("bearer ") ? h.slice(7).trim() : undefined;
}

/** Routes reachable without a staff session: the health check, staff sign-in itself, and the customer portal. */
export function isPublicPath(req: Request): boolean {
  if (req.method === "OPTIONS") return true;
  const p = req.path;
  return p === "/ping" || p === "/auth/login" || p === "/portal" || p.startsWith("/portal/");
}

/**
 * Refuse everything else without a valid `Authorization: Bearer <session>`
 * and run the request as the signed-in user. `x-actor-id` and anything else
 * the caller sends about identity is ignored.
 */
export function staffAuthGate(store: OpsStore) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (isPublicPath(req)) {
      next();
      return;
    }
    const identity = staffSessionFor(store, bearerToken(req));
    if (!identity) {
      res.status(401).json({ error: "Please sign in." });
      return;
    }
    res.locals.staff = identity;
    runAsActor(publicStaff(identity.user), next);
  };
}
