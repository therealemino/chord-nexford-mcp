import { DateTime } from "luxon";
import { z } from "zod";
import { ADVISOR_BOOKING_LINK } from "../../config/constants.js";
import { checkCallbackTime, formatForApplicant, isWithinSpecialistHours, nextSpecialistWindow } from "../../lib/hours.js";
import { log } from "../../lib/log.js";
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

export const handoffToAdvisor = defineTool({
  name: "handoff_to_advisor",
  description: [
    "Hand the person over to a human Application Specialist, either in this WhatsApp chat (channel 'whatsapp') or by phone callback (channel 'call').",
    "Call it when they ask for a person, or for scholarships/funding, transcript or credit-transfer evaluation, refunds or billing,",
    "degree recognition, prices that aren't published, complaints, or anything not in the knowledge base.",
    "For calls, agree a time first and pass it as preferred_callback_time (ISO 8601 with offset, e.g. 2026-11-02T14:00:00+01:00).",
    "Specialists work 7am to 6pm New York time. If the time is outside those hours you get ok: false with alternative times to offer; nothing is saved until a valid time is accepted.",
  ].join(" "),
  shape: {
    contact_id: contactId,
    reason: z.enum(HANDOFF_REASONS),
    summary: z.string().trim().min(20).max(1000).describe("Your summary for the specialist: the person's background, programme interest, and their open questions."),
    channel: z.enum(["whatsapp", "call"]),
    callback_number: z.string().trim().regex(/^\+?[\d\s\-()]{7,20}$/, "must be a phone number").nullish().describe("Number to call. Required for calls unless use_whatsapp_number is true."),
    use_whatsapp_number: z.boolean().nullish().describe("For calls: use the WhatsApp number already saved on the lead."),
    preferred_callback_time: z.string().trim().max(40).nullish().describe("Agreed callback time, ISO 8601 with UTC offset."),
  },
  async handler(args, { repo, now }) {
    const lead = await repo.upsertLead(args.contact_id, {});
    let callbackNumber: string | null = null;
    let callbackTime: string | null = null;

    if (args.channel === "call") {
      callbackNumber = args.callback_number ?? (args.use_whatsapp_number ? lead.whatsapp_number : null);
      if (!callbackNumber) {
        return fail(
          "callback_number_required",
          args.use_whatsapp_number
            ? "We don't have their WhatsApp number saved. Ask which number to call, then try again."
            : "Ask which number the specialist should call (or whether to use this WhatsApp number), then try again.",
        );
      }
      if (args.preferred_callback_time) {
        const check = checkCallbackTime(args.preferred_callback_time, now());
        if (!check.ok && check.reason === "invalid_time") {
          return fail("invalid_time", "preferred_callback_time must be ISO 8601 with a UTC offset, e.g. 2026-11-02T14:00:00+01:00. Convert the agreed time and try again.");
        }
        if (!check.ok) {
          return fail(
            "outside_hours",
            "That time is outside Application Specialist hours (or in the past). Nothing was booked. Offer these times (Lagos time) and ask which suits them, then call again with the chosen time.",
            { reason: "outside_hours", alternatives: check.reason === "outside_hours" ? check.alternatives : [] },
          );
        }
        callbackTime = check.time.toUTC().toISO()!;
      }
    }

    await repo.insertHandoff({
      lead_id: lead.id,
      reason: args.reason,
      summary: args.summary,
      channel: args.channel,
      callback_number: callbackNumber,
      callback_time: callbackTime,
    });
    await repo.updateLead(lead.id, { status: "handed_off" });
    log.info("handoff created", { lead_id: lead.id, channel: args.channel, reason: args.reason });

    const window = nextSpecialistWindow(now());
    const booking = { advisor_booking_link: ADVISOR_BOOKING_LINK };

    if (args.channel === "whatsapp") {
      const openNow = isWithinSpecialistHours(now());
      return ok(
        { channel: "whatsapp", specialists_available_now: openNow, ...(!openNow && { next_available: window.opens.display }), ...booking },
        openNow
          ? "Tell them an Application Specialist will pick up this chat shortly. They can also book a consultation with the link."
          : `Tell them an Application Specialist will reply in this chat from ${window.opens.display}. They can also book a consultation with the link.`,
      );
    }
    if (callbackTime) {
      const display = formatForApplicant(DateTime.fromISO(callbackTime));
      return ok(
        { channel: "call", callback_time: display, ...booking },
        `Confirm an Application Specialist will call them around ${display}. Don't promise an exact minute.`,
      );
    }
    return ok(
      { channel: "call", callback_time: null, next_available_window: { opens: window.opens.display, closes: window.closes.display }, ...booking },
      `No time was agreed, so an Application Specialist will call during working hours (${window.open_now ? "from now" : `from ${window.opens.display}`} until ${window.closes.display}). Mention the booking link if they'd rather pick a time.`,
    );
  },
});
