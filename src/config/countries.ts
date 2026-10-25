import type { Currency } from "./fx.js";

export interface Country {
  name: string;
  aliases: string[];
  /** Local currency with a published Nexford FX rate, if any. */
  currency?: Currency;
}

export const COUNTRIES: Country[] = [
  { name: "United States", aliases: ["us", "usa", "united states of america", "america"] },
  { name: "Saudi Arabia", aliases: ["ksa", "sa"] },
  { name: "Nigeria", aliases: ["ng"], currency: "NGN" },
  { name: "Ghana", aliases: ["gh"], currency: "GHS" },
  { name: "Kenya", aliases: ["ke"], currency: "KES" },
  { name: "South Africa", aliases: ["za", "rsa"], currency: "ZAR" },
  { name: "Egypt", aliases: ["eg"], currency: "EGP" },
  { name: "Ethiopia", aliases: ["et"], currency: "ETB" },
  { name: "Rwanda", aliases: ["rw"], currency: "RWF" },
  { name: "Tanzania", aliases: ["tz"], currency: "TZS" },
  { name: "Uganda", aliases: ["ug"], currency: "UGX" },
  { name: "Cameroon", aliases: ["cm"], currency: "XAF" },
  { name: "Central African Republic", aliases: ["car"], currency: "XAF" },
  { name: "Chad", aliases: ["td"], currency: "XAF" },
  { name: "Republic of the Congo", aliases: ["congo", "congo brazzaville"], currency: "XAF" },
  { name: "Equatorial Guinea", aliases: ["gq"], currency: "XAF" },
  { name: "Gabon", aliases: ["ga"], currency: "XAF" },
];

const clean = (s: string) => s.toLowerCase().replace(/[^a-z ]/g, " ").replace(/\s+/g, " ").trim();

export function findCountry(input: string | null | undefined): Country | undefined {
  if (!input) return undefined;
  const key = clean(input).replace(/^the /, "");
  return COUNTRIES.find((c) => clean(c.name) === key || c.aliases.includes(key));
}
