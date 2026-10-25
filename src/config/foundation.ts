export const FOUNDATION_COURSES = {
  FND5100: { code: "FND 5100", name: "Business Fundamentals" },
  STA1300: { code: "STA 1300", name: "Statistics" },
  FDT5001: { code: "FDT 5001", name: "Foundations of Digital Transformation" },
} as const;

export type FoundationCourse = (typeof FOUNDATION_COURSES)[keyof typeof FOUNDATION_COURSES];

export const DEGREE_FIELDS = ["business", "finance", "accounting", "economics", "technology", "other"] as const;
export type DegreeField = (typeof DEGREE_FIELDS)[number];

/** Fields treated as a business background for every rule. */
export const BUSINESS_FIELDS: readonly DegreeField[] = ["business", "finance", "accounting", "economics"];
export const TECHNOLOGY_FIELDS: readonly DegreeField[] = ["technology"];

/** Minimum years of relevant experience to *request* a foundation waiver (never promised). */
export const WAIVER_MIN_YEARS = 3;
