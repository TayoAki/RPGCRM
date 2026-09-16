import type {
  ExceptionType,
  OpsException,
  OpsState,
  Severity,
} from "../domain/types.js";
import type { PriceRequest, PriceResult } from "../pricing/engine.js";

/**
 * Data-integrity checkpoints (Module F and the plan's cross-cutting section).
 * Each rule is a function over the state; the evaluator runs them all and the
 * reconciler turns the result into open/auto-resolved exception rows. Rules are
 * listed in one table so they can be extended without touching the workflow code.
 */

export interface DetectedException {
  type: ExceptionType;
  severity: Severity;
  entityType: OpsException["entityType"];
  entityId: string;
  message: string;
}

export const LOW_MARGIN_PER_GALLON = 0.04;
const HOURS = 3_600_000;

type Rule = (state: OpsState, now: Date, pricing: (req: PriceRequest) => PriceResult) => DetectedException[];

const label = (state: OpsState, customerId: string): string =>
  state.customers.find((c) => c.id === customerId)?.name ?? customerId;

export const RULES: Record<ExceptionType, Rule> = {
  missing_bol: (s, now) =>
    s.loads
      .filter(
        (l) =>
          !l.bolId &&
          ["loading", "in_transit", "delivered"].includes(l.status) &&
          new Date(l.scheduledPickupAt).getTime() < now.getTime() - 6 * HOURS,
      )
      .map((l) => ({
        type: "missing_bol",
        severity: l.status === "delivered" ? "critical" : "warning",
        entityType: "load",
        entityId: l.id,
        message: `Load ${l.loadNumber} (${label(s, l.customerId)}) is ${l.status} with no BOL on file`,
      })),

  unassigned_customer: (s) =>
    s.bols
      .filter((b) => b.matchStatus === "unmatched")
      .map((b) => ({
        type: "unassigned_customer",
        severity: "warning",
        entityType: "bol",
        entityId: b.id,
        message: `BOL ${b.bolNumber} for "${b.destinationText}" is not matched to any load or customer`,
      })),

  duplicate_bol: (s) =>
    s.bols
      .filter((b) => b.matchStatus === "duplicate")
      .map((b) => ({
        type: "duplicate_bol",
        severity: "info",
        entityType: "bol",
        entityId: b.id,
        message: `BOL ${b.bolNumber} was received twice; the duplicate was ignored`,
      })),

  pricing_missing: (s, _now, pricing) =>
    s.orders
      .filter((o) => !["delivered", "cancelled"].includes(o.status))
      .flatMap((o) => {
        const r = pricing({
          customerId: o.customerId,
          productId: o.productId,
          deliveryLocationId: o.deliveryLocationId,
          date: o.requestedDate,
        });
        if (r.ok) return [];
        return [
          {
            type: "pricing_missing" as const,
            severity: "critical" as const,
            entityType: "order" as const,
            entityId: o.id,
            message: `Order ${o.orderNumber} (${label(s, o.customerId)}) cannot be priced: ${r.message}`,
          },
        ];
      }),

  pricing_mismatch: (s, _now, pricing) =>
    s.invoices
      .filter((i) => ["draft", "pending_approval"].includes(i.status))
      .flatMap((inv) => {
        const load = s.loads.find((l) => l.id === inv.loadId);
        const bol = load?.bolId ? s.bols.find((b) => b.id === load.bolId) : undefined;
        if (!load || !bol) return [];
        const r = pricing({
          customerId: inv.customerId,
          productId: load.productId,
          terminalId: load.terminalId,
          deliveryLocationId: load.deliveryLocationId,
          date: bol.liftedAt,
        });
        if (!r.ok) return [];
        const current = Math.round((r.price.basisValue + r.price.differential) * 10000) / 10000;
        const billed = inv.lines[0]?.pricePerGallon ?? current;
        if (Math.abs(current - billed) <= 0.005) return [];
        return [
          {
            type: "pricing_mismatch" as const,
            severity: "warning" as const,
            entityType: "invoice" as const,
            entityId: inv.id,
            message: `Invoice ${inv.invoiceNumber} bills $${billed.toFixed(4)}/gal but the current rule prices $${current.toFixed(4)}/gal`,
          },
        ];
      }),

  uninvoiced_load: (s, now) =>
    s.loads
      .filter((l) => {
        if (l.status !== "delivered" || !l.bolId) return false;
        if (!l.billingStatus || ["invoiced", "paid"].includes(l.billingStatus)) return false;
        const delivery = s.deliveries.find((d) => d.loadId === l.id);
        const at = delivery?.deliveredAt ?? l.scheduledDeliveryAt;
        return new Date(at).getTime() < now.getTime() - 48 * HOURS;
      })
      .map((l) => ({
        type: "uninvoiced_load",
        severity: "warning",
        entityType: "load",
        entityId: l.id,
        message: `Load ${l.loadNumber} (${label(s, l.customerId)}) delivered more than 2 days ago and is still ${l.billingStatus?.replace(/_/g, " ")}`,
      })),

  low_margin: (s) =>
    s.loadMargins
      .filter((m) => m.profitPerGallon !== null && m.profitPerGallon >= 0 && m.profitPerGallon < LOW_MARGIN_PER_GALLON)
      .map((m) => ({
        type: "low_margin",
        severity: "warning",
        entityType: "load",
        entityId: m.loadId,
        message: `Load ${s.loads.find((l) => l.id === m.loadId)?.loadNumber ?? m.loadId} earned $${m.profitPerGallon!.toFixed(4)}/gal (below $${LOW_MARGIN_PER_GALLON.toFixed(2)})`,
      })),

  loss_load: (s) =>
    s.loadMargins
      .filter((m) => m.profitPerGallon !== null && m.profitPerGallon < 0)
      .map((m) => ({
        type: "loss_load",
        severity: "critical",
        entityType: "load",
        entityId: m.loadId,
        message: `Load ${s.loads.find((l) => l.id === m.loadId)?.loadNumber ?? m.loadId} lost $${Math.abs(m.actualGrossProfit ?? 0).toFixed(2)}`,
      })),

  credit_hold: (s) =>
    s.orders
      .filter((o) => !["delivered", "cancelled"].includes(o.status))
      .filter((o) => o.creditHold || s.customers.find((c) => c.id === o.customerId)?.status === "on_hold")
      .map((o) => ({
        type: "credit_hold",
        severity: "warning",
        entityType: "order",
        entityId: o.id,
        message: `Order ${o.orderNumber} for ${label(s, o.customerId)} is on credit hold; do not dispatch`,
      })),

  stale_index: (s, now) =>
    s.priceIndexes
      .flatMap((idx) => {
        const latest = s.indexPrices
          .filter((p) => p.indexId === idx.id)
          .reduce<string>((m, p) => (p.date > m ? p.date : m), "");
        const ageDays = latest ? (now.getTime() - new Date(`${latest}T00:00:00Z`).getTime()) / (24 * HOURS) : 999;
        if (ageDays <= 2) return [];
        return [
          {
            type: "stale_index" as const,
            severity: "info" as const,
            entityType: "index" as const,
            entityId: idx.id,
            message: `${idx.code} has no value since ${latest || "never"}; refresh the market feed`,
          },
        ];
      }),
};

