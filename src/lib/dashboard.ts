import { DateTime } from "luxon";
import { APPLICATION_FEE_USD } from "../config/constants.js";
import { APPLICANT_ZONE } from "../config/hours.js";
import type { Handoff, Lead, Payment } from "../services/types.js";
import { isOverdue, periodRange } from "./pipeline.js";

export const DASHBOARD_PERIODS = ["today", "last_7_days", "last_30_days", "all"] as const;
export type DashboardPeriod = (typeof DASHBOARD_PERIODS)[number];

export const PERIOD_LABELS: Record<DashboardPeriod, string> = {
  today: "Today",
  last_7_days: "Last 7 days",
  last_30_days: "Last 30 days",
  all: "All time",
};

export interface Data {
  leads: Lead[];
  payments: Payment[];
  handoffs: Handoff[];
}

const ms = (iso: string) => Date.parse(iso);
const pct = (n: number, d: number) => (d === 0 ? null : Math.round((n / d) * 100));

/** The application-fee payment that counts for a lead: the successful one if any, else the latest. */
export function paymentByLead(payments: Payment[]): Map<string, Payment> {
  const map = new Map<string, Payment>();
  for (const p of [...payments].sort((a, b) => ms(a.created_at) - ms(b.created_at))) {
    const current = map.get(p.lead_id);
    if (current?.status !== "success") map.set(p.lead_id, p);
  }
  return map;
}

/** A human was involved before payment: a callback or chat handoff created before the fee was paid. */
const humanBeforePayment = (leadHandoffs: Handoff[], paidAt: string) =>
  leadHandoffs.some((h) => h.reason !== "new_applicant" && ms(h.created_at) < ms(paidAt));

const median = (values: number[]) => {
  if (values.length === 0) return null;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
};

/** "3 h", "2 d", "45 min" */
export function humanDuration(minutes: number | null): string {
  if (minutes === null) return "–";
  if (minutes < 60) return `${Math.round(minutes)} min`;
  if (minutes < 48 * 60) return `${Math.round(minutes / 60)} h`;
  return `${Math.round(minutes / 1440)} d`;
}

function range(period: DashboardPeriod, now: DateTime) {
  if (period === "all") return { from: DateTime.fromMillis(0), to: now, label: PERIOD_LABELS.all };
  const r = periodRange(period, now);
  return { from: r.from, to: r.to, label: r.label };
}

