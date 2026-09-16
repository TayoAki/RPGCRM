import express from "express";
import type { Express } from "express";
import cors from "cors";
import { ops } from "./domain/store.js";
import { registerOpsRoutes } from "./routes.js";
import { staffAuthGate } from "./services/staffAuth.js";

/**
 * The Express app: health check first (public), then the staff auth gate,
 * then the AG-UI agent endpoint (mounted by the caller so tests can build the
 * app without a model) and the REST routes. The frontend is the only caller,
 * over the private network, so browser CORS is off.
 */
export function createApp(opts: { mountAgent?: (app: Express) => void } = {}): Express {
  const app = express();
  app.use(cors({ origin: false }));
  app.use(express.json({ limit: "50mb" }));
  app.get("/ping", (_req, res) => {
    res.json({ status: "healthy" });
  });
  app.use(staffAuthGate(ops));
  opts.mountAgent?.(app);
  registerOpsRoutes(app);
  return app;
}
