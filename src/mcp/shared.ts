import { z } from "zod";
import { findCountry } from "../config/countries.js";
import { DEGREE_FIELDS } from "../config/foundation.js";
import { findProgramme, PROGRAMME_IDS } from "../config/programmes.js";
import { normaliseContactId } from "../lib/contact.js";
import type { Lead } from "../services/types.js";

// LLMs often send null for "not provided", so optional fields accept null and we treat it as absent.
export const contactId = z
  .string()
  .trim()
  .min(1)
  .max(200)
  .transform(normaliseContactId)
  .describe("Stable identifier for the person in this conversation (as provided by Chord).");

export const programmeField = z
  .string()
  .trim()
  .min(2)
  .max(120)
  .describe(
    `Programme the person is interested in, including any MBA specialisation, e.g. "MBA in Fintech and Blockchain". ` +
      `Known ids: ${PROGRAMME_IDS.join(", ")}. MBA in Finance and MBA in Entrepreneurship are separate programmes, not specialisations.`,
  );

/** Appended to every customer tool's agent_guidance. */
export const WHATSAPP_FORMAT =
  "Formatting: this is WhatsApp. Plain text only, no asterisks, no Markdown (no **, #, or [links](...)). " +
  "If you need a section label, put it on its own line ending with a colon. Keep messages short.";

export const countryField = z.string().trim().min(2).max(100).describe("Country of residence, e.g. Nigeria, Ghana, Kenya.");

export const degreeField = z
  .enum(DEGREE_FIELDS)
  .describe("Field of the person's bachelor's degree. Use 'technology' for IT, computing or software; 'other' for anything not listed (e.g. engineering, medicine, law).");

export const yearsExperience = z.number().int().min(0).max(60).describe("Years of relevant professional experience (0 to 60).");

/** Canonical display names where we recognise them; otherwise what the person said. */
export const canonicalProgramme = (p: string) => findProgramme(p)?.name ?? p;
export const canonicalCountry = (c: string) => findCountry(c)?.name ?? c;

/** Strips internal ids/timestamps and empty fields so WhatsApp-bound tool output stays small. */
export function publicLead(lead: Lead) {
  const { id: _id, created_at: _c, updated_at: _u, chord_thread_id: _t, ...rest } = lead;
  return Object.fromEntries(Object.entries(rest).filter(([, v]) => v !== null && !(Array.isArray(v) && v.length === 0)));
}

/** Removes undefined and null so only provided fields are written. */
export function provided<T extends Record<string, unknown>>(obj: T): Partial<{ [K in keyof T]: NonNullable<T[K]> }> {
  return Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== undefined && v !== null)) as never;
}
