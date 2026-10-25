export type ProgrammeLevel = "master" | "bachelor" | "associate" | "certificate";

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
  | "bs_ai_for_business"
  | "bas_management_ai"
  | "aas_ai_for_business";

export interface Programme {
  id: ProgrammeId;
  name: string;
  level: ProgrammeLevel;
  /** Set for MBA specialisations, e.g. "Fintech and Blockchain". */
  specialisation?: string;
  /** Tested in order against the cleaned, lower-cased input. */
  patterns: RegExp[];
}

// Order matters: more specific programmes first (Mini-MBA and MBA in Finance before MBA).
export const PROGRAMMES: Programme[] = [
  { id: "mini_mba", name: "Mini-MBA", level: "certificate", patterns: [/\bmini ?mba\b/] },
  { id: "mba_finance", name: "MBA in Finance", level: "master", patterns: [/\bmba\b.*\bfinance\b/, /\bfinance\b.*\bmba\b/] },
  {
    id: "mba_entrepreneurship",
    name: "MBA in Entrepreneurship",
    level: "master",
    patterns: [/\bmba\b.*\bentrepreneur/, /\bentrepreneur.*\bmba\b/],
  },
  {
    id: "ms_data_analytics",
    name: "MS Data Analytics",
    level: "master",
    patterns: [/\bmsda\b/, /\bdata analytics\b/],
  },
  {
    id: "ms_digital_transformation",
    name: "MS Digital Transformation",
    level: "master",
    patterns: [/\bmsdt\b/, /\bdigital transformation\b/],
  },
  {
    id: "ms_ai_technology_management",
    name: "MS AI and Technology Management",
    level: "master",
    patterns: [/\b(ai|artificial intelligence)\b.*\btechnology management\b/],
  },
  {
    id: "bas_management_ai",
    name: "BAS Management and AI",
    level: "bachelor",
    patterns: [/\bbas\b/, /\bapplied science\b.*\bmanagement\b/],
  },
  {
    id: "aas_ai_for_business",
    name: "AAS AI for Business",
    level: "associate",
    patterns: [/\baas\b/, /\bassociate\b/],
  },
  {
    id: "bs_ai_for_business",
    name: "BS AI for Business",
    level: "bachelor",
    patterns: [/\bbs\b.*\b(ai|artificial intelligence)\b/, /\bbachelor of science\b.*\b(ai|artificial intelligence)\b/],
  },
  { id: "bba", name: "BBA", level: "bachelor", patterns: [/\bbba\b/, /\bbachelor of business administration\b/] },
];

/** MBA specialisations: priced and assessed as the standard MBA. MBA in Finance and in Entrepreneurship are separate programmes. */
export const MBA_SPECIALISATIONS: { name: string; pattern: RegExp }[] = [
  { name: "AI", pattern: /\b(ai|artificial intelligence)\b/ },
  { name: "Cybersecurity", pattern: /\bcyber ?security\b/ },
  { name: "Enabling E-Commerce", pattern: /\be ?commerce\b/ },
  { name: "Fintech and Blockchain", pattern: /\b(fintech|blockchain)\b/ },
  { name: "International Business", pattern: /\binternational business\b/ },
  { name: "Sustainability", pattern: /\bsustainab/ },
  { name: "Healthcare Management", pattern: /\bhealth ?care\b/ },
];

const MBA_FILLER = new Set(["mba", "master", "masters", "of", "business", "administration", "in", "the", "a", "an",
  "global", "online", "programme", "program", "degree", "general", "standard", "nexford"]);

const clean = (s: string) => s.toLowerCase().replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();

const byId = (id: ProgrammeId) => ALL_PROGRAMMES.find((p) => p.id === id)!;

const MBA: Programme = { id: "mba", name: "MBA", level: "master", patterns: [] };
const MBA_SPECIALISATION: Programme = { id: "mba_specialisation", name: "MBA specialisation", level: "master", patterns: [] };
export const ALL_PROGRAMMES: Programme[] = [MBA, MBA_SPECIALISATION, ...PROGRAMMES];

export const PROGRAMME_IDS = ALL_PROGRAMMES.map((p) => p.id);

/** "MBA with a Fintech and Blockchain specialisation", "MBA with an AI specialisation" */
const specialisationName = (spec: string) => `MBA with ${/^[aeiou]/i.test(spec) ? "an" : "a"} ${spec} specialisation`;

/**
 * Maps free text ("MBA", "MBA in Fintech", "ms_data_analytics") to a known programme.
 * Returns undefined for anything we don't recognise, including MBA variants that aren't published specialisations.
 */
export function findProgramme(input: string | null | undefined): Programme | undefined {
  if (!input) return undefined;
  const raw = input.trim().toLowerCase();
  if ((PROGRAMME_IDS as string[]).includes(raw)) return byId(raw as ProgrammeId);

  const text = clean(input);
  const isMba = /\bmba\b/.test(text) || /\bmaster of business administration\b/.test(text);
  if (!isMba) return PROGRAMMES.find((p) => p.patterns.some((re) => re.test(text)));

  const named = PROGRAMMES.find((p) => p.patterns.some((re) => re.test(text))); // Mini-MBA, Finance, Entrepreneurship
  if (named) return named;
  const spec = MBA_SPECIALISATIONS.find((s) => s.pattern.test(text));
  if (spec) return { ...MBA_SPECIALISATION, name: specialisationName(spec.name), specialisation: spec.name };
  return text.split(" ").every((w) => MBA_FILLER.has(w)) ? MBA : undefined;
}
