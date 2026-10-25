import { findCountry } from "../config/countries.js";
import { toLocal, type Currency } from "../config/fx.js";
import { findProgramme } from "../config/programmes.js";
import { MBA_EXAMPLE_MONTHS, PRICED_AS, PUBLISHED_TUITION, US_ONLY_TUITION, type BillingUnit, type Price } from "../config/tuition.js";

export interface Money {
  currency: Currency;
  amount: number;
}

export type TuitionQuote =
  | {
      available: true;
      programme: string;
      specialisation?: string;
      country: string;
      usd: number;
      billing_unit: BillingUnit;
      local?: Money;
      examples?: { months: number; usd: number; local?: Money }[];
    }
  | { available: false; programme: string; country: string; reason: "unknown_programme" | "not_published" };

/** Looks up published tuition only. Returns available: false rather than ever estimating. */
export function quoteTuition(programmeInput: string, countryInput: string): TuitionQuote {
  const programme = findProgramme(programmeInput);
  const country = findCountry(countryInput);
  const countryName = country?.name ?? countryInput;
  if (!programme) return { available: false, programme: programmeInput, country: countryName, reason: "unknown_programme" };

  const priceId = PRICED_AS[programme.id] ?? programme.id;
  let price: Price | undefined = country ? PUBLISHED_TUITION[country.name]?.[priceId] : undefined;
  if (!price && country?.name === "United States") price = US_ONLY_TUITION[priceId];
  if (!price || !country) return { available: false, programme: programme.name, country: countryName, reason: "not_published" };

  const local = (usd: number): Money | undefined =>
    country.currency ? { currency: country.currency, amount: toLocal(usd, country.currency) } : undefined;

  return {
    available: true,
    programme: programme.name,
    specialisation: programme.specialisation,
    country: country.name,
    usd: price.usd,
    billing_unit: price.unit,
    local: local(price.usd),
    examples:
      priceId === "mba"
        ? MBA_EXAMPLE_MONTHS.map((months) => ({ months, usd: price.usd * months, local: local(price.usd * months) }))
        : undefined,
  };
}
