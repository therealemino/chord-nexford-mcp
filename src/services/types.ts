import type { DegreeField } from "../config/foundation.js";

export type LeadStatus = "enquiring" | "qualified" | "applied" | "paid" | "handed_off";
export type StoredEligibility = "direct_entry" | "foundation_likely" | "advisor_review" | "not_eligible";
export type PaymentStatus = "pending" | "success" | "failed" | "abandoned";

export interface Lead {
  id: string;
  contact_id: string;
  whatsapp_number: string | null;
  full_name: string | null;
  email: string | null;
  country: string | null;
  programme: string | null;
  has_bachelors_degree: boolean | null;
  degree_field: DegreeField | null;
  has_statistics_course: boolean | null;
  years_relevant_experience: number | null;
  eligibility_result: StoredEligibility | null;
  foundation_courses: string[] | null;
  status: LeadStatus;
  chord_thread_id: string | null;
  created_at: string;
  updated_at: string;
}

export type LeadPatch = Partial<Omit<Lead, "id" | "contact_id" | "created_at" | "updated_at">>;

export interface Payment {
  id: string;
  lead_id: string;
  paystack_reference: string;
  purpose: "application_fee";
  amount_kobo: number;
  currency: string;
  status: PaymentStatus;
  authorization_url: string | null;
  paid_at: string | null;
  customer_notified_at: string | null;
  notify_error: string | null;
  created_at: string;
  updated_at: string;
}

export type NewPayment = Pick<Payment, "lead_id" | "paystack_reference" | "purpose" | "amount_kobo" | "currency" | "authorization_url">;

export type HandoffStatus = "pending" | "contacted" | "closed";

export interface NewHandoff {
  lead_id: string;
  reason: string;
  summary: string;
  channel: "whatsapp" | "call";
  callback_number: string | null;
  callback_time: string | null;
  /** Only for reason = new_applicant (unique per payment). */
  payment_id?: string;
}

export interface Handoff extends Required<NewHandoff> {
  id: string;
  status: HandoffStatus;
  notes: string | null;
  contacted_at: string | null;
  closed_at: string | null;
  created_at: string;
  payment_id: string;
}

/** A handoff with the lead fields admin views need. */
export interface HandoffWithLead extends Handoff {
  lead: { full_name: string | null; programme: string | null; contact_id: string } | null;
}

export type HandoffPatch = Partial<Pick<Handoff, "status" | "notes" | "contacted_at" | "closed_at">>;

/** Everything the app needs from the database. Implemented by Supabase in production and by a fake in tests. */
export interface Repo {
  getLeadByContact(contactId: string): Promise<Lead | null>;
  getLeadById(id: string): Promise<Lead | null>;
  /** Creates the lead if needed; only the keys present in `patch` are written. */
  upsertLead(contactId: string, patch: LeadPatch): Promise<Lead>;
  updateLead(id: string, patch: LeadPatch): Promise<Lead>;

  latestApplicationPayment(leadId: string): Promise<Payment | null>;
  getPaymentByReference(reference: string): Promise<Payment | null>;
  insertPayment(p: NewPayment): Promise<Payment>;
  /** Sets success + paid_at only if the payment is not already success. Returns the row if it changed, else null. */
  markPaymentSuccess(reference: string, paidAt: string): Promise<Payment | null>;
  /** Sets a non-success status only if the payment is not already success. Returns the row if it changed, else null. */
  markPaymentStatus(reference: string, status: Exclude<PaymentStatus, "success">): Promise<Payment | null>;

  /** Records whether/why the customer was told about a successful payment. */
  updatePaymentNotification(id: string, patch: Pick<Payment, "customer_notified_at" | "notify_error">): Promise<void>;

  insertHandoff(h: NewHandoff): Promise<void>;
  /** Inserts a new_applicant handoff unless one already exists for h.payment_id. Returns true if inserted. */
  insertHandoffOnce(h: NewHandoff & { payment_id: string }): Promise<boolean>;
  latestCallbackHandoff(leadId: string): Promise<Handoff | null>;

  // Admin
  leadsCreatedBetween(fromIso: string, toIso: string): Promise<Lead[]>;
  paymentsPaidBetween(fromIso: string, toIso: string): Promise<Payment[]>;
  handoffsByStatus(statuses: HandoffStatus[], limit: number): Promise<HandoffWithLead[]>;
  getHandoff(id: string): Promise<Handoff | null>;
  updateHandoff(id: string, patch: HandoffPatch): Promise<Handoff>;
  /** Up to `limit` leads matching contact_id exactly, email (case-insensitive) or a name fragment. */
  searchLeads(query: string, limit: number): Promise<Lead[]>;
  handoffsForLead(leadId: string): Promise<Handoff[]>;

  logWebhookEvent(e: { event: string; reference: string | null; payload: unknown }): Promise<void>;
}
