import { DateTime } from "luxon";
import { APPLICATION_FEE_USD, PENDING_PAYMENT_REUSE_MINUTES } from "../../config/constants.js";
import { toLocal, usdToKobo } from "../../config/fx.js";
import { advanceStatus } from "../../lib/leadStatus.js";
import { log } from "../../lib/log.js";
import { fail, ok } from "../../lib/result.js";
import type { Payment } from "../../services/types.js";
import { contactId } from "../shared.js";
import { defineTool } from "../types.js";

const FEE_NGN = toLocal(APPLICATION_FEE_USD, "NGN");
const FEE_KOBO = usdToKobo(APPLICATION_FEE_USD);
const amounts = { amount_usd: APPLICATION_FEE_USD, amount_ngn: FEE_NGN };

const linkGuidance =
  "Send this payment link. Say it's a secure Paystack page and that you'll confirm here in the chat once the payment comes through. " +
  "Do not say they have paid until get_payment_status returns success.";

const linkResult = (p: Payment, reused: boolean) =>
  ok({ payment_status: p.status, authorization_url: p.authorization_url, reference: p.paystack_reference, reused_existing_link: reused, ...amounts }, linkGuidance);

export const createApplicationPayment = defineTool({
  name: "create_application_payment",
  description: [
    `Create a Paystack link for the $${APPLICATION_FEE_USD} (₦${FEE_NGN.toLocaleString("en-US")}) application fee.`,
    "ONLY call this after you have told the person the fee is $25 (₦33,217), that it is non-refundable,",
    "and they have clearly said yes. Their full name and email must already be saved with save_lead.",
    "Safe to call again: it returns the existing link if one was created in the last 30 minutes, and never charges twice.",
  ].join(" "),
  shape: { contact_id: contactId },
  async handler({ contact_id }, { repo, paystack, now, publicBaseUrl }) {
    const lead = await repo.getLeadByContact(contact_id);
    const missing = [!lead?.full_name && "full_name", !lead?.email && "email"].filter(Boolean) as string[];
    if (!lead || missing.length > 0) {
      return fail("missing_details", `Ask for their ${missing.join(" and ")}, save them with save_lead, then try again.`, { missing_fields: missing });
    }

    const existing = await repo.latestApplicationPayment(lead.id);
    if (existing?.status === "success") {
      return ok(
        { payment_status: "success", already_paid: true, reference: existing.paystack_reference, ...amounts },
        "They have already paid the application fee. Do not ask them to pay again; confirm it's received.",
      );
    }
    if (
      existing?.status === "pending" &&
      existing.authorization_url &&
      now().diff(DateTime.fromISO(existing.created_at), "minutes").minutes < PENDING_PAYMENT_REUSE_MINUTES
    ) {
      return linkResult(existing, true);
    }

    const reference = `nxu_app_${lead.id.replace(/-/g, "").slice(0, 8)}_${now().toMillis()}`;
    let authorizationUrl: string;
    try {
      ({ authorization_url: authorizationUrl } = await paystack.initialize({
        email: lead.email!,
        amountKobo: FEE_KOBO,
        currency: "NGN",
        reference,
        callbackUrl: `${publicBaseUrl}/payments/callback`,
        metadata: { lead_id: lead.id, contact_id: lead.contact_id, purpose: "application_fee" },
      }));
    } catch (err) {
      log.error("paystack initialize failed", { reference, lead_id: lead.id, error: (err as Error).message });
      return fail("payment_provider_unavailable", "Apologise: the payment link couldn't be created right now. Offer to try again in a few minutes or connect them with an Application Specialist.");
    }

    // Stored before the link is returned, so the webhook can always match the reference.
    const payment = await repo.insertPayment({
      lead_id: lead.id,
      paystack_reference: reference,
      purpose: "application_fee",
      amount_kobo: FEE_KOBO,
      currency: "NGN",
      authorization_url: authorizationUrl,
    });
    await repo.updateLead(lead.id, { status: advanceStatus(lead.status, "applied") });
    log.info("payment link created", { reference, lead_id: lead.id, status: "pending" });
    return linkResult(payment, false);
  },
});
