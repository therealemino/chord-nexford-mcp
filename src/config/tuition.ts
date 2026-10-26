/**
 * The single source of truth for pricing: every price, tier, country and programme alias, programme fact and
 * exchange rate lives here. No price literals anywhere else in src/ (a test enforces this).
 *
 * Source: Nexford catalogue, "Learner account, tuition and fees".
 */
export const TUITION_SOURCE_URL = "https://catalog.nexford.edu/university-catalog/learner-account-tuition-and-fees";
export const TUITION_CHECKED_ON = "2026-10-26";

// ─── Exchange rates ──────────────────────────────────────────────────────────

/** Nexford's published rates, local currency per USD 1.00. */
export const FX_EFFECTIVE_DATE = "2026-10-01";
export const FX_SOURCE_URL = "https://paynxu.nexford.edu/fxrates";
export const FX_RATES = {
  NGN: 1328.671,
  GHS: 11.704,
  KES: 129.65,
  EGP: 51.941,
  // Published but not attached to any country yet (those countries have no tier).
  ZAR: 16.428,
  ETB: 163.143,
  RWF: 1475.916,
  TZS: 2642.661,
  UGX: 3919.872,
  XAF: 578.258,
} as const;
export type Currency = keyof typeof FX_RATES;

export const CURRENCY_SYMBOLS: Partial<Record<Currency, string>> = { NGN: "₦", GHS: "GH₵", KES: "KSh ", EGP: "E£" };

// ─── Fees and prices ─────────────────────────────────────────────────────────

export const APPLICATION_FEE_USD = 25;
export const APPLICATION_FEE_REFUNDABLE = false;

export type Tier = 1 | 2 | 3 | 4;
export type Billing = "per_month" | "per_course";
export type PricingKey =
  | "mba"
  | "mini_mba"
  | "grad_premium"
  | "bba"
  | "ai_undergrad"
  | "bas_mai"
  | "single_grad_course"
  | "single_undergrad_course";

/** USD price by tier [tier 1, tier 2, tier 3, tier 4]. */
export const PRICES: Record<PricingKey, { billing: Billing; usd: [number, number, number, number] }> = {
  mba: { billing: "per_month", usd: [450, 320, 300, 275] }, // MBA, every specialisation, MBA in Entrepreneurship
  mini_mba: { billing: "per_month", usd: [450, 320, 300, 275] },
  grad_premium: { billing: "per_month", usd: [470, 360, 305, 280] }, // MBA in Finance and the three MS degrees
  bba: { billing: "per_course", usd: [250, 230, 140, 120] }, // BBA (and specialisations), AAS in Business
  ai_undergrad: { billing: "per_course", usd: [275, 250, 150, 130] }, // BS and AAS in AI for Business
  bas_mai: { billing: "per_course", usd: [300, 275, 165, 145] },
  single_grad_course: { billing: "per_course", usd: [500, 320, 220, 215] },
  single_undergrad_course: { billing: "per_course", usd: [490, 250, 155, 120] },
};
// Not offered via the tool: "Undergraduate Career Pathways" (catalogue lists 390/280/185/160 with no billing basis).

// ─── Countries ───────────────────────────────────────────────────────────────

/**
 * Only the example countries the catalogue lists per tier. Never guess any other country.
 * Aliases are matched after lower-casing, stripping accents and punctuation.
 */
export interface Country {
  name: string;
  tier: Tier;
  currency?: Currency;
  aliases: string[];
}
export const COUNTRIES: Country[] = [
  { name: "United States", tier: 1, aliases: ["us", "usa", "united states of america", "america", "the us", "the usa", "states"] },
  {
    name: "United Kingdom",
    tier: 1,
    aliases: ["uk", "gb", "gbr", "great britain", "britain", "england", "scotland", "wales", "northern ireland", "the uk"],
  },
  { name: "Canada", tier: 1, aliases: ["ca", "can"] },
  { name: "China", tier: 2, aliases: ["cn", "chn", "prc", "peoples republic of china", "mainland china"] },
  { name: "Turkey", tier: 2, aliases: ["turkiye", "tr", "tur"] },
  // Not in the tier list, but Nexford's refund-policy examples charge it Tier 2 rates (MBA $320, BBA $230).
  { name: "Saudi Arabia", tier: 2, aliases: ["sa", "sau", "ksa", "saudi", "kingdom of saudi arabia"] },
  { name: "Egypt", tier: 3, currency: "EGP", aliases: ["eg", "egy"] },
  { name: "Indonesia", tier: 3, aliases: ["id", "idn"] },
  { name: "Kenya", tier: 3, currency: "KES", aliases: ["ke", "ken"] },
  { name: "Philippines", tier: 3, aliases: ["ph", "phl", "the philippines"] },
  { name: "Thailand", tier: 3, aliases: ["th", "tha"] },
  { name: "Nigeria", tier: 4, currency: "NGN", aliases: ["ng", "nga", "naija"] },
  { name: "Ghana", tier: 4, currency: "GHS", aliases: ["gh", "gha"] },
];

// ─── Programmes ──────────────────────────────────────────────────────────────

