import { randomUUID } from "node:crypto";
import { DateTime } from "luxon";
import { vi } from "vitest";
import type { NotifyStrategy } from "../../src/config/chord.js";
import type { Deps } from "../../src/mcp/types.js";
import type { ChordClient } from "../../src/services/chord.js";
import type { EmailMessage } from "../../src/services/email.js";
import type { PaystackClient, VerifiedTransaction } from "../../src/services/paystack.js";
import type { Handoff, Lead, Payment, Repo } from "../../src/services/types.js";

export function fakeRepo() {
  const leads: Lead[] = [];
  const payments: Payment[] = [];
  const handoffs: Handoff[] = [];
  const webhookEvents: { event: string; reference: string | null }[] = [];
  const stamp = () => new Date().toISOString();
  const withLead = (h: Handoff) => {
    const l = leads.find((x) => x.id === h.lead_id);
    return { ...h, lead: l ? { full_name: l.full_name, programme: l.programme, contact_id: l.contact_id } : null };
  };

  const repo: Repo = {
    async getLeadByContact(contactId) {
      return leads.find((l) => l.contact_id === contactId) ?? null;
    },
    async getLeadById(id) {
      const l = leads.find((x) => x.id === id);
      return l ? { ...l } : null;
    },
    async upsertLead(contactId, patch) {
      let lead = leads.find((l) => l.contact_id === contactId);
      if (!lead) {
        lead = {
          id: randomUUID(), contact_id: contactId, whatsapp_number: null, full_name: null, email: null, country: null,
          programme: null, has_bachelors_degree: null, degree_field: null, has_statistics_course: null,
          years_relevant_experience: null, eligibility_result: null, foundation_courses: null, status: "enquiring",
          chord_thread_id: null, created_at: stamp(), updated_at: stamp(),
        };
        leads.push(lead);
      }
      Object.assign(lead, patch, { updated_at: stamp() });
      return { ...lead };
    },
    async updateLead(id, patch) {
      const lead = leads.find((l) => l.id === id)!;
      Object.assign(lead, patch, { updated_at: stamp() });
      return { ...lead };
    },
    async latestApplicationPayment(leadId) {
      const mine = payments.filter((p) => p.lead_id === leadId && p.purpose === "application_fee");
      return mine.length ? { ...mine[mine.length - 1] } : null;
    },
    async getPaymentByReference(reference) {
      const p = payments.find((x) => x.paystack_reference === reference);
      return p ? { ...p } : null;
    },
    async insertPayment(p) {
      const row: Payment = {
        ...p, id: randomUUID(), status: "pending", paid_at: null, customer_notified_at: null, notify_error: null,
        created_at: stamp(), updated_at: stamp(),
      };
      payments.push(row);
      return { ...row };
    },
    markPaymentSuccess: vi.fn(async (reference: string, paidAt: string) => {
      const p = payments.find((x) => x.paystack_reference === reference && x.status !== "success");
      if (!p) return null;
      Object.assign(p, { status: "success", paid_at: paidAt, updated_at: stamp() });
      return { ...p };
    }),
    async markPaymentStatus(reference, status) {
      const p = payments.find((x) => x.paystack_reference === reference && x.status !== "success" && x.status !== status);
      if (!p) return null;
      Object.assign(p, { status, updated_at: stamp() });
      return { ...p };
    },
    updatePaymentNotification: vi.fn(async (id: string, patch: Pick<Payment, "customer_notified_at" | "notify_error">) => {
      Object.assign(payments.find((p) => p.id === id)!, patch);
    }),
    async insertHandoff(h) {
      const row: Handoff = {
        payment_id: null as unknown as string, ...h, id: randomUUID(), status: "pending", notes: null,
        contacted_at: null, closed_at: null, created_at: stamp(),
        alert_emailed_at: null, alert_error: null, chord_flagged_at: null, chord_flag_error: null,
      };
      handoffs.push(row);
      return { ...row };
    },
    async insertHandoffOnce(h) {
      if (handoffs.some((x) => x.payment_id === h.payment_id)) return null;
      return repo.insertHandoff(h);
    },
    async findDuplicateHandoff(h, since) {
      return (
        handoffs.find(
          (x) => x.lead_id === h.lead_id && x.channel === h.channel && x.reason === h.reason && x.status === "pending" &&
            x.callback_time === h.callback_time && x.created_at >= since,
        ) ?? null
      );
    },
    async claimHandoffEmail(id, at) {
      const h = handoffs.find((x) => x.id === id && !x.alert_emailed_at);
      if (!h) return null;
      h.alert_emailed_at = at;
      return { ...h };
    },
    async updateHandoffAlert(id, patch) {
      Object.assign(handoffs.find((x) => x.id === id)!, patch);
    },
    async handoffAlertFailuresSince(since) {
      return handoffs.filter((h) => h.created_at >= since && (h.alert_error || h.chord_flag_error));
    },
    async latestCallbackHandoff(leadId) {
      const mine = handoffs.filter((h) => h.lead_id === leadId && h.channel === "call");
      return mine.length ? { ...mine[mine.length - 1] } : null;
    },
    async leadsCreatedBetween(from, to) {
      return leads.filter((l) => l.created_at >= from && l.created_at < to);
    },
    async paymentsPaidBetween(from, to) {
      return payments.filter((p) => p.status === "success" && p.paid_at && p.paid_at >= from && p.paid_at < to);
    },
    async handoffsByStatus(statuses, limit) {
      return handoffs
        .filter((h) => statuses.includes(h.status))
        .sort((a, b) => a.created_at.localeCompare(b.created_at))
        .slice(0, limit)
        .map(withLead);
    },
    async getHandoff(id) {
      return handoffs.find((h) => h.id === id) ?? null;
    },
    async updateHandoff(id, patch) {
      const h = handoffs.find((x) => x.id === id)!;
      Object.assign(h, patch);
      return { ...h };
    },
    async searchLeads(query, limit) {
      const q = query.toLowerCase();
      return leads
        .filter((l) => l.contact_id === query || l.email?.toLowerCase() === q || l.full_name?.toLowerCase().includes(q))
        .slice(0, limit);
    },
    async handoffsForLead(leadId) {
      return handoffs.filter((h) => h.lead_id === leadId);
    },
    async logWebhookEvent(e) {
      webhookEvents.push({ event: e.event, reference: e.reference });
    },
  };
  return { repo, leads, payments, handoffs, webhookEvents };
}

