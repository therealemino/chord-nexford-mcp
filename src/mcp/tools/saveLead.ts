import { z } from "zod";
import { ok } from "../../lib/result.js";
import { canonicalCountry, canonicalProgramme, contactId, countryField, degreeField, programmeField, provided, publicLead, yearsExperience } from "../shared.js";
import { defineTool } from "../types.js";

export const saveLead = defineTool({
  name: "save_lead",
  description: [
    "Create or update the applicant's record. Call this every time you learn a new fact about the person",
    "(name, email, country, programme, degree, statistics course, experience, WhatsApp number).",
    "Collect these naturally in conversation, one or two at a time; never send a list of questions like a form.",
    "Only the fields you pass are changed; omit anything you don't know. Returns the current record.",
    "Do not read the record back to the person.",
  ].join(" "),
  shape: {
    contact_id: contactId,
    whatsapp_number: z.string().trim().regex(/^\+?[\d\s\-()]{7,20}$/, "must be a phone number").nullish().describe("Phone/WhatsApp number in international format, e.g. +2348030000000, only if the person typed it. You cannot see their number."),
    full_name: z.string().trim().min(1).max(200).nullish(),
    email: z.email().max(254).nullish(),
    country: countryField.nullish(),
    programme: programmeField.nullish(),
    has_bachelors_degree: z.boolean().nullish().describe("Whether the person has completed a bachelor's degree."),
    degree_field: degreeField.nullish(),
    has_statistics_course: z.boolean().nullish().describe("Whether their degree included a statistics course."),
    years_relevant_experience: yearsExperience.nullish(),
  },
  async handler({ contact_id, ...fields }, { repo }) {
    const patch = provided({
      ...fields,
      email: fields.email?.toLowerCase(),
      country: fields.country ? canonicalCountry(fields.country) : undefined,
      programme: fields.programme ? canonicalProgramme(fields.programme) : undefined,
    });
    const lead = await repo.upsertLead(contact_id, patch);
    return ok(
      { lead: publicLead(lead) },
      "Saved. Carry on the conversation naturally; don't mention that you saved anything or repeat their details back unless they ask.",
    );
  },
});
