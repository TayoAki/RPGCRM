import { AsyncLocalStorage } from "node:async_hooks";

/**
 * Who is acting. HTTP routes read the `x-actor-id` header; agent runs read
 * `forwardedProps.actorId` from the AG-UI request and enter this context at
 * the start of the run so tools can attribute their mutations. Until real
 * authentication lands (see AUTH_PLAN.md) the default is the management user.
 */
export const DEFAULT_ACTOR = "u-dana";

const storage = new AsyncLocalStorage<{ actorId: string }>();

export function enterActor(actorId: string | undefined): void {
  storage.enterWith({ actorId: actorId || DEFAULT_ACTOR });
}

export function runAsActor<T>(actorId: string | undefined, fn: () => T): T {
  return storage.run({ actorId: actorId || DEFAULT_ACTOR }, fn);
}

export function currentActor(): string {
  return storage.getStore()?.actorId ?? DEFAULT_ACTOR;
}
