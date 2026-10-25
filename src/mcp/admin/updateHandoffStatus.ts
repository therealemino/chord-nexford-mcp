import { z } from "zod";
import { formatForApplicant } from "../../lib/hours.js";
import { fail, ok } from "../../lib/result.js";
import type { HandoffPatch } from "../../services/types.js";
import { defineTool } from "../types.js";

export const updateHandoffStatus = defineTool({
  name: "update_handoff_status",
  description: "Mark a handoff as contacted or closed (sets contacted_at / closed_at) and optionally add a note.",
  shape: {
    handoff_id: z.uuid(),
    status: z.enum(["contacted", "closed"]),
    note: z.string().trim().min(1).max(500).nullish(),
  },
  async handler({ handoff_id, status, note }, { repo, now }) {
    const existing = await repo.getHandoff(handoff_id);
    if (!existing) return fail("handoff_not_found", "No handoff has that id. Use list_pending_handoffs to find it.");

    const at = now().toUTC().toISO()!;
    const patch: HandoffPatch = { status, ...(status === "contacted" ? { contacted_at: at } : { closed_at: at }) };
    if (note) patch.notes = [existing.notes, `[${formatForApplicant(now())}] ${note}`].filter(Boolean).join("\n");

    const h = await repo.updateHandoff(handoff_id, patch);
    return ok(
      { handoff_id: h.id, status: h.status, contacted_at: h.contacted_at, closed_at: h.closed_at, notes: h.notes },
      `Handoff marked ${status}.`,
    );
  },
});