export function fakePaystack(verifyResult: Partial<VerifiedTransaction> = {}) {
  let counter = 0;
  const paystack = {
    initialize: vi.fn(async (input: { reference: string }) => ({
      authorization_url: `https://checkout.paystack.com/fake_${++counter}`,
      reference: input.reference,
    })),
    verify: vi.fn(async (reference: string) => ({
      reference,
      status: "success",
      amount: 3_321_700,
      currency: "NGN",
      paid_at: "2026-10-26T10:00:00.000Z",
      ...verifyResult,
    })),
  } satisfies PaystackClient;
  return paystack;
}

/** A Chord workspace with customer threads whose agent turns can be scripted. */
export function fakeChord() {
  const threads: Record<string, unknown>[] = [];
  const turns: Record<string, Record<string, unknown>[]> = {};
  const client = {
    listThreads: vi.fn(async () => ({ threads, has_more: false, next_cursor: null })),
    getThread: vi.fn(async (id: string) => threads.find((t) => t.id === id)),
    listTurns: vi.fn(async (id: string) => ({ turns: turns[id] ?? [], has_more: false, next_cursor: null })),
    createScheduledTask: vi.fn(async (body: Record<string, unknown>) => ({ id: "task_1", status: "PENDING", ...body })),
    getScheduledTask: vi.fn(async () => ({})),
    takeOver: vi.fn(async (id: string) => ({ id, control_state: "human_active" })),
    sendMessage: vi.fn(async (id: string) => ({ thread_id: id, delivery_status: "sent" })),
    handBack: vi.fn(async (id: string) => ({ id, control_state: "agent_active" })),
    postTurnFeedback: vi.fn(async () => ({})),
    listControlEvents: vi.fn(async () => ({ events: [] })),
    setEscalationNotifications: vi.fn(async () => ({})),
    listEscalationRules: vi.fn(async () => ({ rules: [] })),
    createEscalationRule: vi.fn(async (body: Record<string, unknown>) => ({ id: "rule_1", ...body })),
    attachEscalationRule: vi.fn(async () => ({})),
  } satisfies ChordClient;

  /** Adds a customer thread whose agent used `tool` (default create_application_payment) at `atMs`. */
  const addCustomerThread = (id: string, atMs: number, opts: { displayName?: string; controlState?: string; tool?: string } = {}) => {
    threads.push({
      id,
      channel_role: "EXTERNAL",
      control_state: opts.controlState ?? "agent_active",
      last_turn_at: atMs + 3000,
      remote_participant_metadata: { display_name: opts.displayName ?? "Peace" },
      metadata: { partner_chat: { conversation_id: `pconv_${id}` } },
    });
    turns[id] = [
      { direction: "inbound", timestamp: atMs - 2000, metadata: null },
      { direction: "outbound", timestamp: atMs + 3000, metadata: { tools_used: [{ name: `mcp__Nexford_MCP_Server__${opts.tool ?? "create_application_payment"}`, ok: true }] } },
    ];
  };
  return { client, threads, turns, addCustomerThread };
}

export function fakeEmail() {
  const sent: EmailMessage[] = [];
  return { sent, send: vi.fn(async (m: EmailMessage) => void sent.push(m)) };
}

export function makeDeps(
  opts: { now?: string; verify?: Partial<VerifiedTransaction>; strategy?: NotifyStrategy | null; email?: boolean } = {},
) {
  const db = fakeRepo();
  const email = fakeEmail();
  const paystack = fakePaystack(opts.verify);
  const chord = fakeChord();
  const background: Promise<void>[] = [];
  let now = DateTime.fromISO(opts.now ?? "2026-10-26T10:00:00Z", { zone: "utc" });
  const deps: Deps = {
    repo: db.repo,
    paystack,
    now: () => now,
    publicBaseUrl: "https://example.test",
    chord: opts.strategy ? { client: chord.client, workspaceId: "ws_1", teammateId: "tm_1", strategy: opts.strategy } : null,
    alerts: {
      email: opts.email === false ? null : email,
      to: ["team@example.com"],
      threadUrlTemplate: "https://chord.example/threads/{thread_id}",
      threadLookupDelaysMs: [0],
    },
    runInBackground: (task) => {
      background.push(task());
    },
  };
  return {
    deps,
    db,
    paystack,
    chord,
    email,
    /** Waits for every background task started so far. */
    settle: () => Promise.all(background),
    setNow: (iso: string) => (now = DateTime.fromISO(iso, { zone: "utc" })),
  };
}
