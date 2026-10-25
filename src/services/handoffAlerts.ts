import { DateTime } from "luxon";
import { HANDOFF_TOOL_SUFFIX, PAYMENT_TOOL_SUFFIX } from "../config/chord.js";
import { APPLICANT_ZONE, SPECIALIST_ZONE } from "../config/hours.js";
import { waiverRequestable } from "../lib/eligibility.js";
import { log } from "../lib/log.js";
import type { Deps } from "../mcp/types.js";
import { resolveThreadId } from "./chordThreads.js";
import type { Handoff, Lead, Payment } from "./types.js";

/** callback = phone call, chat = a specialist replies in WhatsApp, new_applicant = fee paid. */
export type HandoffKind = "new_applicant" | "callback" | "chat";

export const handoffKind = (h: Pick<Handoff, "reason" | "channel">): HandoffKind =>
  h.reason === "new_applicant" ? "new_applicant" : h.channel === "call" ? "callback" : "chat";

const escape = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

export interface HandoffEmailInput {
  handoff: Handoff;
  lead: Lead;
  payment: Payment | null;
  threadUrl: string | null;
}

/** Subject, HTML and plain text for the team's alert email. Pure, so it can be tested and previewed. */
export function buildHandoffEmail({ handoff: h, lead, payment, threadUrl }: HandoffEmailInput) {
  const kind = handoffKind(h);
  const name = lead.full_name ?? "An applicant";
  const programme = lead.programme ?? "their programme";
  const at = h.callback_time ? DateTime.fromISO(h.callback_time) : null;
  const lagos = at?.setZone(APPLICANT_ZONE);
  const et = at?.setZone(SPECIALIST_ZONE);
  const lagosShort = lagos?.toFormat("h:mm a");
  const etShort = et?.toFormat("h:mm a");
  const lagosLong = lagos ? `${lagos.toFormat("h:mm a")} Lagos time, ${lagos.toFormat("cccc d LLLL")}` : null;

  const subject = {
    callback: at
      ? `[Callback] Call ${name} at ${lagosShort} Lagos (${etShort} ET)`
      : `[Callback] Call ${name} during specialist hours (no time agreed)`,
    chat: `[Chat handoff] ${name} wants a specialist on WhatsApp`,
    new_applicant: `[New applicant] ${name} paid the $25 fee for ${programme}`,
  }[kind];

  const action = {
    callback: at
      ? `Call ${h.callback_number} around ${lagosLong} (${etShort} ET).`
      : `Call ${h.callback_number} during specialist hours (7am to 6pm ET). No time was agreed.`,
    chat: `Reply to ${name} in their WhatsApp chat in Chord.`,
    new_applicant: `Contact ${name} about next steps for the ${programme}.`,
  }[kind];

  const yesNo = (v: boolean | null) => (v === null ? "unknown" : v ? "yes" : "no");
  const rows: [string, string][] = [
    ...(kind === "callback"
      ? ([
          ["Phone", h.callback_number ?? "not given"],
          ["Callback time", lagosLong ? `${lagosLong} (${et!.toFormat("h:mm a, ccc d LLL")} ET)` : "not agreed"],
        ] as [string, string][])
      : []),
    ["Name", lead.full_name ?? "not given"],
    ["Email", lead.email ?? "not given"],
    ["Country", lead.country ?? "not given"],
    ["Programme", lead.programme ?? "not given"],
    ["Degree", `${lead.degree_field ?? "unknown"} (bachelor's: ${yesNo(lead.has_bachelors_degree)})`],
    [
      "Eligibility",
      `${lead.eligibility_result ?? "not assessed"}${lead.foundation_courses?.length ? `, foundation: ${lead.foundation_courses.join(", ")}` : ""}`,
    ],
    ["Waiver can be requested", waiverRequestable(lead.eligibility_result, lead.years_relevant_experience) ? "yes" : "no"],
    ["Application fee", payment ? `${payment.status} (ref ${payment.paystack_reference})` : "not started"],
    ["Reason", h.reason],
  ];

  const text = [
    action,
    "",
    ...rows.map(([k, v]) => `${k}: ${v}`),
    "",
    "Summary and open questions:",
    h.summary,
    "",
    threadUrl ? `Chord thread: ${threadUrl}` : "Chord thread: not identified; find the applicant in Chord by name.",
    `Handoff id: ${h.id} (mark it contacted with update_handoff_status)`,
  ].join("\n");

  const html = `<!doctype html><html><body style="font-family:system-ui,-apple-system,sans-serif;color:#1b1f24;line-height:1.5">
<p style="font-size:16px;font-weight:600;margin:0 0 16px">${escape(action)}</p>
<table cellpadding="4" style="border-collapse:collapse;font-size:14px">${rows
    .map(([k, v]) => `<tr><td style="color:#667;padding-right:16px;vertical-align:top">${escape(k)}</td><td>${escape(v)}</td></tr>`)
    .join("")}</table>
<p style="margin:16px 0 4px;font-weight:600">Summary and open questions</p>
<p style="margin:0;white-space:pre-wrap">${escape(h.summary)}</p>
<p style="margin:16px 0 4px">${threadUrl ? `<a href="${escape(threadUrl)}">Open the Chord thread</a>` : "Chord thread not identified; find the applicant in Chord by name."}</p>
<p style="color:#667;font-size:12px;margin:16px 0 0">Handoff id: ${escape(h.id)} (mark it contacted with update_handoff_status).<br>Prototype on mock data; not affiliated with Nexford University.</p>
</body></html>`;

  return { subject, html, text };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * The lead's Chord thread for this handoff. The agent's turn is only written after our tool returns, so we retry
 * after short delays. Anchors on the payment link for new applicants, otherwise on this handoff_to_advisor call.
 */
async function findThread(h: Handoff, lead: Lead, payment: Payment | null, deps: Deps): Promise<string | null> {
  if (lead.chord_thread_id || !deps.chord) return lead.chord_thread_id;
  const [anchor, suffix] =
    handoffKind(h) === "new_applicant" && payment
      ? [DateTime.fromISO(payment.created_at), PAYMENT_TOOL_SUFFIX]
      : [DateTime.fromISO(h.created_at), HANDOFF_TOOL_SUFFIX];
  for (const delay of deps.alerts.threadLookupDelaysMs) {
    await sleep(delay);
    try {
      const id = await resolveThreadId(lead, anchor, { repo: deps.repo, chord: deps.chord }, suffix);
      if (id) return id;
    } catch (err) {
      log.warn("thread lookup failed", { handoff_id: h.id, error: (err as Error).message });
    }
  }
  return null;
}

async function emailTeam(h: Handoff, lead: Lead, payment: Payment | null, threadId: string | null, deps: Deps): Promise<void> {
  const { email, to, threadUrlTemplate } = deps.alerts;
  if (!email || to.length === 0) return; // email not configured; warned at startup
  if (!(await deps.repo.claimHandoffEmail(h.id, deps.now().toUTC().toISO()!))) return; // already emailed

  const threadUrl = threadId && threadUrlTemplate ? threadUrlTemplate.replace("{thread_id}", encodeURIComponent(threadId)) : null;
  try {
    await email.send({ to, ...buildHandoffEmail({ handoff: h, lead, payment, threadUrl }), idempotencyKey: `handoff-alert/${h.id}` });
    await deps.repo.updateHandoffAlert(h.id, { alert_error: null });
    log.info("handoff alert emailed", { handoff_id: h.id, lead_id: lead.id });
  } catch (err) {
    const message = (err as Error).message.slice(0, 500);
    log.error("handoff alert email failed", { handoff_id: h.id, error: message });
    await deps.repo.updateHandoffAlert(h.id, { alert_emailed_at: null, alert_error: message });
  }
}

/** Alerts a human about a new handoff. Runs in the background after the row is saved; never throws. */
export async function alertHandoff(handoffId: string, deps: Deps): Promise<void> {
  try {
    const h = await deps.repo.getHandoff(handoffId);
    const lead = h && (await deps.repo.getLeadById(h.lead_id));
    if (!h || !lead) throw new Error("handoff or lead not found");
    const payment = await deps.repo.latestApplicationPayment(lead.id);
    const threadId = await findThread(h, lead, payment, deps);
    await emailTeam(h, lead, payment, threadId, deps);
  } catch (err) {
    log.error("handoff alert failed", { handoff_id: handoffId, error: (err as Error).message });
  }
}
