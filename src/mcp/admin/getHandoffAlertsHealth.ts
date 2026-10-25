import { DateTime } from "luxon";
import { formatForApplicant } from "../../lib/hours.js";
import { ok } from "../../lib/result.js";
import { defineTool } from "../types.js";

const DAYS = 7;

export const getHandoffAlertsHealth = defineTool({
  name: "get_handoff_alerts_health",
  description: `Handoffs from the last ${DAYS} days whose alert email or Chord dashboard action failed, with ids and errors. Empty means every alert went out.`,
  shape: {},
  async handler(_args, { repo, now }) {
    const failed = await repo.handoffAlertFailuresSince(now().minus({ days: DAYS }).toUTC().toISO()!);
    const items = failed.map((h) => ({
      handoff_id: h.id,
      created: formatForApplicant(DateTime.fromISO(h.created_at)),
      reason: h.reason,
      channel: h.channel,
      status: h.status,
      ...(h.alert_error && { email_error: h.alert_error }),
      ...(h.chord_flag_error && { chord_error: h.chord_flag_error }),
    }));
    return ok(
      { days: DAYS, email_failures: failed.filter((h) => h.alert_error).length, chord_failures: failed.filter((h) => h.chord_flag_error).length, handoffs: items },
      items.length
        ? "Lead with this: these handoffs may not have reached a person. List each id with its error and suggest checking it with list_pending_handoffs."
        : "All handoff alerts in the last 7 days went out.",
    );
  },
});
