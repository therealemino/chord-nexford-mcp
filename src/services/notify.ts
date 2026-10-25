import { DateTime } from "luxon";
import { APPLICATION_FEE_USD } from "../config/constants.js";
import { buildMessagePayload, buildOperatorMessageBody, getPath, THREAD_CONVERSATION_ID_PATH } from "../config/chord.js";
import { toLocal } from "../config/fx.js";
import { log } from "../lib/log.js";
import type { ChordDeps } from "../mcp/types.js";
import type { ChordClient } from "./chord.js";
import { resolveThreadId } from "./chordThreads.js";
import type { Lead, Payment, Repo } from "./types.js";

/** Scheduled tasks must be in the future; this is how far ahead we schedule them. */
const SCHEDULE_AHEAD_SECONDS = 15;

const firstWord = (s: string | null | undefined) => s?.trim().split(/\s+/)[0] || null;

/** WhatsApp-friendly confirmation: plain text, short. */
export function confirmationMessage(lead: Lead, displayName: string | null): string {
  const name = firstWord(displayName) ?? firstWord(lead.full_name);
  const fee = `$${APPLICATION_FEE_USD} application fee (₦${toLocal(APPLICATION_FEE_USD, "NGN").toLocaleString("en-US")})`;
  return (
    `Payment received ✅ Your ${fee} has come through${name ? `, ${name}` : ""}. ` +
    `Your application is now with our admissions team, and an Application Specialist will be in touch about next steps` +
    `${lead.programme ? ` for the ${lead.programme}` : ""}. Anything else I can help with in the meantime?`
  );
}

/**
 * Take over, send, hand back. Hands back only if we did the take-over, always in `finally`, so the agent is never
 * left disabled. A thread already under human control is left with the human (we just post the message).
 */
export async function sendViaTakeover(client: ChordClient, threadId: string, thread: unknown, text: string): Promise<void> {
  const tookOverHere = getPath(thread, "control_state") === "agent_active";
  if (tookOverHere) await client.takeOver(threadId);
  try {
    await client.sendMessage(threadId, buildOperatorMessageBody(text));
  } finally {
    if (tookOverHere) await client.handBack(threadId);
  }
}

async function sendViaScheduledTask(chord: ChordDeps, thread: unknown, text: string, now: DateTime): Promise<void> {
  const conversationId = getPath(thread, THREAD_CONVERSATION_ID_PATH);
  if (typeof conversationId !== "string") throw new Error("thread has no partner_chat conversation_id");
  await chord.client.createScheduledTask({
    task_type: "MESSAGE",
    scheduled_at: now.plus({ seconds: SCHEDULE_AHEAD_SECONDS }).toUTC().toISO(),
    workspace_id: chord.workspaceId,
    teammate_id: chord.teammateId,
    payload: buildMessagePayload(conversationId, text),
  });
}

/**
 * Tells the applicant in their Chord thread that their application fee arrived. Runs in the background after the
 * webhook has answered. Records customer_notified_at on success or notify_error on failure; never throws.
 * Callers run it only on the payment's first transition to success, and it re-checks customer_notified_at.
 */
export async function notifyPaymentSuccess(
  payment: Payment,
  deps: { repo: Repo; chord: ChordDeps | null; now: () => DateTime },
): Promise<void> {
  const { repo, chord } = deps;
  if (!chord || chord.strategy === "off") return;
  const current = await repo.getPaymentByReference(payment.paystack_reference);
  if (!current || current.status !== "success" || current.customer_notified_at) return;

  const fields = { reference: payment.paystack_reference, lead_id: payment.lead_id, strategy: chord.strategy };
  try {
    const lead = await repo.getLeadById(payment.lead_id);
    if (!lead) throw new Error("lead not found");
    const threadId = await resolveThreadId(lead, DateTime.fromISO(payment.created_at), { repo, chord });
    if (!threadId) {
      await repo.updatePaymentNotification(payment.id, { customer_notified_at: null, notify_error: "thread_not_found" });
      return;
    }
    const thread = await chord.client.getThread(threadId);
    const text = confirmationMessage(lead, getPath(thread, "remote_participant_metadata.display_name") as string | null);

    if (chord.strategy === "takeover") await sendViaTakeover(chord.client, threadId, thread, text);
    else await sendViaScheduledTask(chord, thread, text, deps.now());

    await repo.updatePaymentNotification(payment.id, { customer_notified_at: deps.now().toUTC().toISO(), notify_error: null });
    log.info("customer notified of payment", { ...fields, thread_id: threadId });
  } catch (err) {
    const message = (err as Error).message.slice(0, 500);
    log.error("customer payment notification failed", { ...fields, error: message });
    await repo.updatePaymentNotification(payment.id, { customer_notified_at: null, notify_error: message }).catch(() => {});
  }
}
