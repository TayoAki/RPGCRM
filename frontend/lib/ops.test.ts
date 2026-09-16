import { describe, it, expect } from "vitest";
import { EMPTY_STATE, fmtDate, gal, groupBy, isOpsState, money, ppg, relativeTime, signed, titleCase } from "./ops";

describe("ops helpers", () => {
  it("formats money, gallons, and prices", () => {
    expect(money(1234.5)).toBe("$1,234.50");
    expect(money(null)).toBe("—");
    expect(ppg(2.5)).toBe("$2.5000");
    expect(gal(7500.4)).toBe("7,500 gal");
    expect(signed(-0.02)).toBe("−$0.0200");
    expect(titleCase("ready_to_invoice")).toBe("Ready To Invoice");
  });
  it("formats dates and relative times", () => {
    expect(fmtDate("2026-09-18")).toBe("Sep 18");
    const now = Date.parse("2026-09-16T12:00:00Z");
    expect(relativeTime("2026-09-16T10:00:00Z", now)).toBe("2h ago");
    expect(relativeTime("2026-09-17T12:00:00Z", now)).toBe("in 1d");
  });
  it("recognizes a state and groups", () => {
    expect(isOpsState(EMPTY_STATE)).toBe(true);
    expect(isOpsState({})).toBe(false);
    expect(groupBy([{ k: "a" }, { k: "b" }, { k: "a" }], (x) => x.k).a.length).toBe(2);
  });
});
