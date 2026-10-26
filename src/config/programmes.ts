import {
  AMBIGUOUS_PROGRAMMES,
  BBA_SPECIALISATIONS,
  MBA_DEF,
  MBA_FILLER,
  MBA_SPECIALISATION_DEF,
  MBA_SPECIALISATIONS,
  NOT_OFFERED_PATTERNS,
  PROGRAMME_STOPWORDS,
  PROGRAMMES,
  type ProgrammeDef,
} from "./tuition.js";

export type { ProgrammeId, ProgrammeLevel } from "./tuition.js";

/** A recognised programme. `specialisation` is set for MBA and BBA specialisations, e.g. "Fintech and Blockchain". */
export interface Programme extends ProgrammeDef {
  specialisation?: string;
}

export type ProgrammeMatch =
  | { kind: "match"; programme: Programme }
  | { kind: "ambiguous"; candidates: string[] }
  | { kind: "not_offered" }
  | { kind: "unknown" };

export const ALL_PROGRAMMES: ProgrammeDef[] = [MBA_DEF, MBA_SPECIALISATION_DEF, ...PROGRAMMES];
export const PROGRAMME_IDS = ALL_PROGRAMMES.map((p) => p.id);
/** Canonical names, for "did you mean" lists. */
export const KNOWN_PROGRAMME_NAMES = [MBA_DEF.name, "MBA with a specialisation (e.g. MBA in Fintech and Blockchain)", ...PROGRAMMES.map((p) => p.name)];

const STOPWORDS = new Set(PROGRAMME_STOPWORDS);
const FILLER = new Set(MBA_FILLER);

/** Lower-case, strip accents and punctuation, "&" → "and", drop filler words like "degree", "in", "of". */
export function normaliseProgrammeText(input: string): string {
  return input
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/['’.]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .split(" ")
    .filter((w) => w && !STOPWORDS.has(w))
    .join(" ");
}

const withSpecialisation = (base: ProgrammeDef, prefix: string, spec: string): Programme => ({
  ...base,
  name: `${prefix} in ${spec}`,
  specialisation: spec,
});

/** Maps free text ("MSDA", "MBA Fintech & Blockchain", "ms_data_analytics") to a programme, or says why it can't. */
export function resolveProgramme(input: string | null | undefined): ProgrammeMatch {
  if (!input?.trim()) return { kind: "unknown" };
  const id = input.trim().toLowerCase();
  const byId = ALL_PROGRAMMES.find((p) => p.id === id);
  if (byId) return { kind: "match", programme: byId };

  const text = normaliseProgrammeText(input);
  if (!text) return { kind: "unknown" };
  if (AMBIGUOUS_PROGRAMMES[text]) return { kind: "ambiguous", candidates: AMBIGUOUS_PROGRAMMES[text] };
  if (NOT_OFFERED_PATTERNS.some((re) => re.test(text))) return { kind: "not_offered" };

  const isMba =
    /\bmba\b/.test(text) || /\bmasters? business administration\b/.test(text) || /^masters? business$/.test(text);
  const named = PROGRAMMES.find((p) => p.patterns.some((re) => re.test(text)));
  if (named?.id === "bba") {
    const spec = BBA_SPECIALISATIONS.find((s) => s.pattern.test(text));
    return { kind: "match", programme: spec ? withSpecialisation(named, "BBA", spec.name) : named };
  }
  // Named MBA variants (Mini-MBA, Finance, Entrepreneurship) win over the generic MBA handling.
  if (named && (!isMba || /mba/.test(named.id))) return { kind: "match", programme: named };

  if (isMba) {
    const spec = MBA_SPECIALISATIONS.find((s) => s.pattern.test(text));
    if (spec) return { kind: "match", programme: withSpecialisation(MBA_SPECIALISATION_DEF, "MBA", spec.name) };
    if (text.split(" ").every((w) => FILLER.has(w))) return { kind: "match", programme: MBA_DEF };
    return { kind: "unknown" };
  }

  return named ? { kind: "match", programme: named } : { kind: "unknown" };
}

/** The programme, or undefined if it isn't a single recognised programme. */
export function findProgramme(input: string | null | undefined): Programme | undefined {
  const m = resolveProgramme(input);
  return m.kind === "match" ? m.programme : undefined;
}