/** Everything on the overview screen. Leads are counted by when they first messaged; payments by when they paid. */
export function overview(data: Data, period: DashboardPeriod, now: DateTime) {
  const { from, to, label } = range(period, now);
  const inRange = (iso: string | null) => !!iso && ms(iso) >= from.toMillis() && ms(iso) < to.toMillis() + 1;
  const byLead = paymentByLead(data.payments);
  const handoffsByLead = new Map<string, Handoff[]>();
  for (const h of data.handoffs) handoffsByLead.set(h.lead_id, [...(handoffsByLead.get(h.lead_id) ?? []), h]);

  // Cohort: leads who first messaged in the period, followed to today.
  const cohort = data.leads.filter((l) => inRange(l.created_at));
  const assessed = cohort.filter((l) => l.eligibility_result !== null);
  const linkSent = cohort.filter((l) => byLead.has(l.id));
  const cohortPaid = cohort.filter((l) => byLead.get(l.id)?.status === "success");

  // Payments received in the period (whenever the lead first messaged).
  const paidInPeriod = [...byLead.values()].filter((p) => p.status === "success" && inRange(p.paid_at));
  const leadsById = new Map(data.leads.map((l) => [l.id, l]));
  const afterHuman = paidInPeriod.filter((p) => humanBeforePayment(handoffsByLead.get(p.lead_id) ?? [], p.paid_at!));
  const minutesToPay = paidInPeriod.flatMap((p) => {
    const lead = leadsById.get(p.lead_id);
    return lead ? [(ms(p.paid_at!) - ms(lead.created_at)) / 60_000] : [];
  });
  const linkToPay = paidInPeriod.map((p) => (ms(p.paid_at!) - ms(p.created_at)) / 60_000);

  const group = (key: (l: Lead) => string | null) => {
    const rows = new Map<string, { leads: number; paid: number }>();
    for (const l of cohort) {
      const k = key(l) ?? "Not given";
      const row = rows.get(k) ?? { leads: 0, paid: 0 };
      row.leads++;
      if (byLead.get(l.id)?.status === "success") row.paid++;
      rows.set(k, row);
    }
    return [...rows].map(([name, r]) => ({ name, ...r, conversion: pct(r.paid, r.leads) })).sort((a, b) => b.leads - a.leads);
  };

  // Daily series for the chart: last 14 days (or the period, if shorter), Lagos days.
  const days = period === "today" ? 1 : period === "last_7_days" ? 7 : 14;
  const today = now.setZone(APPLICANT_ZONE).startOf("day");
  const daily = Array.from({ length: days }, (_, i) => {
    const start = today.minus({ days: days - 1 - i });
    const end = start.plus({ days: 1 });
    const within = (iso: string | null) => !!iso && ms(iso) >= start.toMillis() && ms(iso) < end.toMillis();
    return {
      day: start.toFormat("d LLL"),
      leads: data.leads.filter((l) => within(l.created_at)).length,
      paid: [...byLead.values()].filter((p) => p.status === "success" && within(p.paid_at)).length,
    };
  });

  const pendingHandoffs = data.handoffs.filter((h) => h.status === "pending");
  const eligibility = (r: string) => cohort.filter((l) => l.eligibility_result === r).length;

  return {
    period,
    label,
    new_leads: cohort.length,
    paid_from_new_leads: cohortPaid.length,
    conversion: pct(cohortPaid.length, cohort.length),
    payments_received: paidInPeriod.length,
    fees_usd: paidInPeriod.length * APPLICATION_FEE_USD,
    fees_ngn: paidInPeriod.reduce((sum, p) => sum + p.amount_kobo / 100, 0),
    funnel: [
      { step: "Enquired", count: cohort.length },
      { step: "Eligibility checked", count: assessed.length },
      { step: "Payment link sent", count: linkSent.length },
      { step: "Paid", count: cohortPaid.length },
    ],
    paid_after_human: afterHuman.length,
    paid_ai_only: paidInPeriod.length - afterHuman.length,
    median_time_to_pay: humanDuration(median(minutesToPay)),
    paid_within_hour_of_link: linkToPay.filter((m) => m <= 60).length,
    paid_later: linkToPay.filter((m) => m > 60).length,
    by_programme: group((l) => l.programme),
    by_country: group((l) => l.country),
    eligibility: {
      direct_entry: eligibility("direct_entry"),
      foundation_likely: eligibility("foundation_likely"),
      advisor_review: eligibility("advisor_review"),
      not_eligible: eligibility("not_eligible"),
    },
    daily,
    handoffs_pending: pendingHandoffs.length,
    callbacks_overdue: pendingHandoffs.filter((h) => isOverdue(h, now)).length,
    alerts_failed: data.handoffs.filter((h) => h.alert_error || h.chord_flag_error).length,
    unpaid_links: [...byLead.values()].filter((p) => p.status !== "success").length,
  };
}

export type Overview = ReturnType<typeof overview>;

/** Leads, newest first, with payment and handoff info, filtered by a search term and status. */
export function leadRows(data: Data, q: string, status: string) {
  const byLead = paymentByLead(data.payments);
  const term = q.trim().toLowerCase();
  return data.leads
    .filter((l) => !status || l.status === status)
    .filter((l) => !term || [l.full_name, l.email, l.programme, l.country, l.contact_id].some((v) => v?.toLowerCase().includes(term)))
    .sort((a, b) => ms(b.created_at) - ms(a.created_at))
    .map((l) => ({
      lead: l,
      payment: byLead.get(l.id) ?? null,
      payments: data.payments.filter((p) => p.lead_id === l.id).sort((a, b) => ms(a.created_at) - ms(b.created_at)),
      handoffs: data.handoffs.filter((h) => h.lead_id === l.id).sort((a, b) => ms(a.created_at) - ms(b.created_at)),
    }));
}

/** Who needs chasing: unpaid payment links, and handoffs not yet closed (overdue first). */
export function followUps(data: Data, now: DateTime) {
  const leadsById = new Map(data.leads.map((l) => [l.id, l]));
  const unpaid = [...paymentByLead(data.payments).values()]
    .filter((p) => p.status !== "success")
    .sort((a, b) => ms(a.created_at) - ms(b.created_at))
    .map((p) => ({ payment: p, lead: leadsById.get(p.lead_id) ?? null, age: humanDuration((now.toMillis() - ms(p.created_at)) / 60_000) }));
  const open = data.handoffs
    .filter((h) => h.status !== "closed")
    .map((h) => ({ handoff: h, lead: leadsById.get(h.lead_id) ?? null, overdue: isOverdue(h, now) }))
    .sort((a, b) => Number(b.overdue) - Number(a.overdue) || ms(a.handoff.created_at) - ms(b.handoff.created_at));
  return { unpaid, open };
}
