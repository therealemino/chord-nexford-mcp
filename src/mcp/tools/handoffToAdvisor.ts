import { DateTime } from "luxon";
import { z } from "zod";
import { ADVISOR_BOOKING_LINK, HANDOFF_RETRY_WINDOW_MINUTES } from "../../config/constants.js";
import {
  checkCallbackTime,
  formatForApplicant,
  isWithinSpecialistHours,
  nextSpecialistWindow,
  specialistHoursLagosToday,
} from "../../lib/hours.js";
import { log } from "../../lib/log.js";
import { alertHandoff } from "../../services/handoffAlerts.js";
import { fail, ok } from "../../lib/result.js";
import { contactId } from "../shared.js";
import { defineTool } from "../types.js";

export const HANDOFF_REASONS = [
  "requested_by_user",
  "scholarship_or_funding",
  "transcript_or_transfer_evaluation",
  "refund_or_billing",
  "degree_recognition",
  "price_not_listed",
  "complaint",
  "not_in_knowledge_base",
  "other",
] as const;

const NOT_BOOKED =
  `Nothing was booked. Don't say the request is in. Say an Application Specialist will follow up, and share the consultation booking link ${ADVISOR_BOOKING_LINK}.`;

export const handoffToAdvisor = defineTool({
  name: "handoff_to_advisor",
  description: [
    "Hand the person over to a human Application Specialist, either in this WhatsApp chat (channel 'whatsapp') or by phone callback (channel 'call').",
    "Call it when they ask for a person, or for scholarships/funding, transcript or credit-transfer evaluation, refunds or billing,",
    "degree recognition, prices get_tuition says aren't published, complaints, or anything not in the knowledge base.",
    "The team is alerted only when this tool succeeds. Only tell the person their request is in AFTER it returns ok: true,",
    "and use the callback_time it returns. If it returns ok: false or errors, don't say anything was booked.",
    "For calls you need a phone number: you cannot see the number they are messaging from, so ask them to type the number to call (with country code).",
    "For calls, agree a time first and pass it as preferred_callback_time (ISO 8601 with offset, e.g. 2026-11-02T14:00:00+01:00).",
    "Never state specialist hours from memory (they shift when US daylight saving ends): quote specialist_hours_lagos_today from the result.",
  ].join(" "),
  shape: {
    contact_id: contactId,
    reason: z
      .enum(HANDOFF_REASONS)
      .describe("Use price_not_listed only when get_tuition returned available: false. MBA specialisations are priced as the MBA, so they are never price_not_listed."),
    summary: z
      .string()
      .trim()
      .min(20)
      .max(1000)
      .describe(
        "For the specialist: the person's background, programme interest, and the questions still open. " +
          "Leave out anything you already answered (for example tuition from get_tuition).",
      ),
    channel: z.enum(["whatsapp", "call"]),
    callback_number: z.string().trim().regex(/^\+?[\d\s\-()]{7,20}$/, "must be a phone number").nullish().describe("Number to call, as typed by the person. Required for calls unless use_whatsapp_number is true."),
    use_whatsapp_number: z.boolean().nullish().describe("For calls: use a WhatsApp number the person already gave you and you saved with save_lead. You cannot see their number yourself."),
    preferred_callback_time: z.string().trim().max(40).nullish().describe("Agreed callback time, ISO 8601 with UTC offset."),
  },
  async handler(args, deps) {
    const { repo, now } = deps;
    const hours = { specialist_hours_lagos_today: specialistHoursLagosToday(now()) };
    const lead = await repo.upsertLead(args.contact_id, {});
    let callbackNumber: string | null = null;
    let callbackTime: string | null = null;

    if (args.channel === "call") {
      callbackNumber = args.callback_number ?? (args.use_whatsapp_number ? lead.whatsapp_number : null);
      if (!callbackNumber) {
        return fail(
          "callback_number_required",
          args.use_whatsapp_number
            ? "No number is saved for them, and you can't see the number they're messaging from. Ask them to type the number to call, with country code, then try again."
            : "Ask them to type the number the specialist should call, with country code, then try again.",
          hours,
        );
      }
      if (args.preferred_callback_time) {
        const check = checkCallbackTime(args.preferred_callback_time, now());
        if (!check.ok && check.reason === "invalid_time") {
          return fail("invalid_time", "preferred_callback_time must be ISO 8601 with a UTC offset, e.g. 2026-11-02T14:00:00+01:00. Convert the agreed time and try again.", hours);
        }
        if (!check.ok) {
          const alternatives = check.reason === "outside_hours" ? check.alternatives : [];
          return fail(
            "outside_hours",
            `That time is outside Application Specialist hours (${hours.specialist_hours_lagos_today} Lagos time today) or in the past. Nothing was booked. ` +
              "Offer next_available_slot (or the other alternatives), then call again with the time they choose.",
            { reason: "outside_hours", next_available_slot: alternatives[0] ?? null, alternatives, ...hours },
          );
        }
        callbackTime = check.time.toUTC().toISO()!;
      }
    }

    const row = { lead_id: lead.id, reason: args.reason, summary: args.summary, channel: args.channel, callback_number: callbackNumber, callback_time: callbackTime };
    // A retried tool call within a few minutes reuses the existing handoff, so the team is alerted once.
    const since = now().minus({ minutes: HANDOFF_RETRY_WINDOW_MINUTES }).toUTC().toISO()!;
    const existing = await repo.findDuplicateHandoff(row, since);
    const handoff = existing ?? (await repo.insertHandoff(row));
    await repo.updateLead(lead.id, { status: "handed_off" });
    if (!existing) {
      log.info("handoff created", { lead_id: lead.id, handoff_id: handoff.id, channel: args.channel, reason: args.reason });
      deps.runInBackground(() => alertHandoff(handoff.id, deps));
    }

    const window = nextSpecialistWindow(now());
    const extra = { advisor_booking_link: ADVISOR_BOOKING_LINK, ...hours };

    if (args.channel === "whatsapp") {
      const openNow = isWithinSpecialistHours(now());
      return ok(
        { channel: "whatsapp", specialists_available_now: openNow, ...(!openNow && { next_available: window.opens.display }), ...extra },
        openNow
          ? "Tell them their request is in and an Application Specialist will pick up this chat shortly. They can also book a consultation with the link."
          : `Tell them their request is in and an Application Specialist will reply in this chat from ${window.opens.display}. They can also book a consultation with the link.`,
      );
    }
    if (callbackTime) {
      const display = formatForApplicant(DateTime.fromISO(callbackTime));
      return ok(
        { channel: "call", callback_time: display, ...extra },
        `Tell them their call request is in: an Application Specialist will call ${callbackNumber} around ${display}. Use exactly this time; don't promise an exact minute.`,
      );
    }
    return ok(
      { channel: "call", callback_time: null, next_available_window: { opens: window.opens.display, closes: window.closes.display }, ...extra },
      `Tell them their call request is in. No time was agreed, so an Application Specialist will call during working hours (${window.open_now ? "from now" : `from ${window.opens.display}`} until ${window.closes.display}). Mention the booking link if they'd rather pick a time.`,
    );
  },
});
