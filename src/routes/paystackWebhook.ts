import express, { Router } from "express";
import { log } from "../lib/log.js";
import type { Deps } from "../mcp/types.js";
import { notifyPaymentSuccess } from "../services/notify.js";
import { reconcilePayment, type ReconcileResult } from "../services/payments.js";
import { verifyPaystackSignature } from "../services/paystack.js";

interface PaystackEvent {
  event?: string;
  data?: { reference?: string };
}

export function paystackWebhookRouter(deps: Deps, secretKey: string): Router {
  const router = Router();

  // Raw body is required for the HMAC check, so this route must not go through express.json().
  router.post("/", express.raw({ type: "*/*", limit: "1mb" }), async (req, res) => {
    const raw = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
    if (!verifyPaystackSignature(raw, req.header("x-paystack-signature"), secretKey)) {
      res.sendStatus(401);
      return;
    }

    let payload: PaystackEvent;
    try {
      payload = JSON.parse(raw.toString("utf8"));
    } catch {
      res.sendStatus(200); // signed but unparseable: acknowledge so Paystack doesn't retry forever
      return;
    }
    const event = payload.event ?? "unknown";
    const reference = payload.data?.reference ?? null;

    // After a verified signature we always answer 200; errors are logged and get_payment_status can reconcile later.
    let result: ReconcileResult | null = null;
    try {
      await deps.repo.logWebhookEvent({ event, reference, payload });
      if (event === "charge.success" && reference) {
        result = await reconcilePayment(reference, deps);
        log.info("webhook processed", { event, reference, status: result.status, changed: result.changed });
      }
    } catch (err) {
      log.error("webhook processing failed", { event, reference, error: (err as Error).message });
    }
    res.sendStatus(200);

    // Only the first transition to success notifies, and only after Paystack has its 200.
    const paid = result?.changed && result.status === "success" ? result.payment : null;
    if (paid) deps.runInBackground(() => notifyPaymentSuccess(paid, deps));
  });

  return router;
}
