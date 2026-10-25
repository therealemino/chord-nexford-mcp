export type ProgrammeLevel = "master" | "bachelor" | "associate" | "certificate";

export type ProgrammeId =
  | "mba"
  | "mba_specialisation"
  | "mba_finance"
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
  /** Tested in order against the cleaned, lower-cased input. */
  patterns: RegExp[];
}

// Order matters: more specific programmes first (Mini-MBA and MBA in Finance before MBA).
export const PROGRAMMES: Programme[] = [
  { id: "mini_mba", name: "Mini-MBA", level: "certificate", patterns: [/\bmini ?mba\b/] },
  { id: "mba_finance", name: "MBA in Finance", level: "master", patterns: [/\bmba\b.*\bfinance\b/, /\bfinance\b.*\bmba\b/] },
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

const MBA_FILLER = new Set(["mba", "master", "masters", "of", "business", "administration", "in", "the", "a", "an",
  "global", "online", "programme", "program", "degree", "general", "standard", "nexford"]);

const clean = (s: string) => s.toLowerCase().replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();

const byId = (id: ProgrammeId) => ALL_PROGRAMMES.find((p) => p.id === id)!;

const MBA: Programme = { id: "mba", name: "MBA", level: "master", patterns: [] };
const MBA_SPECIALISATION: Programme = { id: "mba_specialisation", name: "MBA specialisation", level: "master", patterns: [] };
export const ALL_PROGRAMMES: Programme[] = [MBA, MBA_SPECIALISATION, ...PROGRAMMES];

export const PROGRAMME_IDS = ALL_PROGRAMMES.map((p) => p.id);

/**
 * Maps free text ("MBA", "an MBA in Marketing", "ms_data_analytics") to a known programme.
 * Returns undefined for anything we don't recognise.
 */
export function findProgramme(input: string | null | undefined): Programme | undefined {
  if (!input) return undefined;
  const raw = input.trim().toLowerCase();
  if ((PROGRAMME_IDS as string[]).includes(raw)) return byId(raw as ProgrammeId);

  const text = clean(input);
  const matched = PROGRAMMES.find((p) => p.patterns.some((re) => re.test(text)));
  if (matched) return matched;

  const isMba = /\bmba\b/.test(text) || /\bmaster of business administration\b/.test(text);
  if (!isMba) return undefined;
  const rest = text.split(" ").filter((w) => !MBA_FILLER.has(w));
  return rest.length === 0 ? MBA : MBA_SPECIALISATION;
}
