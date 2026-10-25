import { DateTime } from "luxon";
import { describe, expect, it } from "vitest";
import { callAdminTool, callTool } from "../src/mcp/server.js";
import { isOverdue, periodRange, summarisePipeline } from "../src/lib/pipeline.js";
import type { Lead, Payment } from "../src/services/types.js";
import { makeDeps } from "./helpers/fakes.js";

const utc = (iso: string) => DateTime.fromISO(iso, { zone: "utc" });

describe("pipeline period boundaries (Africa/Lagos)", () => {
  // 00:30 on Mon 26 Oct in Lagos is still Sun 25 Oct in UTC.
  const now = utc("2026-10-25T23:30:00Z");

  it("today starts at Lagos midnight, not UTC midnight", () => {
    const r = periodRange("today", now);
    expect(r.from.toUTC().toISO()).toBe("2026-10-25T23:00:00.000Z");
    expect(r.to.toUTC().toISO()).toBe("2026-10-25T23:30:00.000Z");
    expect(r.label).toBe("Mon 26 Oct (Lagos time)");
  });

  it("yesterday is the whole previous Lagos day", () => {
    const r = periodRange("yesterday", now);
    expect([r.from.toUTC().toISO(), r.to.toUTC().toISO()]).toEqual(["2026-10-24T23:00:00.000Z", "2026-10-25T23:00:00.000Z"]);
    expect(r.label).toBe("Sun 25 Oct (Lagos time)");
  });

  it("last 7 and 30 days include today", () => {
    expect(periodRange("last_7_days", now).from.toUTC().toISO()).toBe("2026-10-19T23:00:00.000Z");
    expect(periodRange("last_7_days", now).label).toBe("Tue 20 Oct to Mon 26 Oct (Lagos time)");
    expect(periodRange("last_30_days", now).from.toUTC().toISO()).toBe("2026-09-26T23:00:00.000Z");
  });

  it("get_pipeline_summary counts a lead created at 00:15 Lagos as today, not yesterday", async () => {
    const { deps, db } = makeDeps({ now: "2026-10-25T23:30:00Z" });
    await callTool("save_lead", { contact_id: "c1", programme: "MBA" }, deps);
    db.leads[0].created_at = "2026-10-25T23:15:00.000Z";
    expect(await callAdminTool("get_pipeline_summary", { period: "today" }, deps)).toMatchObject({ ok: true, new_leads: 1 });
    expect(await callAdminTool("get_pipeline_summary", { period: "yesterday" }, deps)).toMatchObject({ ok: true, new_leads: 0 });
  });
});

describe("summarisePipeline", () => {
  it("counts qualified, paid, conversion, programmes and foundation share", () => {
    const lead = (id: string, programme: string | null, eligibility: Lead["eligibility_result"]) =>
      ({ id, programme, eligibility_result: eligibility }) as Lead;
    const leads = [
      lead("a", "MBA", "foundation_likely"),
      lead("b", "MBA", "direct_entry"),
      lead("c", "BBA", "advisor_review"),
      lead("d", null, "not_eligible"),
      lead("e", "MBA", null),
    ];
    const paid = [{ lead_id: "a" }, { lead_id: "a" }] as Payment[];
    const s = summarisePipeline(leads, paid, [], utc("2026-10-26T10:00:00Z"));
    expect(s).toMatchObject({
      new_leads: 5,
      qualified: 3,
      paid: 1,
      conversion_rate: "20%",
      by_programme: [{ programme: "MBA", leads: 3 }, { programme: "BBA", leads: 1 }, { programme: "Not given", leads: 1 }],
      foundation_likely: { count: 1, of_assessed: 4, share: "25%" },
    });
  });

  it("conversion is null with no new leads", () => {
    expect(summarisePipeline([], [], [], utc("2026-10-26T10:00:00Z")).conversion_rate).toBeNull();
  });
});

describe("overdue callbacks", () => {
  const now = utc("2026-10-26T15:00:00Z");
  it("is overdue only when the callback time has passed and it is still pending", () => {
    expect(isOverdue({ status: "pending", callback_time: "2026-10-26T14:00:00Z" }, now)).toBe(true);
    expect(isOverdue({ status: "pending", callback_time: "2026-10-26T16:00:00Z" }, now)).toBe(false);
    expect(isOverdue({ status: "contacted", callback_time: "2026-10-26T14:00:00Z" }, now)).toBe(false);
    expect(isOverdue({ status: "pending", callback_time: null }, now)).toBe(false);
  });
});

