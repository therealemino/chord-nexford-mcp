import type { LeadStatus } from "../services/types.js";

const ORDER: LeadStatus[] = ["enquiring", "qualified", "applied", "paid"];

/**
 * Moves a lead forward through enquiring → qualified → applied → paid, never backwards.
 * handed_off is set directly by the handoff tool; "paid" is always applied by the payment path.
 */
export function advanceStatus(current: LeadStatus, next: LeadStatus): LeadStatus {
  if (next === "paid" || next === "handed_off") return next;
  if (current === "handed_off" || current === "paid") return current;
  return ORDER.indexOf(next) > ORDER.indexOf(current) ? next : current;
}