export type ProgrammeLevel = "master" | "bachelor" | "associate" | "certificate" | "course";

export type ProgrammeId =
  | "mba"
  | "mba_specialisation"
  | "mba_finance"
  | "mba_entrepreneurship"
  | "ms_data_analytics"
  | "ms_digital_transformation"
  | "ms_ai_technology_management"
  | "mini_mba"
  | "bba"
  | "aas_business"
  | "bs_ai_for_business"
  | "bas_management_ai"
  | "aas_ai_for_business"
  | "single_grad_course"
  | "single_undergrad_course";

/** Published facts returned with the price. Omitted fields are not stated by Nexford; never invent them. */
export interface ProgrammeFacts {
  courses?: number;
  structure?: string;
  length?: string;
  /** Published fastest/slowest months, used for monthly totals. Only when the catalogue gives a range. */
  months?: [number, number];
}

export interface ProgrammeDef {
  id: ProgrammeId;
  name: string;
  level: ProgrammeLevel;
  pricing: PricingKey;
  facts?: ProgrammeFacts;
  /** Matched against normalised text (see PROGRAMME_STOPWORDS). Order in PROGRAMMES matters. */
  patterns: RegExp[];
}

const MBA_FACTS: ProgrammeFacts = {
  courses: 12,
  structure: "8 core courses, 3 electives or specialisation courses, and a capstone",
  length: "9 to 18 months",
  months: [9, 18],
};
const MS_FACTS = (courses: number, structure: string): ProgrammeFacts => ({ courses, structure, length: "9 to 18 months", months: [9, 18] });

export const MBA_DEF: ProgrammeDef = { id: "mba", name: "MBA", level: "master", pricing: "mba", facts: MBA_FACTS, patterns: [] };
export const MBA_SPECIALISATION_DEF: ProgrammeDef = {
  id: "mba_specialisation",
  name: "MBA specialisation",
  level: "master",
  pricing: "mba",
  facts: MBA_FACTS,
  patterns: [],
};

/** Programmes other than the plain MBA and its specialisations, in matching order (most specific first). */
export const PROGRAMMES: ProgrammeDef[] = [
  {
    id: "single_grad_course",
    name: "Single graduate course",
    level: "course",
    pricing: "single_grad_course",
    patterns: [/\b(single|one|standalone|individual)\b.*\b(graduate|grad|masters?)\b.*\bcourse\b/],
  },
  {
    id: "single_undergrad_course",
    name: "Single undergraduate course",
    level: "course",
    pricing: "single_undergrad_course",
    patterns: [/\b(single|one|standalone|individual)\b.*\b(undergraduate|undergrad|bachelors?)\b.*\bcourse\b/],
  },
  { id: "mini_mba", name: "Mini-MBA", level: "certificate", pricing: "mini_mba", facts: { length: "4 months" }, patterns: [/\bmini ?mba\b/] },
  {
    id: "mba_finance",
    name: "MBA in Finance",
    level: "master",
    pricing: "grad_premium",
    facts: { length: "10 months at the fastest pace" },
    patterns: [/\bmbaf\b/, /\bmba\b.*\bfinance\b/, /\bfinance\b.*\bmba\b/],
  },
  {
    id: "mba_entrepreneurship",
    name: "MBA in Entrepreneurship",
    level: "master",
    pricing: "mba",
    patterns: [/\bmbae\b/, /\bmba\b.*\bentrepreneur/, /\bentrepreneur.*\bmba\b/],
  },
  {
    id: "ms_ai_technology_management",
    name: "MS in AI and Technology Management",
    level: "master",
    pricing: "grad_premium",
    facts: MS_FACTS(13, "9 core courses, 3 electives and a capstone"),
    patterns: [
      /\bmsai\b/,
      /\b(ms|msc|masters?|master science)\b.*\b(ai|artificial intelligence)\b/,
      /\b(ai|artificial intelligence) and tech(nology)? management\b/,
    ],
  },
  {
    id: "ms_data_analytics",
    name: "MS in Data Analytics",
    level: "master",
    pricing: "grad_premium",
    facts: MS_FACTS(12, "11 core courses and a capstone"),
    patterns: [/\bmsda\b/, /\bdata analytics\b/],
  },
  {
    id: "ms_digital_transformation",
    name: "MS in Digital Transformation",
    level: "master",
    pricing: "grad_premium",
    facts: MS_FACTS(12, "11 core courses and a capstone"),
    patterns: [/\bmsdt\b/, /\bdigital transformation\b/],
  },
  {
    id: "bas_management_ai",
    name: "BAS in Management and AI in Business",
    level: "bachelor",
    pricing: "bas_mai",
    facts: { length: "19 months at the fastest pace" },
    patterns: [/\bbasmaib\b/, /\bbas\b/, /\bthree year bachelors?\b/, /\bmanagement and ai\b/],
  },
  {
    id: "aas_ai_for_business",
    name: "AAS in AI for Business",
    level: "associate",
    pricing: "ai_undergrad",
    facts: { length: "12 months at the fastest pace" },
    patterns: [/\baasaib\b/, /\b(aas|associate)\b.*\b(ai|artificial intelligence)\b/],
  },
  {
    id: "aas_business",
    name: "AAS in Business",
    level: "associate",
    pricing: "bba",
    patterns: [/\b(aas|associate)\b.*\bbusiness\b/],
  },
  {
    id: "bba",
    name: "BBA",
    level: "bachelor",
    pricing: "bba",
    facts: { length: "24 months at the fastest pace" },
    patterns: [/\bbba\b/, /\bbachelors? business administration\b/],
  },
  {
    id: "bs_ai_for_business",
    name: "BS in AI for Business",
    level: "bachelor",
    pricing: "ai_undergrad",
    facts: { length: "24 months at the fastest pace" },
    patterns: [/\bbsaib\b/, /\b(bs|bsc|bachelors?)\b.*\b(ai|artificial intelligence)\b/],
  },
];

