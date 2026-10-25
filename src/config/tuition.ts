import type { ProgrammeId } from "./programmes.js";

export type BillingUnit = "per_month" | "per_course";

export interface Price {
  usd: number;
  unit: BillingUnit;
}

/** Published MBA and BBA prices by country. Never estimate anything not listed here. */
export const PUBLISHED_TUITION: Record<string, Partial<Record<ProgrammeId, Price>>> = {
  "United States": { mba: { usd: 450, unit: "per_month" }, bba: { usd: 250, unit: "per_course" } },
  "Saudi Arabia": { mba: { usd: 320, unit: "per_month" }, bba: { usd: 230, unit: "per_course" } },
  Kenya: { mba: { usd: 300, unit: "per_month" }, bba: { usd: 140, unit: "per_course" } },
  Nigeria: { mba: { usd: 275, unit: "per_month" }, bba: { usd: 120, unit: "per_course" } },
};

/** US rates for other programmes. Only returned when the country is the United States. */
export const US_ONLY_TUITION: Partial<Record<ProgrammeId, Price>> = {
  mba_specialisation: { usd: 450, unit: "per_month" },
  mba_finance: { usd: 470, unit: "per_month" },
  ms_data_analytics: { usd: 470, unit: "per_month" },
  ms_digital_transformation: { usd: 470, unit: "per_month" },
  ms_ai_technology_management: { usd: 470, unit: "per_month" },
  mini_mba: { usd: 450, unit: "per_month" },
  bs_ai_for_business: { usd: 275, unit: "per_course" },
  bas_management_ai: { usd: 300, unit: "per_course" },
  aas_ai_for_business: { usd: 275, unit: "per_course" },
};

/** Example MBA durations (months) used to show totals. */
export const MBA_EXAMPLE_MONTHS = [9, 18];
