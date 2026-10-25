import { z } from "zod";
import { ADVISOR_BOOKING_LINK } from "../../config/constants.js";
import { assessEligibility as assess, type Assessment } from "../../lib/eligibility.js";
import { advanceStatus } from "../../lib/leadStatus.js";
import { ok } from "../../lib/result.js";
import { canonicalProgramme, contactId, degreeField, programmeField, provided, yearsExperience } from "../shared.js";
import { defineTool } from "../types.js";

const ALWAYS = "Only Nexford makes admission decisions. Say 'likely', never 'you are admitted' or 'you qualify'.";

function guidance(a: Assessment): string {
  const courses = a.foundation_courses.map((c) => `${c.code} ${c.name}`).join(" and ");
  switch (a.result) {
    case "need_more_info":
      return `Ask naturally for: ${a.missing_fields.join(", ")} (one question at a time), then call assess_eligibility again.`;
    case "not_eligible":
      return `Master's programmes need a completed bachelor's degree. Kindly explain this, suggest a bachelor's programme such as the BBA, and offer to connect them with an Application Specialist. ${ALWAYS}`;
    case "advisor_review":
      return `There is no published foundation rule for this programme. Say an Application Specialist will confirm entry requirements and offer a handoff. ${ALWAYS}`;
    case "direct_entry":
      return `Tell them that, based on what they've shared, they likely won't need a foundation course. ${ALWAYS}`;
    case "foundation_likely":
      return (
        `Tell them they will likely need ${courses} before starting the core programme. ` +
        (a.waiver_can_be_requested
          ? "With 3+ years of relevant experience they can ask for a waiver during admissions; it may be granted or not, so never promise it. "
          : "A waiver can be requested with 3+ years of relevant experience or a relevant certification; never promise one. ") +
        ALWAYS
      );
  }
}

export const assessEligibilityTool = defineTool({
  name: "assess_eligibility",
  description: [
    "Check whether the person is likely to need a foundation course for a programme, based on Nexford's published rules.",
    "Call it once you know the programme, whether they have a bachelor's degree, their degree field and, for MS Data Analytics,",
    "whether they've taken a statistics course. Facts not passed are taken from the saved record.",
    "Returns result: direct_entry | foundation_likely | advisor_review | not_eligible | need_more_info, plus any foundation course codes.",
    "Work experience is NOT required to apply. Never present the result as an admission decision.",
  ].join(" "),
  shape: {
    contact_id: contactId,
    programme: programmeField.nullish(),
    has_bachelors_degree: z.boolean().nullish(),
    degree_field: degreeField.nullish(),
    has_statistics_course: z.boolean().nullish().describe("Required only for MS Data Analytics."),
    years_relevant_experience: yearsExperience.nullish(),
  },
  async handler({ contact_id, ...input }, { repo }) {
    const facts = provided({ ...input, programme: input.programme ? canonicalProgramme(input.programme) : undefined });
    let lead = await repo.upsertLead(contact_id, facts);

    if (!lead.programme) {
      return ok({ result: "need_more_info", missing_fields: ["programme"] }, "Ask which programme they're interested in, then call assess_eligibility again.");
    }

    const a = assess({
      programme: lead.programme,
      has_bachelors_degree: lead.has_bachelors_degree,
      degree_field: lead.degree_field,
      has_statistics_course: lead.has_statistics_course,
      years_relevant_experience: lead.years_relevant_experience,
    });

    if (a.result !== "need_more_info") {
      lead = await repo.updateLead(lead.id, {
        eligibility_result: a.result,
        foundation_courses: a.foundation_courses.map((c) => c.code),
        ...(a.result !== "not_eligible" && { status: advanceStatus(lead.status, "qualified") }),
      });
    }

    return ok(
      {
        result: a.result,
        programme: a.programme?.name ?? lead.programme,
        foundation_courses: a.foundation_courses,
        waiver_can_be_requested: a.waiver_can_be_requested,
        ...(a.missing_fields.length > 0 && { missing_fields: a.missing_fields }),
        ...((a.result === "advisor_review" || a.result === "not_eligible") && { advisor_booking_link: ADVISOR_BOOKING_LINK }),
      },
      guidance(a),
    );
  },
});
