import { OpsStore } from "../domain/store.js";
import { openDb } from "../domain/db.js";

/** Fresh in-memory store seeded relative to a fixed "now" (deterministic dates). */
export const NOW = new Date("2026-09-16T15:00:00.000Z");

export function freshStore(now: Date = NOW): OpsStore {
  const store = new OpsStore(openDb(":memory:"));
  store.reseed(now);
  return store;
}
