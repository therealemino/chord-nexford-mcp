import { DateTime } from "luxon";
import { TUITION_CALCULATOR_LINK } from "../config/constants.js";
import { findCountry } from "../config/countries.js";
import { formatLocal, toLocal, type Currency } from "../config/fx.js";
import { APPLICANT_ZONE } from "../config/hours.js";
import { KNOWN_PROGRAMME_NAMES, resolveProgramme } from "../config/programmes.js";
import {
  APPLICATION_FEE_REFUNDABLE,
  APPLICATION_FEE_USD,
  ENROLLMENT_NOTE,
  PAYMENT_MODEL_NOTE,
  PAYMENT_MODEL_NOTE_FROM,
  PER_COURSE_NOTE,
  PRICES,
  TUITION_CHECKED_ON,
  TUITION_SOURCE_URL,
  type Billing,
  type Tier,
} from "../config/tuition.js";

export interface LocalPrice {
  currency: Currency;
  amount: number;
  formatted: string;
}

export interface TuitionPrice {
  available: true;
  programme: string;
  specialisation: string | null;
  /** The programme id, for saving to the lead. */
  programme_id: string;
  country: string;
  tier: Tier;
  billing: Billing;
  price_usd: number;
  price_local: LocalPrice | null;
  estimates?: {
    fastest_months: number;
    fastest_total_usd: number;
    fastest_total_local?: string;
    slowest_months: number;
    slowest_total_usd: number;
    slowest_total_local?: string;
  };
  programme_facts?: { courses?: number; structure?: string; length?: string };
  application_fee: { usd: number; local: string; refundable: boolean };
  notes: string[];
  source: { url: string; checked_on: string };
}

export type TuitionUnavailable =
  | { available: false; reason: "unknown_country"; programme: string; country: string; calculator_url: string }
  | { available: false; reason: "unknown_programme"; programme: string; known_programmes: string[] }
  | { available: false; reason: "ambiguous_programme"; programme: string; candidates: string[] }
  | { available: false; reason: "not_offered_via_tool"; programme: string };

export type TuitionQuote = TuitionPrice | TuitionUnavailable;

/**
 * Nexford's published tuition for a programme in a country. Never estimates: anything not in the tuition config
 * comes back as available: false with a reason.
 */
export function quoteTuition(programmeInput: string, countryInput: string, now: DateTime): TuitionQuote {
  const match = resolveProgramme(programmeInput);
  if (match.kind === "ambiguous") return { available: false, reason: "ambiguous_programme", programme: programmeInput, candidates: match.candidates };
  if (match.kind === "not_offered") return { available: false, reason: "not_offered_via_tool", programme: programmeInput };
  if (match.kind === "unknown") return { available: false, reason: "unknown_programme", programme: programmeInput, known_programmes: KNOWN_PROGRAMME_NAMES };
  const programme = match.programme;

  const country = findCountry(countryInput);
  if (!country) {
    return { available: false, reason: "unknown_country", programme: programme.name, country: countryInput.trim(), calculator_url: TUITION_CALCULATOR_LINK };
  }

  const { billing, usd } = PRICES[programme.pricing];
  const price = usd[country.tier - 1];
  const local = (amountUsd: number): LocalPrice | null => {
    if (!country.currency) return null;
    const amount = toLocal(amountUsd, country.currency);
    return { currency: country.currency, amount, formatted: formatLocal(amount, country.currency) };
  };

  const months = billing === "per_month" ? programme.facts?.months : undefined;
  const estimates = months && {
    fastest_months: months[0],
    fastest_total_usd: price * months[0],
    ...(country.currency && { fastest_total_local: local(price * months[0])!.formatted }),
    slowest_months: months[1],
    slowest_total_usd: price * months[1],
    ...(country.currency && { slowest_total_local: local(price * months[1])!.formatted }),
  };

  const { months: _m, ...facts } = programme.facts ?? {};
  const lagosToday = now.setZone(APPLICANT_ZONE).toISODate()!;
  const notes = [
    ENROLLMENT_NOTE,
    ...(billing === "per_course" ? [PER_COURSE_NOTE] : []),
    ...(lagosToday >= PAYMENT_MODEL_NOTE_FROM ? [PAYMENT_MODEL_NOTE] : []),
  ];

  return {
    available: true,
    programme: programme.name,
    specialisation: programme.specialisation ?? null,
    programme_id: programme.id,
    country: country.name,
    tier: country.tier,
    billing,
    price_usd: price,
    price_local: local(price),
    ...(estimates && { estimates }),
    ...(Object.keys(facts).length > 0 && { programme_facts: facts }),
    application_fee: {
      usd: APPLICATION_FEE_USD,
      local: formatLocal(toLocal(APPLICATION_FEE_USD, "NGN"), "NGN"), // always charged in naira via Paystack
      refundable: APPLICATION_FEE_REFUNDABLE,
    },
    notes,
    source: { url: TUITION_SOURCE_URL, checked_on: TUITION_CHECKED_ON },
  };
}
