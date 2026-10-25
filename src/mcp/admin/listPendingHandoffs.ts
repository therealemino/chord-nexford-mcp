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
    "callback time (Lagos time), overdue (callback time passed and still pending), whether the team was alerted " +
    "(alert_emailed_at, chord_flagged_at, plus alert_error / chord_flag_error if an alert failed) and the agent's summary.",
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
      alert_emailed_at: h.alert_emailed_at,
      chord_flagged_at: h.chord_flagged_at,
      ...(h.alert_error && { alert_error: h.alert_error }),
      ...(h.chord_flag_error && { chord_flag_error: h.chord_flag_error }),
      summary: h.summary,
    }));
    return ok(
      { count: handoffs.length, handoffs },
      handoffs.length
        ? "List overdue callbacks first. Point out any handoff with alert_error or chord_flag_error: the team may not know about it."
        : "There are no handoffs waiting.",
    );
  },
});
