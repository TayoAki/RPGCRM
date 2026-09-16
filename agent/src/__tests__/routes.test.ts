import { describe, it, expect, beforeAll } from "vitest";
import express from "express";
import request from "supertest";
import { registerOpsRoutes } from "../routes.js";
import { ops } from "../domain/store.js";
import { PORTAL_DEMO_PASSWORD } from "../domain/seed.js";

function app() {
  const a = express();
  registerOpsRoutes(a);
  return a;
}

describe("ops REST routes", () => {
  beforeAll(() => ops.reseed(new Date("2026-09-16T15:00:00.000Z")));

  it("GET /ops returns the trimmed snapshot", async () => {
    const res = await request(app()).get("/ops");
    expect(res.status).toBe(200);
    expect(res.body.customers.length).toBe(7);
    expect(res.body.rackPrices.length).toBeLessThan(400);
  });

  it("GET /ops/dashboard aggregates metrics, board, market, triage", async () => {
    const res = await request(app()).get("/ops/dashboard");
    expect(res.status).toBe(200);
    expect(res.body.metrics.ordersInProgress).toBeGreaterThan(0);
    expect(res.body.priceBoard.length).toBe(35);
    expect(res.body.market.length).toBe(4);
    expect(res.body.triage.priorities.length).toBeGreaterThan(0);
  });

  it("POST /ops/price/quote prices a customer/product", async () => {
    const res = await request(app()).post("/ops/price/quote").send({ customerId: "cust-qsm", productId: "p-unl87", terminalId: "t-dal" });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.price.sellPricePerGallon).toBeGreaterThan(1);
  });

  it("intake run + review creates an order; bad actor header falls back", async () => {
    const run = await request(app()).post("/ops/intake/run");
    expect(run.status).toBe(200);
    const first = run.body.queued[0];
    const review = await request(app()).post(`/ops/intake/${first.id}/review`).set("x-actor-id", "nobody").send({ decision: "approve" });
    expect(review.status).toBe(200);
    expect(review.body.orderId).toMatch(/^o-/);
  });

  it("approval gate returns 400 for a non-management actor", async () => {
    const res = await request(app()).post("/ops/invoices/inv-1004/approve").set("x-actor-id", "u-elena");
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/management/);
    const ok = await request(app()).post("/ops/invoices/inv-1004/approve").set("x-actor-id", "u-dana");
    expect(ok.status).toBe(200);
    expect(ok.body.status).toBe("approved");
  });

  it("unknown ids return 404", async () => {
    const res = await request(app()).post("/ops/orders/o-nope/status").send({ status: "confirmed" });
    expect(res.status).toBe(404);
  });

  it("portal sign-in issues a session and scopes /portal/me to that customer without pricing", async () => {
    const bad = await request(app()).post("/portal/login").send({ email: "fuel@quickstopmarkets.com", password: "wrong" });
    expect(bad.status).toBe(401);
    expect(bad.body.error).toMatch(/Invalid email or password/);
    const login = await request(app()).post("/portal/login").send({ email: "fuel@quickstopmarkets.com", password: PORTAL_DEMO_PASSWORD });
    expect(login.status).toBe(200);
    expect(login.body.customer.code).toBe("QSM");
    const me = await request(app()).get("/portal/me").set("Authorization", `Bearer ${login.body.token}`);
    expect(me.status).toBe(200);
    expect(me.body.customer.code).toBe("QSM");
    expect(me.body.user.email).toBe("fuel@quickstopmarkets.com");
    expect(me.body.orders.length).toBeGreaterThan(0);
    expect(me.body.orders.every((o: { location: string }) => o.location.startsWith("Store"))).toBe(true);
    expect(JSON.stringify(me.body)).not.toMatch(/pricePerGallon|rackPrice|supplierCost/);
    const anon = await request(app()).get("/portal/me");
    expect(anon.status).toBe(401);
    const forged = await request(app()).get("/portal/me").set("Authorization", "Bearer not-a-real-token");
    expect(forged.status).toBe(401);
    const out = await request(app()).post("/portal/logout").set("Authorization", `Bearer ${login.body.token}`);
    expect(out.body.ok).toBe(true);
    const after = await request(app()).get("/portal/me").set("Authorization", `Bearer ${login.body.token}`);
    expect(after.status).toBe(401);
    const legacy = await request(app()).get("/portal/qsm-c0ffee");
    expect(legacy.status).toBe(404);
  });
});
