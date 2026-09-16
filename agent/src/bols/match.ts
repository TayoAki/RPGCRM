import { createHash } from "node:crypto";
import type { Bol, Customer, Load } from "../domain/types.js";

/** Stable identity of a BOL for duplicate detection. */
export function dedupeHash(b: { supplierId: string; bolNumber: string }): string {
  return createHash("sha1")
    .update(`${b.supplierId}|${b.bolNumber.trim().toUpperCase()}`)
    .digest("hex")
    .slice(0, 16);
}

const MATCHABLE: Load["status"][] = ["dispatched", "loading", "in_transit", "delivered"];

/** Higher is better; below MATCH_THRESHOLD is not a match. */
export function scoreLoadMatch(
  bol: Pick<Bol, "terminalId" | "carrierId" | "liftedAt" | "customerRef" | "lines">,
  load: Load,
  customers: Customer[],
): number {
  if (load.bolId) return -1;
  if (!MATCHABLE.includes(load.status)) return -1;
  if (load.terminalId !== bol.terminalId) return -1;
  const product = bol.lines[0]?.productId;
  if (product && load.productId !== product) return -1;
  let score = 2; // terminal + product agree
  if (load.carrierId === bol.carrierId) score += 3;
  const hours = Math.abs(new Date(bol.liftedAt).getTime() - new Date(load.scheduledPickupAt).getTime()) / 36e5;
  if (hours <= 12) score += 3;
  else if (hours <= 36) score += 1;
  else return -1;
  const customer = customers.find((c) => c.id === load.customerId);
  const ref = bol.customerRef.trim().toUpperCase();
  if (customer && ref && (ref === customer.code.toUpperCase() || customer.name.toUpperCase().includes(ref)))
    score += 3;
  const gallons = bol.lines[0]?.grossGallons ?? 0;
  if (gallons && Math.abs(gallons - load.plannedGallons) / load.plannedGallons <= 0.05) score += 1;
  return score;
}

export const MATCH_THRESHOLD = 6;

export function findBestLoad(
  bol: Pick<Bol, "terminalId" | "carrierId" | "liftedAt" | "customerRef" | "lines">,
  loads: Load[],
  customers: Customer[],
): { load: Load; score: number } | undefined {
  let best: { load: Load; score: number } | undefined;
  for (const load of loads) {
    const score = scoreLoadMatch(bol, load, customers);
    if (score >= MATCH_THRESHOLD && (!best || score > best.score)) best = { load, score };
  }
  return best;
}
