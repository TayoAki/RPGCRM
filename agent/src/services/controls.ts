import type { OpsStore } from "../domain/store.js";
import type { Load, LoadMargin, OpsException } from "../domain/types.js";
import { recomputeExceptions } from "./context.js";

export interface TriagedException extends OpsException {
  rank: number;
  score: number;
  moneyAtRisk: number;
  ageHours: number;
  nextStep: string;
}

const SEVERITY_WEIGHT: Record<OpsException["severity"], number> = { critical: 1000, warning: 400, info: 50 };

const NEXT_STEP: Record<OpsException["type"], string> = {
  missing_bol: "Request the BOL from the supplier or enter it manually from the driver's copy.",
  unassigned_customer: "Match the BOL to a load, or create the order it belongs to.",
  duplicate_bol: "Confirm the original BOL is correct; no action needed on the duplicate.",
  pricing_missing: "Activate or create a pricing rule for this customer and product.",
  pricing_mismatch: "Re-price the invoice or confirm the contract price with pricing.",
  uninvoiced_load: "Verify pricing and prepare the invoice.",
  low_margin: "Review the differential and freight for this lane before the next order.",
  loss_load: "Check the rack cost and the price applied; escalate to management.",
  credit_hold: "Hold dispatch until billing releases the hold.",
  stale_index: "Refresh the market feed.",
};

/** Rank open exceptions by severity, money at risk, and age (Module F). */
export function triageExceptions(store: OpsStore, now: Date = new Date(), topN = 5): { priorities: TriagedException[]; rest: TriagedException[]; totalOpen: number } {
  recomputeExceptions(store, now);
  const open = store.all<OpsException>("exceptions").filter((e) => e.status !== "resolved");
  const margins = store.all<LoadMargin>("loadMargins");
  const loads = store.all<Load>("loads");
  const ranked = open
    .map((e) => {
      let money = 0;
      if (e.entityType === "load") {
        const m = margins.find((x) => x.loadId === e.entityId);
        const l = loads.find((x) => x.id === e.entityId);
        money = m?.revenue ?? (l ? l.plannedGallons * 3 : 0);
      } else if (e.entityType === "invoice") {
        money = store.find<{ id: string; total: number }>("invoices", e.entityId)?.total ?? 0;
      } else if (e.entityType === "order") {
        const o = store.find<{ id: string; requestedGallons: number }>("orders", e.entityId);
        money = (o?.requestedGallons ?? 0) * 3;
      } else if (e.entityType === "bol") {
        const b = store.find<{ id: string; lines: { netGallons: number; supplierCostPerGallon: number }[] }>("bols", e.entityId);
        money = b?.lines.reduce((s, l) => s + l.netGallons * l.supplierCostPerGallon, 0) ?? 0;
      }
      const ageHours = Math.max(0, (now.getTime() - new Date(e.detectedAt).getTime()) / 3_600_000);
      const score = SEVERITY_WEIGHT[e.severity] + money / 100 + Math.min(ageHours, 72) * 5;
      return { ...e, rank: 0, score: Math.round(score), moneyAtRisk: Math.round(money), ageHours: Math.round(ageHours), nextStep: NEXT_STEP[e.type] };
    })
    .sort((a, b) => b.score - a.score)
    .map((e, i) => ({ ...e, rank: i + 1 }));
  return { priorities: ranked.slice(0, topN), rest: ranked.slice(topN), totalOpen: ranked.length };
}

export function resolveException(store: OpsStore, id: string, actorId: string, note: string, now: Date = new Date()): OpsException {
  const e = store.require<OpsException>("exceptions", id);
  const updated: OpsException = { ...e, status: "resolved", resolvedBy: actorId, resolvedAt: now.toISOString(), resolutionNote: note };
  store.save("exceptions", updated);
  store.audit(actorId, "exception.resolved", "exception", e.id, note);
  return updated;
}

export function acknowledgeException(store: OpsStore, id: string, actorId: string): OpsException {
  const e = store.require<OpsException>("exceptions", id);
  const updated: OpsException = { ...e, status: "acknowledged" };
  store.save("exceptions", updated);
  store.audit(actorId, "exception.acknowledged", "exception", e.id, "");
  return updated;
}