/** MBA specialisations: priced as the standard MBA. MBA in Finance is not one (it costs more). */
export const MBA_SPECIALISATIONS: { name: string; pattern: RegExp }[] = [
  { name: "AI", pattern: /\b(ai|artificial intelligence)\b/ },
  { name: "Cybersecurity", pattern: /\bcyber ?security\b/ },
  { name: "Enabling E-Commerce", pattern: /\be ?commerce\b/ },
  { name: "Fintech and Blockchain", pattern: /\b(fintech|blockchain)\b/ },
  { name: "International Business", pattern: /\binternational business\b/ },
  { name: "Sustainability", pattern: /\bsustainab/ },
  { name: "Healthcare Management", pattern: /\bhealth ?care\b/ },
];

/** BBA specialisations: priced as the BBA. */
export const BBA_SPECIALISATIONS: { name: string; pattern: RegExp }[] = [
  { name: "AI", pattern: /\b(ai|artificial intelligence)\b/ },
  { name: "Business Analytics", pattern: /\bbusiness analytics\b/ },
  { name: "Digital Marketing", pattern: /\bdigital marketing\b/ },
  { name: "Entrepreneurship", pattern: /\bentrepreneur/ },
];

/** Words dropped before matching programme text. */
export const PROGRAMME_STOPWORDS = ["degree", "programme", "program", "online", "a", "an", "the", "in", "of"];

/** Words that may accompany "MBA" without changing which programme it is. */
export const MBA_FILLER = ["mba", "master", "masters", "business", "administration", "global", "general", "standard", "nexford", "with", "specialisation", "specialization"];

/** Inputs too vague to price: the agent should ask which programme they mean. Keys are normalised text. */
const AI_CANDIDATES = ["MBA in AI", "MS in AI and Technology Management", "BS in AI for Business", "AAS in AI for Business"];
const MASTERS_CANDIDATES = ["MBA", "MBA in Finance", "MS in AI and Technology Management", "MS in Data Analytics", "MS in Digital Transformation"];
const MS_CANDIDATES = ["MS in AI and Technology Management", "MS in Data Analytics", "MS in Digital Transformation"];
const BACHELORS_CANDIDATES = ["BBA", "BS in AI for Business", "BAS in Management and AI in Business"];
const ASSOCIATE_CANDIDATES = ["AAS in Business", "AAS in AI for Business"];
const SINGLE_COURSE_CANDIDATES = ["Single graduate course", "Single undergraduate course"];
export const AMBIGUOUS_PROGRAMMES: Record<string, string[]> = {
  ai: AI_CANDIDATES,
  "artificial intelligence": AI_CANDIDATES,
  master: MASTERS_CANDIDATES,
  masters: MASTERS_CANDIDATES,
  graduate: MASTERS_CANDIDATES,
  ms: MS_CANDIDATES,
  msc: MS_CANDIDATES,
  "master science": MS_CANDIDATES,
  "masters science": MS_CANDIDATES,
  bachelor: BACHELORS_CANDIDATES,
  bachelors: BACHELORS_CANDIDATES,
  undergraduate: BACHELORS_CANDIDATES,
  associate: ASSOCIATE_CANDIDATES,
  aas: ASSOCIATE_CANDIDATES,
  "single course": SINGLE_COURSE_CANDIDATES,
  course: SINGLE_COURSE_CANDIDATES,
};

/** Priced separately by Nexford: hand over instead of quoting. */
export const NOT_OFFERED_PATTERNS = [/\bcareer pathways?\b/, /\bpathway\b/, /\b(constructor|san francisco bay|capella)\b/];

// ─── Notes ───────────────────────────────────────────────────────────────────

export const ENROLLMENT_NOTE = "Rates are confirmed in the Enrollment Agreement at enrolment.";
export const PER_COURSE_NOTE = "Tuition is paid per course; transfer credit can reduce the number of courses.";
/** Shown only from this date (Africa/Lagos). */
export const PAYMENT_MODEL_NOTE_FROM = "2026-12-01";
export const PAYMENT_MODEL_NOTE =
  "Nexford has announced a new payment model from 1 January 2027; confirm with an Application Specialist for start dates after that.";
