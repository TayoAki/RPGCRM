import { describe, it, expect, beforeAll } from "vitest";
import express from "express";
import request from "supertest";
import { registerOpsRoutes } from "../routes.js";
import { ops } from "../domain/store.js";

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

  it("portal is scoped by token and hides pricing", async () => {
    const res = await request(app()).get("/portal/qsm-c0ffee");
    expect(res.status).toBe(200);
    expect(res.body.customer.code).toBe("QSM");
    expect(res.body.orders.every((o: any) => o.orderNumber.startsWith("ORD-"))).toBe(true);
    expect(JSON.stringify(res.body)).not.toContain("differential");
    const bad = await request(app()).get("/portal/nope");
    expect(bad.status).toBe(404);
  });
});
