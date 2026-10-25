import { DateTime } from "luxon";
import { APPLICANT_ZONE } from "../config/hours.js";
import type { Handoff, Lead, Payment } from "../services/types.js";

export const PERIODS = ["today", "yesterday", "last_7_days", "last_30_days"] as const;
export type Period = (typeof PERIODS)[number];

/** Period boundaries in Lagos time: [from, to). "last_7_days" is today plus the previous 6 days. */
export function periodRange(period: Period, now: DateTime): { from: DateTime; to: DateTime; label: string } {
  const lagosNow = now.setZone(APPLICANT_ZONE);
  const today = lagosNow.startOf("day");
  const [from, to] = {
    today: [today, lagosNow],
    yesterday: [today.minus({ days: 1 }), today],
    last_7_days: [today.minus({ days: 6 }), lagosNow],
    last_30_days: [today.minus({ days: 29 }), lagosNow],
  }[period];
  const lastDay = to.minus({ milliseconds: 1 });
  const fmt = (d: DateTime) => d.toFormat("ccc d LLL");
  const label = from.hasSame(lastDay, "day") ? fmt(from) : `${fmt(from)} to ${fmt(lastDay)}`;
  return { from, to, label: `${label} (Lagos time)` };
}

/** A callback is overdue when its agreed time has passed and nobody has picked it up yet. */
export const isOverdue = (h: Pick<Handoff, "status" | "callback_time">, now: DateTime): boolean =>
  h.status === "pending" && !!h.callback_time && DateTime.fromISO(h.callback_time) < now;

const pct = (n: number, d: number) => (d === 0 ? null : `${Math.round((n / d) * 100)}%`);

export function summarisePipeline(newLeads: Lead[], paidPayments: Payment[], pendingHandoffs: Handoff[], now: DateTime) {
  const assessed = newLeads.filter((l) => l.eligibility_result !== null);
  const qualified = assessed.filter((l) => l.eligibility_result !== "not_eligible").length;
  const foundationLikely = assessed.filter((l) => l.eligibility_result === "foundation_likely").length;
  const paid = new Set(paidPayments.map((p) => p.lead_id)).size;

  const counts = new Map<string, number>();
  for (const l of newLeads) counts.set(l.programme ?? "Not given", (counts.get(l.programme ?? "Not given") ?? 0) + 1);

  return {
    new_leads: newLeads.length,
    qualified,
    paid,
    conversion_rate: pct(paid, newLeads.length),
    by_programme: [...counts].sort((a, b) => b[1] - a[1]).map(([programme, leads]) => ({ programme, leads })),
    foundation_likely: { count: foundationLikely, of_assessed: assessed.length, share: pct(foundationLikely, assessed.length) },
    pending_handoffs: pendingHandoffs.length,
    overdue_callbacks: pendingHandoffs.filter((h) => isOverdue(h, now)).length,
  };
}
