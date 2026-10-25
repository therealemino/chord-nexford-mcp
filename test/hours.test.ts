import { DateTime } from "luxon";
import { describe, expect, it } from "vitest";
import { checkCallbackTime, nextCallbackSlots, nextSpecialistWindow } from "../src/lib/hours.js";

const lagos = (iso: string) => DateTime.fromISO(iso, { zone: "Africa/Lagos" });

describe("callback hours", () => {
  // Monday 26 Oct 2026, 08:00 Lagos (03:00 New York, EDT)
  const now = lagos("2026-10-26T08:00");

  it("accepts a future time inside specialist hours", () => {
    const r = checkCallbackTime("2026-10-26T15:00:00+01:00", now); // 10:00 New York
    expect(r.ok).toBe(true);
  });

  it("rejects 9am Lagos and offers three on-the-hour alternatives in Lagos time", () => {
    const r = checkCallbackTime("2026-10-26T09:00:00+01:00", now); // 04:00 New York
    expect(r).toMatchObject({ ok: false, reason: "outside_hours" });
    if (r.ok || r.reason !== "outside_hours") throw new Error("unreachable");
    expect(r.alternatives.map((s) => s.display)).toEqual([
      "Mon 26 Oct, 12:00 PM (Lagos time)",
      "Mon 26 Oct, 1:00 PM (Lagos time)",
      "Mon 26 Oct, 2:00 PM (Lagos time)",
    ]);
  });

  it("rejects past times and times without an offset", () => {
    expect(checkCallbackTime("2026-10-25T15:00:00+01:00", now)).toMatchObject({ ok: false, reason: "outside_hours" });
    expect(checkCallbackTime("2026-10-26T15:00:00", now)).toEqual({ ok: false, reason: "invalid_time" });
    expect(checkCallbackTime("tomorrow afternoon", now)).toEqual({ ok: false, reason: "invalid_time" });
  });

  it("alternatives are at least an hour from now", () => {
    const slots = nextCallbackSlots(lagos("2026-10-26T14:10"));
    expect(slots[0].display).toBe("Mon 26 Oct, 4:00 PM (Lagos time)");
  });

  it("alternatives roll over to the next day after closing", () => {
    // 22:30 Lagos = 17:30 New York; next slot is 07:00 New York next day = 12:00 Lagos
    const slots = nextCallbackSlots(lagos("2026-10-26T22:30"));
    expect(slots.map((s) => s.display)).toEqual([
      "Tue 27 Oct, 12:00 PM (Lagos time)",
      "Tue 27 Oct, 1:00 PM (Lagos time)",
      "Tue 27 Oct, 2:00 PM (Lagos time)",
    ]);
  });
});

describe("US daylight saving change (1 Nov 2026)", () => {
  const now = lagos("2026-10-30T08:00");

  it("12:30 Lagos is inside hours before the change (07:30 EDT)", () => {
    expect(checkCallbackTime("2026-10-31T12:30:00+01:00", now).ok).toBe(true);
  });

  it("12:30 Lagos is outside hours after the change (06:30 EST)", () => {
    expect(checkCallbackTime("2026-11-02T12:30:00+01:00", now)).toMatchObject({ ok: false, reason: "outside_hours" });
    expect(checkCallbackTime("2026-11-02T13:00:00+01:00", now).ok).toBe(true);
  });

  it("closing moves from 23:00 to 00:00 Lagos", () => {
    expect(checkCallbackTime("2026-10-31T22:30:00+01:00", now).ok).toBe(true); // 17:30 EDT
    expect(checkCallbackTime("2026-10-31T23:30:00+01:00", now).ok).toBe(false); // 18:30 EDT
    expect(checkCallbackTime("2026-11-02T23:30:00+01:00", now).ok).toBe(true); // 17:30 EST
  });

  it("suggested slots after the change start at 13:00 Lagos", () => {
    const slots = nextCallbackSlots(lagos("2026-11-01T23:30")); // 17:30 EST Sunday
    expect(slots[0].display).toBe("Mon 2 Nov, 1:00 PM (Lagos time)");
  });

  it("next window reflects the new offset", () => {
    const w = nextSpecialistWindow(lagos("2026-11-02T08:00"));
    expect(w.open_now).toBe(false);
    expect(w.opens.display).toBe("Mon 2 Nov, 1:00 PM (Lagos time)");
    expect(w.closes.display).toBe("Tue 3 Nov, 12:00 AM (Lagos time)");
  });
});
