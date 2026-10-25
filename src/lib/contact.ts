/**
 * The single place that knows what a Chord contact_id looks like.
 *
 * Open question: we don't yet know whether Chord gives the agent a phone number or an opaque id.
 * If it looks like a phone number we reduce it to digits so "+234 803 000 0000" and "2348030000000"
 * map to the same lead; anything else is treated as an opaque string. Change only this function
 * if Chord's identifier turns out to be different.
 */
export function normaliseContactId(raw: string): string {
  const trimmed = raw.trim();
  if (/^\+?[\d\s\-().]{7,}$/.test(trimmed)) return trimmed.replace(/\D/g, "");
  return trimmed;
}
