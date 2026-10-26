import { COUNTRIES, type Country } from "./tuition.js";

export type { Country } from "./tuition.js";

const normalise = (s: string) =>
  s
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/['’.]/g, "")
    .replace(/[^a-z ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

/** Only countries with a published Nexford tier. Accepts names, ISO alpha-2/alpha-3 codes and common aliases. */
export function findCountry(input: string | null | undefined): Country | undefined {
  if (!input) return undefined;
  const key = normalise(input);
  return COUNTRIES.find((c) => normalise(c.name) === key || c.aliases.includes(key));
}
