import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Handoff, HandoffWithLead, Lead, Payment, Repo } from "./types.js";

/** Escapes LIKE wildcards in user-supplied search text. */
const likeEscape = (s: string) => s.replace(/[\\%_]/g, (c) => `\\${c}`);

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

    async updatePaymentNotification(id, patch) {
      must(await db.from("payments").update(patch).eq("id", id), "updatePaymentNotification");
    },

    async insertHandoff(h) {
      return must(await db.from("handoffs").insert(h).select("*").single<Handoff>(), "insertHandoff");
    },
    async insertHandoffOnce(h) {
      const rows = must(
        await db.from("handoffs").upsert(h, { onConflict: "payment_id", ignoreDuplicates: true }).select("*"),
        "insertHandoffOnce",
      ) as Handoff[];
      return rows[0] ?? null;
    },
    async findDuplicateHandoff(h, sinceIso) {
      let q = db
        .from("handoffs")
        .select("*")
        .eq("lead_id", h.lead_id)
        .eq("channel", h.channel)
        .eq("reason", h.reason)
        .eq("status", "pending")
        .gte("created_at", sinceIso);
      q = h.callback_time ? q.eq("callback_time", h.callback_time) : q.is("callback_time", null);
      return must(await q.order("created_at", { ascending: false }).limit(1).maybeSingle<Handoff>(), "findDuplicateHandoff");
    },
    async claimHandoffEmail(id, atIso) {
      const rows = must(
        await db.from("handoffs").update({ alert_emailed_at: atIso }).eq("id", id).is("alert_emailed_at", null).select("*"),
        "claimHandoffEmail",
      ) as Handoff[];
      return rows[0] ?? null;
    },
    async updateHandoffAlert(id, patch) {
      must(await db.from("handoffs").update(patch).eq("id", id), "updateHandoffAlert");
    },
    async handoffAlertFailuresSince(sinceIso) {
      return must(
        await db
          .from("handoffs")
          .select("*")
          .gte("created_at", sinceIso)
          .or("alert_error.not.is.null,chord_flag_error.not.is.null")
          .order("created_at", { ascending: true }),
        "handoffAlertFailuresSince",
      ) as Handoff[];
    },
    async latestCallbackHandoff(leadId) {
      return must(
        await db
          .from("handoffs")
          .select("*")
          .eq("lead_id", leadId)
          .eq("channel", "call")
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle<Handoff>(),
        "latestCallbackHandoff",
      );
    },

    async leadsCreatedBetween(fromIso, toIso) {
      return must(await db.from("leads").select("*").gte("created_at", fromIso).lt("created_at", toIso), "leadsCreatedBetween") as Lead[];
    },
    async paymentsPaidBetween(fromIso, toIso) {
      return must(
        await db.from("payments").select("*").eq("status", "success").gte("paid_at", fromIso).lt("paid_at", toIso),
        "paymentsPaidBetween",
      ) as Payment[];
    },
    async handoffsByStatus(statuses, limit) {
      const rows = must(
        await db
          .from("handoffs")
          .select("*, lead:leads(full_name, programme, contact_id)")
          .in("status", statuses)
          .order("created_at", { ascending: true })
          .limit(limit),
        "handoffsByStatus",
      );
      return rows as HandoffWithLead[];
    },
    async getHandoff(id) {
      return must(await db.from("handoffs").select("*").eq("id", id).maybeSingle<Handoff>(), "getHandoff");
    },
    async updateHandoff(id, patch) {
      return must(await db.from("handoffs").update(patch).eq("id", id).select("*").single<Handoff>(), "updateHandoff");
    },
    async searchLeads(query, limit) {
      const q = query.trim();
      const pattern = `%${likeEscape(q)}%`;
      const [byContact, byEmail, byName] = await Promise.all([
        db.from("leads").select("*").eq("contact_id", q).limit(limit),
        db.from("leads").select("*").ilike("email", likeEscape(q)).limit(limit),
        db.from("leads").select("*").ilike("full_name", pattern).order("created_at", { ascending: false }).limit(limit),
      ]);
      const all = [byContact, byEmail, byName].flatMap((r) => must(r, "searchLeads") as Lead[]);
      return [...new Map(all.map((l) => [l.id, l])).values()].slice(0, limit);
    },
    async handoffsForLead(leadId) {
      return must(
        await db.from("handoffs").select("*").eq("lead_id", leadId).order("created_at", { ascending: true }),
        "handoffsForLead",
      ) as Handoff[];
    },
    async logWebhookEvent(e) {
      must(await db.from("webhook_events").insert({ provider: "paystack", ...e }), "logWebhookEvent");
    },
  };
}
