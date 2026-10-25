import {
  BUSINESS_FIELDS,
  FOUNDATION_COURSES,
  TECHNOLOGY_FIELDS,
  WAIVER_MIN_YEARS,
  type DegreeField,
  type FoundationCourse,
} from "../config/foundation.js";
import { findProgramme, type Programme } from "../config/programmes.js";

export type EligibilityResult = "direct_entry" | "foundation_likely" | "advisor_review" | "not_eligible" | "need_more_info";

export interface EligibilityInput {
  programme: string;
  has_bachelors_degree?: boolean | null;
  degree_field?: DegreeField | null;
  has_statistics_course?: boolean | null;
  years_relevant_experience?: number | null;
}

export interface Assessment {
  result: EligibilityResult;
  programme: Programme | undefined;
  foundation_courses: FoundationCourse[];
  waiver_can_be_requested: boolean;
  missing_fields: string[];
}

const { FND5100, STA1300, FDT5001 } = FOUNDATION_COURSES;

/** Foundation courses for a master's programme, or null when Nexford publishes no rule for it. */
function foundationFor(p: Programme, field: DegreeField, hasStats: boolean | null | undefined): FoundationCourse[] | null {
  const business = BUSINESS_FIELDS.includes(field);
  const tech = TECHNOLOGY_FIELDS.includes(field);
  switch (p.id) {
    case "mba":
    case "mba_specialisation":
    case "mba_finance": // business, finance, accounting (and economics, as a business field) enter directly
      return business ? [] : [FND5100];
    case "ms_ai_technology_management":
    case "ms_digital_transformation":
      return business || tech ? [] : [FDT5001];
    case "ms_data_analytics":
      return [...(business ? [] : [FND5100]), ...(hasStats ? [] : [STA1300])];
    default:
      return null;
  }
}

/** Pure foundation-course assessment. Only Nexford makes admission decisions; this is "likely" at best. */
export function assessEligibility(input: EligibilityInput): Assessment {
  const programme = findProgramme(input.programme);
  const base = { programme, foundation_courses: [], waiver_can_be_requested: false, missing_fields: [] };

  const hasRule = programme?.level === "master" && foundationFor(programme, "business", true) !== null;
  if (!programme || !hasRule) return { ...base, result: "advisor_review" };
  if (input.has_bachelors_degree === false) return { ...base, result: "not_eligible" };

  const missing: string[] = [];
  if (input.has_bachelors_degree == null) missing.push("has_bachelors_degree");
  if (input.degree_field == null) missing.push("degree_field");
  if (programme.id === "ms_data_analytics" && input.has_statistics_course == null) missing.push("has_statistics_course");
  if (missing.length > 0) return { ...base, result: "need_more_info", missing_fields: missing };

  const courses = foundationFor(programme, input.degree_field!, input.has_statistics_course)!;
  if (courses.length === 0) return { ...base, result: "direct_entry" };
  return {
    ...base,
    result: "foundation_likely",
    foundation_courses: courses,
    waiver_can_be_requested: (input.years_relevant_experience ?? 0) >= WAIVER_MIN_YEARS,
  };
}

/** A foundation waiver can be requested (never promised) with enough relevant experience. */
export const waiverRequestable = (eligibility: string | null, years: number | null): boolean =>
  eligibility === "foundation_likely" && (years ?? 0) >= WAIVER_MIN_YEARS;
