import type { DateTime } from "luxon";
import { log } from "../lib/log.js";
import type { PaystackClient } from "./paystack.js";
import type { Payment, PaymentStatus, Repo } from "./types.js";

export interface ReconcileResult {
  found: boolean;
  status: PaymentStatus | null;
  /** True only on the first transition into success/failed. Duplicates return false. */
  changed: boolean;
  payment: Payment | null;
}

/**
 * The one place that confirms an application-fee payment. Used by both the Paystack webhook and
 * get_payment_status. Never trusts the caller: it re-verifies with Paystack and checks currency and
 * amount against what we stored. Idempotent: a repeated call after success changes nothing.
 */
export async function reconcilePayment(
  reference: string,
  deps: { repo: Repo; paystack: PaystackClient; now: () => DateTime },
): Promise<ReconcileResult> {
  const { repo, paystack } = deps;
  const payment = await repo.getPaymentByReference(reference);
  if (!payment) {
    log.warn("reconcile: unknown reference", { reference });
    return { found: false, status: null, changed: false, payment: null };
  }
  if (payment.status === "success") return { found: true, status: "success", changed: false, payment };

  const tx = await paystack.verify(reference);

  if (tx.status === "success") {
    if (tx.currency !== payment.currency || tx.amount !== payment.amount_kobo) {
      log.error("reconcile: amount or currency mismatch, marking failed", {
        reference,
        lead_id: payment.lead_id,
        expected_kobo: payment.amount_kobo,
        got_kobo: tx.amount,
        got_currency: tx.currency,
      });
      const failed = await repo.markPaymentStatus(reference, "failed");
      return { found: true, status: "failed", changed: !!failed, payment: failed ?? payment };
    }

    const updated = await repo.markPaymentSuccess(reference, tx.paid_at ?? deps.now().toUTC().toISO()!);
    if (!updated) {
      // Someone else (a concurrent webhook) got there first.
      return { found: true, status: "success", changed: false, payment: await repo.getPaymentByReference(reference) };
    }
    await repo.updateLead(updated.lead_id, { status: "paid" });
    log.info("payment succeeded", { reference, lead_id: updated.lead_id, status: "success" });
    return { found: true, status: "success", changed: true, payment: updated };
  }

  if (tx.status === "failed") {
    const failed = await repo.markPaymentStatus(reference, "failed");
    log.info("payment failed", { reference, lead_id: payment.lead_id, status: "failed" });
    return { found: true, status: "failed", changed: !!failed, payment: failed ?? payment };
  }

  // abandoned / ongoing / pending etc.: the person may still complete it, so we leave it pending.
  return { found: true, status: payment.status, changed: false, payment };
}
