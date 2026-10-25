import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Lead, Payment, Repo } from "./types.js";

function must<T>(result: { data: T | null; error: { message: string } | null }, what: string): T {
  if (result.error) throw new Error(`${what}: ${result.error.message}`);
  return result.data as T;
}

export function createSupabaseRepo(url: string, serviceRoleKey: string): Repo {
  const db: SupabaseClient = createClient(url, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  return {
    async getLeadByContact(contactId) {
      return must(await db.from("leads").select("*").eq("contact_id", contactId).maybeSingle<Lead>(), "getLeadByContact");
    },
    async getLeadById(id) {
      return must(await db.from("leads").select("*").eq("id", id).maybeSingle<Lead>(), "getLeadById");
    },
    async upsertLead(contactId, patch) {
      // ON CONFLICT only updates the columns we send, so omitted fields keep their values.
      return must(
        await db.from("leads").upsert({ contact_id: contactId, ...patch }, { onConflict: "contact_id" }).select("*").single<Lead>(),
        "upsertLead",
      );
    },
    async updateLead(id, patch) {
      return must(await db.from("leads").update(patch).eq("id", id).select("*").single<Lead>(), "updateLead");
    },

    async latestApplicationPayment(leadId) {
      return must(
        await db
          .from("payments")
          .select("*")
          .eq("lead_id", leadId)
          .eq("purpose", "application_fee")
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle<Payment>(),
        "latestApplicationPayment",
      );
    },
    async getPaymentByReference(reference) {
      return must(
        await db.from("payments").select("*").eq("paystack_reference", reference).maybeSingle<Payment>(),
        "getPaymentByReference",
      );
    },
    async insertPayment(p) {
      return must(await db.from("payments").insert(p).select("*").single<Payment>(), "insertPayment");
    },
    async markPaymentSuccess(reference, paidAt) {
      const rows = must(
        await db
          .from("payments")
          .update({ status: "success", paid_at: paidAt })
          .eq("paystack_reference", reference)
          .neq("status", "success")
          .select("*"),
        "markPaymentSuccess",
      ) as Payment[];
      return rows[0] ?? null;
    },
    async markPaymentStatus(reference, status) {
      const rows = must(
        await db
          .from("payments")
          .update({ status })
          .eq("paystack_reference", reference)
          .neq("status", "success")
          .neq("status", status)
          .select("*"),
        "markPaymentStatus",
      ) as Payment[];
      return rows[0] ?? null;
    },

    async insertHandoff(h) {
      must(await db.from("handoffs").insert(h), "insertHandoff");
    },
    async logWebhookEvent(e) {
      must(await db.from("webhook_events").insert({ provider: "paystack", ...e }), "logWebhookEvent");
    },
  };
}
