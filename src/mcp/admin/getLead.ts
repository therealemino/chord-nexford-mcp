import { DateTime } from "luxon";
import { z } from "zod";
import { formatForApplicant } from "../../lib/hours.js";
import { isOverdue } from "../../lib/pipeline.js";
import { ok } from "../../lib/result.js";
import { publicLead } from "../shared.js";
import { defineTool } from "../types.js";

const MAX_RESULTS = 5;

export const getLead = defineTool({
  name: "get_lead",
  description: `Find applicants by email, contact_id or part of their name (max ${MAX_RESULTS}). Returns profile, application-fee payment status and handoff history.`,
  shape: { query: z.string().trim().min(2).max(200) },
  async handler({ query }, { repo, now }) {
    const leads = await repo.searchLeads(query, MAX_RESULTS);
    const results = await Promise.all(
      leads.map(async (lead) => {
        const [payment, handoffs] = await Promise.all([repo.latestApplicationPayment(lead.id), repo.handoffsForLead(lead.id)]);
        return {
          profile: { ...publicLead(lead), created: formatForApplicant(DateTime.fromISO(lead.created_at)) },
          payment: payment
            ? { status: payment.status, reference: payment.paystack_reference, paid_at: payment.paid_at, customer_notified: !!payment.customer_notified_at }
            : null,
          handoffs: handoffs.map((h) => ({
            handoff_id: h.id,
            reason: h.reason,
            channel: h.channel,
            status: h.status,
            callback_time: h.callback_time ? formatForApplicant(DateTime.fromISO(h.callback_time)) : null,
            overdue: isOverdue(h, now()),
            created: formatForApplicant(DateTime.fromISO(h.created_at)),
          })),
        };
      }),
    );
    return ok(
      { count: results.length, leads: results },
      results.length ? "Summarise briefly." : "No applicant matches that email, contact_id or name.",
    );
  },
});
