import { DateTime } from "luxon";
import { WAIVER_MIN_YEARS } from "../config/foundation.js";
import { formatForApplicant } from "../lib/hours.js";
import { log } from "../lib/log.js";
import type { PaystackClient } from "./paystack.js";
import type { Handoff, Lead, Payment, PaymentStatus, Repo } from "./types.js";

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
    const lead = await repo.updateLead(updated.lead_id, { status: "paid" });
    log.info("payment succeeded", { reference, lead_id: updated.lead_id, status: "success" });
    await createNewApplicantHandoff(lead, updated, repo);
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

/** Staff-facing summary of a newly paid applicant. Stored in the database only, never sent to the customer. */
export function newApplicantSummary(lead: Lead, payment: Payment, callback: Handoff | null): string {
  const yesNo = (v: boolean | null) => (v === null ? "unknown" : v ? "yes" : "no");
  const waiver = lead.eligibility_result === "foundation_likely" && (lead.years_relevant_experience ?? 0) >= WAIVER_MIN_YEARS;
  const parts = [
    "New applicant: application fee paid.",
    `Name: ${lead.full_name ?? "not given"}.`,
    `Email: ${lead.email ?? "not given"}.`,
    `Country: ${lead.country ?? "not given"}.`,
    `Programme: ${lead.programme ?? "not given"}.`,
    `Bachelor's: ${yesNo(lead.has_bachelors_degree)}, field: ${lead.degree_field ?? "unknown"}, experience: ${lead.years_relevant_experience ?? "unknown"} years.`,
    `Eligibility: ${lead.eligibility_result ?? "not assessed"}${lead.foundation_courses?.length ? ` (${lead.foundation_courses.join(", ")})` : ""}; waiver can be requested: ${waiver ? "yes" : "no"}.`,
    `Payment ref: ${payment.paystack_reference}.`,
  ];
  if (callback) {
    parts.push(
      `Callback requested: ${callback.callback_number ?? "no number"}${callback.callback_time ? ` at ${formatForApplicant(DateTime.fromISO(callback.callback_time))}` : ", no time agreed"} (${callback.status}).`,
    );
  }
  return parts.join(" ").slice(0, 1000);
}

/** One new_applicant handoff per payment (enforced by a unique index on payment_id). Failures are logged, not thrown. */
async function createNewApplicantHandoff(lead: Lead, payment: Payment, repo: Repo): Promise<void> {
  try {
    const callback = await repo.latestCallbackHandoff(lead.id);
    const inserted = await repo.insertHandoffOnce({
      lead_id: lead.id,
      payment_id: payment.id,
      reason: "new_applicant",
      summary: newApplicantSummary(lead, payment, callback),
      channel: "whatsapp",
      callback_number: null,
      callback_time: null,
    });
    if (inserted) log.info("new applicant handoff created", { lead_id: lead.id, reference: payment.paystack_reference });
  } catch (err) {
    log.error("new applicant handoff failed", { lead_id: lead.id, reference: payment.paystack_reference, error: (err as Error).message });
  }
}
