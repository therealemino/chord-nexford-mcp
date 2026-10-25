import { DateTime } from "luxon";
import { z } from "zod";
import { formatForApplicant } from "../../lib/hours.js";
import { isOverdue } from "../../lib/pipeline.js";
import { ok } from "../../lib/result.js";
import { defineTool } from "../types.js";

export const listPendingHandoffs = defineTool({
  name: "list_pending_handoffs",
  description:
    "Handoffs waiting for an Application Specialist, oldest first. Each has the lead, programme, reason, channel, " +
    "callback time (Lagos time), overdue (callback time passed and still pending) and the agent's summary.",
  shape: {
    include_contacted: z.boolean().nullish().describe("Also include handoffs already marked contacted but not closed."),
    limit: z.number().int().min(1).max(50).nullish().describe("Default 20."),
  },
  async handler({ include_contacted, limit }, { repo, now }) {
    const rows = await repo.handoffsByStatus(include_contacted ? ["pending", "contacted"] : ["pending"], limit ?? 20);
    const handoffs = rows.map((h) => ({
      handoff_id: h.id,
      name: h.lead?.full_name ?? null,
      programme: h.lead?.programme ?? null,
      reason: h.reason,
      channel: h.channel,
      status: h.status,
      callback_number: h.callback_number,
      callback_time: h.callback_time ? formatForApplicant(DateTime.fromISO(h.callback_time)) : null,
      overdue: isOverdue(h, now()),
      created: formatForApplicant(DateTime.fromISO(h.created_at)),
      summary: h.summary,
    }));
    return ok(
      { count: handoffs.length, handoffs },
      handoffs.length ? "List overdue callbacks first in your reply." : "There are no handoffs waiting.",
    );
  },
});
