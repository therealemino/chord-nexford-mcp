import express, { type Express } from "express";
import { ADMIN_TOOLSET, CUSTOMER_TOOLSET } from "./mcp/server.js";
import type { Deps } from "./mcp/types.js";
import { mcpRouter } from "./routes/mcp.js";
import { paymentCallbackRouter } from "./routes/paymentCallback.js";
import { paystackWebhookRouter } from "./routes/paystackWebhook.js";

export interface AppConfig {
  mcpBearerToken: string;
  adminBearerToken: string;
  paystackSecretKey: string;
}

export function createApp(deps: Deps, config: AppConfig): Express {
  const app = express();
  app.disable("x-powered-by");
  app.set("trust proxy", true);

  // Mounted before express.json() so the webhook sees the raw body.
  app.use("/webhooks/paystack", paystackWebhookRouter(deps, config.paystackSecretKey));
  app.use(express.json({ limit: "1mb" }));

  app.get("/health", (_req, res) => {
    res.json({ ok: true });
  });
  app.use("/mcp", mcpRouter(deps, config.mcpBearerToken, CUSTOMER_TOOLSET));
  app.use("/mcp-admin", mcpRouter(deps, config.adminBearerToken, ADMIN_TOOLSET));
  app.use("/payments/callback", paymentCallbackRouter());

  return app;
}
