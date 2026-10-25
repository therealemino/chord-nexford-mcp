import { DateTime } from "luxon";
import {
  APPLICANT_ZONE,
  APPLICANT_ZONE_LABEL,
  SLOT_MIN_LEAD_HOURS,
  SLOT_SUGGESTION_COUNT,
  SPECIALIST_CLOSE_HOUR,
  SPECIALIST_OPEN_HOUR,
  SPECIALIST_ZONE,
} from "../config/hours.js";

export function isWithinSpecialistHours(dt: DateTime): boolean {
  const ny = dt.setZone(SPECIALIST_ZONE);
  return ny.hour >= SPECIALIST_OPEN_HOUR && ny.hour < SPECIALIST_CLOSE_HOUR;
}

/** "Mon 2 Nov, 1:00 PM (Lagos time)" */
export function formatForApplicant(dt: DateTime): string {
  return `${dt.setZone(APPLICANT_ZONE).toFormat("ccc d LLL, h:mm a")} (${APPLICANT_ZONE_LABEL})`;
}

export interface Slot {
  iso: string;
  display: string;
}

const toSlot = (dt: DateTime): Slot => ({ iso: dt.toUTC().toISO()!, display: formatForApplicant(dt) });

/** Next callback start times: on the hour, at least an hour from now, starting while specialists are working. */
export function nextCallbackSlots(now: DateTime, count = SLOT_SUGGESTION_COUNT): Slot[] {
  const earliest = now.plus({ hours: SLOT_MIN_LEAD_HOURS });
  let candidate = earliest.setZone(SPECIALIST_ZONE).startOf("hour");
  if (candidate < earliest) candidate = candidate.plus({ hours: 1 });

  const slots: Slot[] = [];
  for (let i = 0; i < 24 * 7 && slots.length < count; i++, candidate = candidate.plus({ hours: 1 })) {
    if (isWithinSpecialistHours(candidate)) slots.push(toSlot(candidate));
  }
  return slots;
}

/** The current window if specialists are working now, otherwise the next one. */
export function nextSpecialistWindow(now: DateTime): { open_now: boolean; opens: Slot; closes: Slot } {
  const ny = now.setZone(SPECIALIST_ZONE);
  const todayOpen = ny.set({ hour: SPECIALIST_OPEN_HOUR, minute: 0, second: 0, millisecond: 0 });
  const open_now = isWithinSpecialistHours(now);
  const opens = open_now ? ny : ny.hour < SPECIALIST_OPEN_HOUR ? todayOpen : todayOpen.plus({ days: 1 });
  const closes = opens.set({ hour: SPECIALIST_CLOSE_HOUR, minute: 0, second: 0, millisecond: 0 });
  return { open_now, opens: toSlot(opens), closes: toSlot(closes) };
}

export type CallbackCheck =
  | { ok: true; time: DateTime }
  | { ok: false; reason: "invalid_time" }
  | { ok: false; reason: "outside_hours"; alternatives: Slot[] };

const OFFSET_RE = /(Z|[+-]\d{2}(:?\d{2})?)$/i;

/** Accepts a preferred callback time only if it is in the future and inside specialist hours. */
export function checkCallbackTime(preferredIso: string, now: DateTime): CallbackCheck {
  const dt = DateTime.fromISO(preferredIso, { setZone: true });
  if (!dt.isValid || !OFFSET_RE.test(preferredIso.trim())) return { ok: false, reason: "invalid_time" };
  if (dt > now && isWithinSpecialistHours(dt)) return { ok: true, time: dt };
  return { ok: false, reason: "outside_hours", alternatives: nextCallbackSlots(now) };
}
