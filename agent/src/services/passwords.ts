import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";

/**
 * Password hashing and sign-in lockout shared by staff and customer portal
 * accounts. scrypt with a per-user salt; constant-time comparison; a short
 * lockout after repeated failures keyed by the (normalized) email.
 */

export function newSalt(): string {
  return randomBytes(16).toString("hex");
}

export function hashPassword(password: string, salt: string): string {
  return scryptSync(password, salt, 64).toString("hex");
}

export function verifyPassword(password: string, salt: string, hash: string): boolean {
  if (!salt || !hash) return false;
  const a = Buffer.from(hashPassword(password, salt), "hex");
  const b = Buffer.from(hash, "hex");
  return a.length === b.length && timingSafeEqual(a, b);
}

export const normalizeEmail = (email: string): string => email.trim().toLowerCase();

/** In-process failure counter; move to shared storage when the agent runs more than one replica. */
export class Lockout {
  private readonly failures = new Map<string, { count: number; until: number }>();

  constructor(private readonly maxFailures = 5, private readonly minutes = 15) {}

  /** Throws when the key has exhausted its attempts and the lockout has not lapsed. */
  check(key: string, now: Date): void {
    const lock = this.failures.get(key);
    if (lock && lock.count >= this.maxFailures && lock.until > now.getTime()) {
      const minutes = Math.max(1, Math.ceil((lock.until - now.getTime()) / 60_000));
      throw new Error(`Too many sign-in attempts. Try again in ${minutes} minute${minutes === 1 ? "" : "s"}.`);
    }
  }

  fail(key: string, now: Date): void {
    const lock = this.failures.get(key);
    const count = lock && lock.until > now.getTime() ? lock.count + 1 : 1;
    this.failures.set(key, { count, until: now.getTime() + this.minutes * 60_000 });
  }

  clear(key: string): void {
    this.failures.delete(key);
  }
}