describe("admin handoff tools", () => {
  async function withHandoffs() {
    // 08:00 Lagos Mon 26 Oct; specialists open at 12:00 Lagos.
    const ctx = makeDeps({ now: "2026-10-26T07:00:00Z" });
    await callTool("save_lead", { contact_id: "c1", full_name: "Ada Obi", email: "ada@example.com", programme: "MBA" }, ctx.deps);
    await callTool("handoff_to_advisor", { contact_id: "c1", reason: "scholarship_or_funding", summary: "Ada wants to discuss MBA scholarships.", channel: "call", callback_number: "+2348030000000", preferred_callback_time: "2026-10-26T13:00:00+01:00" }, ctx.deps);
    await callTool("save_lead", { contact_id: "c2", full_name: "Kwame Mensah" }, ctx.deps);
    await callTool("handoff_to_advisor", { contact_id: "c2", reason: "requested_by_user", summary: "Kwame asked to speak to a person in chat.", channel: "whatsapp" }, ctx.deps);
    ctx.db.handoffs[1].created_at = new Date(Date.parse(ctx.db.handoffs[0].created_at) + 1000).toISOString();
    return ctx;
  }

  it("lists pending handoffs oldest first with Lagos times and the overdue flag", async () => {
    const ctx = await withHandoffs();
    let out = await callAdminTool("list_pending_handoffs", {}, ctx.deps);
    expect(out).toMatchObject({ ok: true, count: 2 });
    const [first, second] = out.handoffs as Record<string, unknown>[];
    expect(first).toMatchObject({ name: "Ada Obi", programme: "MBA", channel: "call", callback_time: "Mon 26 Oct, 1:00 PM (Lagos time)", overdue: false });
    expect(second).toMatchObject({ name: "Kwame Mensah", channel: "whatsapp", overdue: false });

    ctx.setNow("2026-10-26T13:00:00Z"); // 14:00 Lagos, an hour after the agreed callback
    out = await callAdminTool("list_pending_handoffs", {}, ctx.deps);
    expect((out.handoffs as { overdue: boolean }[])[0].overdue).toBe(true);
  });

  it("update_handoff_status sets timestamps, appends notes, and hides contacted handoffs by default", async () => {
    const ctx = await withHandoffs();
    const id = ctx.db.handoffs[0].id;
    await callAdminTool("update_handoff_status", { handoff_id: id, status: "contacted", note: "Called, will follow up." }, ctx.deps);
    ctx.setNow("2026-10-26T08:00:00Z");
    const out = await callAdminTool("update_handoff_status", { handoff_id: id, status: "contacted", note: "Sent brochure." }, ctx.deps);
    expect(out).toMatchObject({ ok: true, status: "contacted", contacted_at: "2026-10-26T08:00:00.000Z" });
    expect(out.notes).toBe("[Mon 26 Oct, 8:00 AM (Lagos time)] Called, will follow up.\n[Mon 26 Oct, 9:00 AM (Lagos time)] Sent brochure.");

    expect((await callAdminTool("list_pending_handoffs", {}, ctx.deps)).count).toBe(1);
    expect((await callAdminTool("list_pending_handoffs", { include_contacted: true }, ctx.deps)).count).toBe(2);

    const closed = await callAdminTool("update_handoff_status", { handoff_id: id, status: "closed" }, ctx.deps);
    expect(closed.closed_at).toBe("2026-10-26T08:00:00.000Z");
  });

  it("update_handoff_status rejects unknown ids and bad input", async () => {
    const ctx = await withHandoffs();
    expect(await callAdminTool("update_handoff_status", { handoff_id: "7f1c0b2e-0000-4000-8000-000000000000", status: "closed" }, ctx.deps)).toMatchObject({ ok: false, error: "handoff_not_found" });
    expect((await callAdminTool("update_handoff_status", { handoff_id: "nope", status: "closed" }, ctx.deps)).ok).toBe(false);
  });

  it("get_lead finds by name fragment, email or contact_id with payment and handoff history", async () => {
    const ctx = await withHandoffs();
    for (const query of ["ada", "ADA@example.com", "c1"]) {
      const out = await callAdminTool("get_lead", { query }, ctx.deps);
      expect(out).toMatchObject({ ok: true, count: 1 });
      const [lead] = out.leads as Record<string, any>[];
      expect(lead.profile).toMatchObject({ full_name: "Ada Obi", contact_id: "c1" });
      expect(lead.payment).toBeNull();
      expect(lead.handoffs).toHaveLength(1);
    }
    expect(await callAdminTool("get_lead", { query: "nobody" }, ctx.deps)).toMatchObject({ ok: true, count: 0 });
  });

  it("admin guidance carries no WhatsApp formatting rule", async () => {
    const ctx = await withHandoffs();
    expect((await callAdminTool("list_pending_handoffs", {}, ctx.deps)).agent_guidance).not.toMatch(/WhatsApp/);
  });
});
