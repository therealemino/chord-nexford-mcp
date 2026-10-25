/** Nexford's published exchange rates, effective 2026-10-01, local currency per USD 1.00. */
export const FX_EFFECTIVE_DATE = "2026-10-01";

export const FX_RATES = {
  NGN: 1328.671,
  GHS: 11.704,
  KES: 129.65,
  ZAR: 16.428,
  EGP: 51.941,
  ETB: 163.143,
  RWF: 1475.916,
  TZS: 2642.661,
  UGX: 3919.872,
  XAF: 578.258,
} as const;

export type Currency = keyof typeof FX_RATES;

/** Converts USD to whole units of local currency at Nexford's published rate. */
export function toLocal(usd: number, currency: Currency): number {
  return Math.round(usd * FX_RATES[currency]);
}

/** Paystack amounts are in kobo: round to whole naira first, then x100. */
export function usdToKobo(usd: number): number {
  return toLocal(usd, "NGN") * 100;
}
