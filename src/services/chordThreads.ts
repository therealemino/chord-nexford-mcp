import { DateTime } from "luxon";
import {
  CUSTOMER_CHANNEL_ROLE,
  extractThreads,
  getPath,
  LINK_TOOL_SUFFIX,
  LINK_WINDOW_SECONDS,
  THREAD_LIST_LIMIT,
  TURN_PAGES_MAX,
} from "../config/chord.js";
import { log } from "../lib/log.js";
import type { ChordDeps } from "../mcp/types.js";
import type { ChordClient } from "./chord.js";
import type { Lead, Repo } from "./types.js";

/** Allow for clock skew between our database and Chord. */
const SKEW_MS = 15_000;

interface Turn {
  direction?: string;
  timestamp?: number;
  metadata?: { tools_used?: { name?: string }[] } | null;
}

async function agentUsedLinkToolBetween(client: ChordClient, threadId: string, fromMs: number, toMs: number): Promise<boolean> {
  let cursor: string | undefined;
  for (let page = 0; page < TURN_PAGES_MAX; page++) {
    const res = await client.listTurns(threadId, { limit: 50, cursor });
    const turns = (getPath(res, "turns") as Turn[] | undefined) ?? [];
    const hit = turns.some(
      (t) =>
        t.direction === "outbound" &&
        typeof t.timestamp === "number" &&
        t.timestamp >= fromMs &&
        t.timestamp <= toMs &&
        (t.metadata?.tools_used ?? []).some((u) => u.name?.endsWith(LINK_TOOL_SUFFIX)),
    );
    if (hit) return true;
    cursor = getPath(res, "next_cursor") as string | undefined;
    if (!getPath(res, "has_more") || !cursor) return false;
  }
  return false;
}

/**
 * Returns the lead's Chord thread id, looking it up (and saving it) if we don't have it yet.
 *
 * Chord doesn't expose the contact_id on threads, so we anchor on the moment the agent created this lead's
 * payment link: the matching thread is the one customer thread whose agent turn used create_application_payment
 * within LINK_WINDOW_SECONDS after `paymentCreatedAt`. Exactly one match is required; otherwise we return null
 * rather than risk messaging the wrong person.
 */
export async function resolveThreadId(
  lead: Lead,
  paymentCreatedAt: DateTime,
  deps: { repo: Repo; chord: ChordDeps },
): Promise<string | null> {
  if (lead.chord_thread_id) return lead.chord_thread_id;

  const { client, workspaceId, teammateId } = deps.chord;
  const fromMs = paymentCreatedAt.toMillis() - SKEW_MS;
  const toMs = paymentCreatedAt.toMillis() + LINK_WINDOW_SECONDS * 1000;

  const list = await client.listThreads({ workspace_id: workspaceId, agent_id: teammateId, limit: THREAD_LIST_LIMIT });
  const candidates = extractThreads(list).filter(
    (t) => t.channel_role === CUSTOMER_CHANNEL_ROLE && Number(t.last_turn_at) >= fromMs,
  );

  const matches: string[] = [];
  for (const t of candidates) {
    if (await agentUsedLinkToolBetween(client, String(t.id), fromMs, toMs)) matches.push(String(t.id));
  }

  if (matches.length !== 1) {
    log.warn("chord thread not linked", { lead_id: lead.id, candidates: candidates.length, matches: matches.length });
    return null;
  }
  await deps.repo.updateLead(lead.id, { chord_thread_id: matches[0] });
  log.info("chord thread linked", { lead_id: lead.id, thread_id: matches[0] });
  return matches[0];
}
