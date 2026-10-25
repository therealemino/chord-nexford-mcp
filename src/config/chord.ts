/**
 * Chord-specific settings that depend on undocumented API shapes, confirmed with `pnpm chord:discover`
 * on 25 Oct 2026 unless marked otherwise.
 */
export const CHORD_API_BASE = "https://api.chordhq.xyz";

export const NOTIFY_STRATEGIES = ["scheduled_task", "takeover", "off"] as const;
export type NotifyStrategy = (typeof NOTIFY_STRATEGIES)[number];

/**
 * Linking a contact_id to a thread. Chord never exposes the customer_… id the agent passes as contact_id
 * (not in thread fields, turns, tool-call headers or _meta). But each agent turn records the tools it used
 * (metadata.tools_used[].name, e.g. "mcp__Nexford_MCP_Server__create_application_payment"), so we find the
 * one customer thread whose agent used create_application_payment just after we created that payment.
 */
export const PAYMENT_TOOL_SUFFIX = "__create_application_payment";
export const HANDOFF_TOOL_SUFFIX = "__handoff_to_advisor";
/** The agent's turn is written a few seconds after our tool returns; allow generous slack. */
export const LINK_WINDOW_SECONDS = 120;
/** Customer threads only; the workspace owner's own chat is channel_role PRINCIPAL. */
export const CUSTOMER_CHANNEL_ROLE = "EXTERNAL";
export const THREAD_LIST_LIMIT = 50;
export const TURN_PAGES_MAX = 5;

/** Where the list of threads lives in GET /v1/threads responses (first array found wins). */
export const THREAD_LIST_PATHS = ["threads", "data", "items", "results"];

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

