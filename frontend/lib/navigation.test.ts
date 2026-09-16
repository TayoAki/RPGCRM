import { describe, it, expect } from "vitest";
import { PAGE_KEYS, PAGE_ROUTES, pageToRoute } from "./navigation";

describe("navigation", () => {
  it("maps every page key to a route", () => {
    for (const k of PAGE_KEYS) expect(pageToRoute(k)).toBe(PAGE_ROUTES[k]);
  });
  it("falls back to the dashboard", () => {
    expect(pageToRoute("nope")).toBe("/");
  });
  it("includes the RPG workspace pages", () => {
    expect(PAGE_KEYS).toEqual(expect.arrayContaining(["orders", "loads", "pricing", "market", "bols", "billing", "exceptions"]));
  });
});
