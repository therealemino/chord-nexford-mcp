import { CURRENCY_SYMBOLS, FX_RATES, type Currency } from "./tuition.js";

export { FX_EFFECTIVE_DATE, FX_RATES, FX_SOURCE_URL, type Currency } from "./tuition.js";

/** Converts USD to whole units of local currency at Nexford's published rate (rounded once). */
export function toLocal(usd: number, currency: Currency): number {
  return Math.round(usd * FX_RATES[currency]);
}

/** "₦372,028", "GH₵1,404", "KSh 38,895" */
export function formatLocal(amount: number, currency: Currency): string {
  return `${CURRENCY_SYMBOLS[currency] ?? `${currency} `}${amount.toLocaleString("en-US")}`;
}

/** "$1,250" */
export const formatUsd = (usd: number) => `$${usd.toLocaleString("en-US")}`;

/** Paystack amounts are in kobo: round to whole naira first, then x100. */
export function usdToKobo(usd: number): number {
  return toLocal(usd, "NGN") * 100;
}