export function detectExceptions(
  state: OpsState,
  now: Date,
  pricing: (req: PriceRequest) => PriceResult,
): DetectedException[] {
  return (Object.values(RULES) as Rule[]).flatMap((rule) => rule(state, now, pricing));
}

export const exceptionKey = (e: { type: ExceptionType; entityId: string }): string => `${e.type}:${e.entityId}`;

/** Diff detected conditions against stored exceptions. Returns rows to save. */
export function reconcileExceptions(
  existing: OpsException[],
  detected: DetectedException[],
  nextId: () => string,
  now: Date,
): { changed: OpsException[]; opened: number; autoResolved: number } {
  const changed: OpsException[] = [];
  const byKey = new Map(existing.map((e) => [exceptionKey(e), e]));
  const seen = new Set<string>();
  let opened = 0;
  let autoResolved = 0;
  for (const d of detected) {
    const key = exceptionKey(d);
    seen.add(key);
    const cur = byKey.get(key);
    if (!cur || cur.status === "resolved") {
      if (cur && cur.status === "resolved" && cur.resolvedBy && cur.resolvedBy !== "system") continue; // human closed it; do not reopen
      changed.push({
        id: cur?.id ?? nextId(),
        ...d,
        detectedAt: now.toISOString(),
        status: "open",
      });
      opened++;
    } else if (cur.message !== d.message || cur.severity !== d.severity) {
      changed.push({ ...cur, message: d.message, severity: d.severity });
    }
  }
  for (const e of existing) {
    if (e.status === "resolved") continue;
    if (!seen.has(exceptionKey(e))) {
      changed.push({
        ...e,
        status: "resolved",
        resolvedBy: "system",
        resolvedAt: now.toISOString(),
        resolutionNote: "Auto-resolved: condition no longer detected",
      });
      autoResolved++;
    }
  }
  return { changed, opened, autoResolved };
}
