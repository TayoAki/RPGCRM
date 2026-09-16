import { AsyncLocalStorage } from "node:async_hooks";
import type { StaffRole } from "../domain/types.js";

/**
 * Who is acting. The staff auth gate (services/staffAuth.ts) resolves the
 * bearer session on every request and runs the rest of the request inside
 * this context, so REST handlers and copilot tools attribute their mutations
 * to the signed-in user without threading an id through every call.
 */

export interface ActingUser {
  id: string;
  name: string;
  email: string;
  role: StaffRole;
}

const storage = new AsyncLocalStorage<{ user: ActingUser }>();

export function runAsActor<T>(user: ActingUser, fn: () => T): T {
  return storage.run({ user }, fn);
}

/** The signed-in user's id. Throws outside a signed-in request: nothing is attributed to a default user. */
export function currentActor(): string {
  const user = storage.getStore()?.user;
  if (!user) throw new Error("No signed-in user for this request. Please sign in.");
  return user.id;
}

/** The signed-in user, or undefined outside a signed-in request. */
export function currentStaff(): ActingUser | undefined {
  return storage.getStore()?.user;
}
