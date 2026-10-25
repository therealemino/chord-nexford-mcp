import { randomUUID } from "node:crypto";
import { DateTime } from "luxon";
import { vi } from "vitest";
import type { Deps } from "../../src/mcp/types.js";
import type { PaystackClient, VerifiedTransaction } from "../../src/services/paystack.js";
import type { Lead, NewHandoff, Payment, Repo } from "../../src/services/types.js";

export function fakeRepo() {
  const leads: Lead[] = [];
  const payments: Payment[] = [];
  const handoffs: NewHandoff[] = [];
  const webhookEvents: { event: string; reference: string | null }[] = [];
  const stamp = () => new Date().toISOString();

  const repo: Repo = {
    async getLeadByContact(contactId) {
      return leads.find((l) => l.contact_id === contactId) ?? null;
    },
    async getLeadById(id) {
      return leads.find((l) => l.id === id) ?? null;
    },
    async upsertLead(contactId, patch) {
      let lead = leads.find((l) => l.contact_id === contactId);
      if (!lead) {
        lead = {
          id: randomUUID(), contact_id: contactId, whatsapp_number: null, full_name: null, email: null, country: null,
          programme: null, has_bachelors_degree: null, degree_field: null, has_statistics_course: null,
          years_relevant_experience: null, eligibility_result: null, foundation_courses: null, status: "enquiring",
          created_at: stamp(), updated_at: stamp(),
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
      const row: Payment = { ...p, id: randomUUID(), status: "pending", paid_at: null, created_at: stamp(), updated_at: stamp() };
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
    async insertHandoff(h) {
      handoffs.push(h);
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

export function makeDeps(opts: { now?: string; verify?: Partial<VerifiedTransaction> } = {}) {
  const db = fakeRepo();
  const paystack = fakePaystack(opts.verify);
  let now = DateTime.fromISO(opts.now ?? "2026-10-26T10:00:00Z", { zone: "utc" });
  const deps: Deps = { repo: db.repo, paystack, now: () => now, publicBaseUrl: "https://example.test" };
  return { deps, db, paystack, setNow: (iso: string) => (now = DateTime.fromISO(iso, { zone: "utc" })) };
}
