import { APPLICATION_FEE_USD } from "../../config/constants.js";
import { formatUsd } from "../../config/fx.js";
import { log } from "../../lib/log.js";
import { ok } from "../../lib/result.js";
import { reconcilePayment } from "../../services/payments.js";
import { contactId } from "../shared.js";
import { defineTool } from "../types.js";

const GUIDANCE: Record<string, string> = {
  none: "No application fee payment has been started. If they want to pay, confirm the fee first, then call create_application_payment.",
  pending: "The payment hasn't come through yet. Say so plainly; don't say it failed. If they've just paid, ask them to give it a minute and check again.",
  success: `Confirm the ${formatUsd(APPLICATION_FEE_USD)} application fee has been received, thank them, and explain an Application Specialist will be in touch about next steps.`,
  failed: "The payment did not go through. Say so kindly and offer a new link (call create_application_payment) or an Application Specialist.",
  abandoned: "The payment wasn't completed. Offer a new link (call create_application_payment) if they still want to pay.",
};

export const getPaymentStatus = defineTool({
  name: "get_payment_status",
  description: [
    "Check whether the person's application fee has been paid. Call it when they say they've paid, or before confirming payment.",
    "Returns payment_status: none | pending | success | failed | abandoned.",
    "Never tell them they've paid unless payment_status is success.",
  ].join(" "),
  shape: { contact_id: contactId },
  async handler({ contact_id }, deps) {
    const lead = await deps.repo.getLeadByContact(contact_id);
    let payment = lead ? await deps.repo.latestApplicationPayment(lead.id) : null;
    if (!payment) return ok({ payment_status: "none" }, GUIDANCE.none);

    if (payment.status === "pending") {
      try {
        // Covers a missed or delayed webhook.
        const r = await reconcilePayment(payment.paystack_reference, deps);
        payment = r.payment ?? payment;
        if (r.changed && r.status === "success") {
          // The agent is confirming in this conversation right now, so no separate proactive message.
          await deps.repo.updatePaymentNotification(payment.id, { customer_notified_at: deps.now().toUTC().toISO(), notify_error: null });
        }
      } catch (err) {
        log.warn("reconcile during status check failed", { reference: payment.paystack_reference, error: (err as Error).message });
      }
    }

    return ok(
      {
        payment_status: payment.status,
        reference: payment.paystack_reference,
        ...(payment.status === "success" && { paid_at: payment.paid_at }),
        ...(payment.status === "pending" && { authorization_url: payment.authorization_url }),
      },
      GUIDANCE[payment.status],
    );
  },
});
