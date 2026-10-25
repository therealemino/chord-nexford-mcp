/**
 * Chord-specific settings that depend on undocumented API shapes.
 * TODO: confirm against `pnpm chord:discover` output (thread JSON and the accepted MESSAGE payload)
 * before relying on these defaults.
 */
export const CHORD_API_BASE = "https://api.chordhq.xyz";

export const NOTIFY_STRATEGIES = ["scheduled_task", "takeover", "off"] as const;
export type NotifyStrategy = (typeof NOTIFY_STRATEGIES)[number];

/**
 * Dotted paths on a thread object that may hold the customer identifier the agent sees as contact_id.
 * A thread matches when any of these equals the contact_id. TODO: narrow to the real field after discovery.
 */
export const THREAD_CUSTOMER_ID_PATHS = ["customer_id", "customer.id", "sender_id", "contact_id", "remote_id"];

/** Where the list of threads lives in GET /v1/threads responses (first array found wins). */
export const THREAD_LIST_PATHS = ["data", "threads", "items", "results"];

/** Thread metadata path holding the partner-chat conversation id that MESSAGE tasks need. */
export const THREAD_CONVERSATION_ID_PATH = "metadata.partner_chat.conversation_id";

/**
 * Payload for a MESSAGE scheduled task. Discovery (25 Oct 2026): Chord validates `conversation_id` and `body`,
 * but on the simulator channel the task then fails inside Chord with
 * "UNAUTHENTICATED: tenant_id is required in x-tenant-id header" (an x-tenant-id header on our request doesn't help).
 */
export const buildMessagePayload = (conversationId: string, text: string): Record<string, unknown> => ({
  conversation_id: conversationId,
  body: text,
});

/** Body for POST /v1/threads/{id}/messages. Confirmed by discovery: { text } is delivered as a human_operator message. */
export const buildOperatorMessageBody = (text: string): Record<string, unknown> => ({ text });

export function getPath(obj: unknown, path: string): unknown {
  return path.split(".").reduce<unknown>((o, k) => (o && typeof o === "object" ? (o as Record<string, unknown>)[k] : undefined), obj);
}

/** Pulls the thread array out of a loosely typed list response. */
export function extractThreads(response: unknown): Record<string, unknown>[] {
  if (Array.isArray(response)) return response;
  for (const p of THREAD_LIST_PATHS) {
    const v = getPath(response, p);
    if (Array.isArray(v)) return v;
  }
  return [];
}

export const threadMatchesContact = (thread: unknown, contactId: string): boolean =>
  THREAD_CUSTOMER_ID_PATHS.some((p) => getPath(thread, p) === contactId);
