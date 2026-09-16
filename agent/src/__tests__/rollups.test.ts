import { describe, it, expect } from "vitest";
import { periodRollups, periodStart, rollupTotals } from "../analytics.js";
import { freshStore, NOW } from "./helpers.js";

const now = new Date(NOW);
const today = now.toISOString().slice(0, 10);

describe("period rollups (Module B: totals by day, week, month)", () => {
  it("starts weeks on Monday and months on the first", () => {
    expect(periodStart("2026-09-16", "week")).toBe("2026-09-14"); // Wednesday → that Monday
    expect(periodStart("2026-09-14", "week")).toBe("2026-09-14"); // Monday stays
    expect(periodStart("2026-09-13", "week")).toBe("2026-09-07"); // Sunday → previous Monday
    expect(periodStart("2026-09-16", "month")).toBe("2026-09-01");
    expect(periodStart("2026-09-16", "day")).toBe("2026-09-16");
  });

  it("returns oldest-first, contiguous buckets that end with the current period", () => {
    const state = freshStore().snapshot();
    const weeks = periodRollups(state, "week", now, 8);
    expect(weeks).toHaveLength(8);
    expect(weeks[7].start).toBe(periodStart(today, "week"));
    expect(weeks[7].end >= today).toBe(true);
    for (let i = 1; i < weeks.length; i++) expect(weeks[i].start > weeks[i - 1].end).toBe(true);
    expect(weeks[0].key).toMatch(/^\d{4}-W\d{2}$/);
    expect(weeks[0].label).toMatch(/^Wk of /);
    const months = periodRollups(state, "month", now, 6);
    expect(months).toHaveLength(6);
    expect(months[5].key).toBe(today.slice(0, 7));
    expect(months[5].end.slice(0, 7)).toBe(today.slice(0, 7));
    const days = periodRollups(state, "day", now, 14);
    expect(days[13].key).toBe(today);
  });

  it("day, week, and month rollups agree with each other over the same span", () => {
    const state = freshStore().snapshot();
    const delivered = state.loads.filter((l) => ["delivered", "closed"].includes(l.status)).length;
    const d = rollupTotals(periodRollups(state, "day", now, 120));
    const w = rollupTotals(periodRollups(state, "week", now, 18));
    const m = rollupTotals(periodRollups(state, "month", now, 5));
    expect(delivered).toBeGreaterThan(0);
    expect(d.loads).toBe(delivered);
    expect(w.loads).toBe(delivered);
    expect(m.loads).toBe(delivered);
    expect(w.gallons).toBe(d.gallons);
    expect(m.gallons).toBe(d.gallons);
    expect(w.actualGrossProfit).toBeCloseTo(d.actualGrossProfit, 2);
    expect(m.actualGrossProfit).toBeCloseTo(d.actualGrossProfit, 2);
    expect(w.revenue).toBeCloseTo(d.revenue, 2);
    if (d.profitPerGallon !== null) expect(d.profitPerGallon).toBeCloseTo(w.profitPerGallon ?? -1, 4);
  });

  it("only counts delivered loads and keeps pending margins out of actual profit", () => {
    const state = freshStore().snapshot();
    const rows = periodRollups(state, "month", now, 3);
    const total = rollupTotals(rows);
    const inTransit = state.loads.filter((l) => !["delivered", "closed"].includes(l.status)).length;
    expect(total.loads + inTransit).toBe(state.loads.length);
    for (const r of rows) expect(r.pendingLoads).toBeLessThanOrEqual(r.loads);
  });
});
