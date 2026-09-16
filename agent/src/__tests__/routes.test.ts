import { describe, it, expect, beforeAll } from "vitest";
import request from "supertest";
import { createApp } from "../app.js";
import { ops } from "../domain/store.js";
import { PORTAL_DEMO_PASSWORD, STAFF_DEMO_PASSWORD } from "../domain/seed.js";

const app = createApp();

async function signIn(email: string): Promise<string> {
  const res = await request(app).post("/auth/login").send({ email, password: STAFF_DEMO_PASSWORD });
  expect(res.status).toBe(200);
  expect(res.body.token).toBeTruthy();
  return `Bearer ${res.body.token}`;
}

describe("ops REST routes behind staff sign-in", () => {
  let dana = "";
  beforeAll(async () => {
    ops.reseed(new Date("2026-09-16T15:00:00.000Z"));
    dana = await signIn("dana@rpgfuel.example");
  });

  it("keeps /ping public and refuses the workspace, the agent endpoint, and /auth/me without a session", async () => {
    expect((await request(app).get("/ping")).status).toBe(200);
    expect((await request(app).get("/ops")).status).toBe(401);
    expect((await request(app).get("/ops").set("x-actor-id", "u-dana")).status).toBe(401);
    expect((await request(app).get("/ops").set("Authorization", "Bearer forged")).status).toBe(401);
    expect((await request(app).get("/ops/dashboard")).status).toBe(401);
    expect((await request(app).post("/ops/intake/run")).status).toBe(401);
    expect((await request(app).post("/").send({ threadId: "t", runId: "r", messages: [], tools: [], context: [] })).status).toBe(401);
    expect((await request(app).get("/auth/me")).status).toBe(401);
    const bad = await request(app).post("/auth/login").send({ email: "dana@rpgfuel.example", password: "wrong" });
    expect(bad.status).toBe(401);
    expect(bad.body.error).toMatch(/Invalid email or password/);
  });

  it("GET /ops returns the trimmed snapshot with credentials blanked and no sessions", async () => {
    const res = await request(app).get("/ops").set("Authorization", dana);
    expect(res.status).toBe(200);
    expect(res.body.customers.length).toBe(7);
    expect(res.body.rackPrices.length).toBeLessThan(400);
    expect(res.body.staff.length).toBe(5);
    expect(res.body.staff.every((u: { passwordHash: string; salt: string }) => u.passwordHash === "" && u.salt === "")).toBe(true);
    expect(res.body.staffSessions).toEqual([]);
    expect(JSON.stringify(res.body)).not.toContain(dana.slice(7));
  });

  it("GET /auth/me describes the signed-in user; logout revokes the session", async () => {
    const me = await request(app).get("/auth/me").set("Authorization", dana);
    expect(me.status).toBe(200);
    expect(me.body.user).toEqual({ id: "u-dana", name: "Dana Whitfield", email: "dana@rpgfuel.example", role: "management" });
    expect(me.body.session.expiresAt).toBeTruthy();
    const priya = await signIn("priya@rpgfuel.example");
    expect((await request(app).post("/auth/logout").set("Authorization", priya)).body.ok).toBe(true);
    expect((await request(app).get("/auth/me").set("Authorization", priya)).status).toBe(401);
  });

  it("GET /ops/dashboard aggregates metrics, board, market, triage", async () => {
    const res = await request(app).get("/ops/dashboard").set("Authorization", dana);
    expect(res.status).toBe(200);
    expect(res.body.metrics.ordersInProgress).toBeGreaterThan(0);
    expect(res.body.priceBoard.length).toBe(35);
    expect(res.body.market.length).toBe(4);
    expect(res.body.triage.priorities.length).toBeGreaterThan(0);
  });

  it("POST /ops/price/quote prices a customer/product", async () => {
    const res = await request(app).post("/ops/price/quote").set("Authorization", dana).send({ customerId: "cust-qsm", productId: "p-unl87", terminalId: "t-dal" });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.price.sellPricePerGallon).toBeGreaterThan(1);
  });

  it("intake run + review creates an order attributed to the signed-in user, not to any header", async () => {
    const marcus = await signIn("marcus@rpgfuel.example");
    const run = await request(app).post("/ops/intake/run").set("Authorization", marcus);
    expect(run.status).toBe(200);
    const first = run.body.queued[0];
    const review = await request(app).post(`/ops/intake/${first.id}/review`).set("Authorization", marcus).set("x-actor-id", "u-dana").send({ decision: "approve" });
    expect(review.status).toBe(200);
    expect(review.body.orderId).toMatch(/^o-/);
    expect(review.body.reviewedBy).toBe("u-marcus");
  });

  it("approval gate uses the session's role: billing is refused, management approves", async () => {
    const elena = await signIn("elena@rpgfuel.example");
    const res = await request(app).post("/ops/invoices/inv-1004/approve").set("Authorization", elena).set("x-actor-id", "u-dana");
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/management/);
    const ok = await request(app).post("/ops/invoices/inv-1004/approve").set("Authorization", dana);
    expect(ok.status).toBe(200);
    expect(ok.body.status).toBe("approved");
    expect(ok.body.approvedBy).toBe("u-dana");
  });

  it("POST /auth/password changes the password and keeps the current session", async () => {
    const sam = await signIn("sam@rpgfuel.example");
    const short = await request(app).post("/auth/password").set("Authorization", sam).send({ currentPassword: STAFF_DEMO_PASSWORD, newPassword: "short" });
    expect(short.status).toBe(400);
    const ok = await request(app).post("/auth/password").set("Authorization", sam).send({ currentPassword: STAFF_DEMO_PASSWORD, newPassword: "Sam-route-secret-7" });
    expect(ok.status).toBe(200);
    expect((await request(app).get("/auth/me").set("Authorization", sam)).status).toBe(200);
    expect((await request(app).post("/auth/login").send({ email: "sam@rpgfuel.example", password: STAFF_DEMO_PASSWORD })).status).toBe(401);
    const again = await request(app).post("/auth/login").send({ email: "sam@rpgfuel.example", password: "Sam-route-secret-7" });
    expect(again.status).toBe(200);
    // Put the demo password back for the reseed test below.
    expect((await request(app).post("/auth/password").set("Authorization", sam).send({ currentPassword: "Sam-route-secret-7", newPassword: STAFF_DEMO_PASSWORD })).status).toBe(200);
  });

  it("unknown ids return 404", async () => {
    const res = await request(app).post("/ops/orders/o-nope/status").set("Authorization", dana).send({ status: "confirmed" });
    expect(res.status).toBe(404);
  });

  it("portal sign-in stays public and scopes /portal/me to that customer without pricing", async () => {
    const bad = await request(app).post("/portal/login").send({ email: "fuel@quickstopmarkets.com", password: "wrong" });
    expect(bad.status).toBe(401);
    expect(bad.body.error).toMatch(/Invalid email or password/);
    const login = await request(app).post("/portal/login").send({ email: "fuel@quickstopmarkets.com", password: PORTAL_DEMO_PASSWORD });
    expect(login.status).toBe(200);
    expect(login.body.customer.code).toBe("QSM");
    const me = await request(app).get("/portal/me").set("Authorization", `Bearer ${login.body.token}`);
    expect(me.status).toBe(200);
    expect(me.body.customer.code).toBe("QSM");
    expect(me.body.user.email).toBe("fuel@quickstopmarkets.com");
    expect(me.body.orders.length).toBeGreaterThan(0);
    expect(me.body.orders.every((o: { location: string }) => o.location.startsWith("Store"))).toBe(true);
    expect(JSON.stringify(me.body)).not.toMatch(/pricePerGallon|rackPrice|supplierCost/);
    // A portal session is not a staff session.
    expect((await request(app).get("/ops").set("Authorization", `Bearer ${login.body.token}`)).status).toBe(401);
    const anon = await request(app).get("/portal/me");
    expect(anon.status).toBe(401);
    const forged = await request(app).get("/portal/me").set("Authorization", "Bearer not-a-real-token");
    expect(forged.status).toBe(401);
    const out = await request(app).post("/portal/logout").set("Authorization", `Bearer ${login.body.token}`);
    expect(out.body.ok).toBe(true);
    const after = await request(app).get("/portal/me").set("Authorization", `Bearer ${login.body.token}`);
    expect(after.status).toBe(401);
    const legacy = await request(app).get("/portal/qsm-c0ffee");
    expect(legacy.status).toBe(404);
  });

  it("demo reset needs an admin and keeps everyone signed in", async () => {
    const refused = await request(app).post("/ops/admin/reseed").set("Authorization", dana);
    expect(refused.status).toBe(403);
    const sam = await signIn("sam@rpgfuel.example");
    const ok = await request(app).post("/ops/admin/reseed").set("Authorization", sam);
    expect(ok.status).toBe(200);
    expect(ok.body.ok).toBe(true);
    expect((await request(app).get("/auth/me").set("Authorization", dana)).status).toBe(200);
    expect((await request(app).get("/auth/me").set("Authorization", sam)).status).toBe(200);
  });
});
