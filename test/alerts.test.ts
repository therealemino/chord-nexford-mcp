import { createHmac } from "node:crypto";
import { DateTime } from "luxon";
import request from "supertest";
import { describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { specialistHoursLagosToday } from "../src/lib/hours.js";
import { callTool } from "../src/mcp/server.js";
import { buildHandoffEmail } from "../src/services/handoffAlerts.js";
import type { Handoff, Lead } from "../src/services/types.js";
import { makeDeps } from "./helpers/fakes.js";

// 08:00 Lagos on Sun 25 Oct 2026 (03:00 New York, EDT).
const NOW = "2026-10-25T07:00:00Z";
const call = { contact_id: "c1", reason: "requested_by_user", summary: "Vander, MBA Fintech and Blockchain, wants to discuss the foundation course.", channel: "call", callback_number: "+2349032234467", preferred_callback_time: "2026-10-25T19:00:00+01:00" };
const chat = { contact_id: "c1", reason: "requested_by_user", summary: "Vander wants to talk to a specialist in this chat.", channel: "whatsapp" };

async function withLead(opts: Parameters<typeof makeDeps>[0] = {}) {
  const ctx = makeDeps({ now: NOW, ...opts });
  await callTool("save_lead", { contact_id: "c1", full_name: "Vander Silco", email: "silco@example.com", country: "Nigeria", programme: "MBA in Fintech and Blockchain", has_bachelors_degree: true, degree_field: "other", years_relevant_experience: 4 }, ctx.deps);
  return ctx;
}

describe("handoff alert emails", () => {
  it("callback: exactly one email even when the tool is retried", async () => {
    const t = await withLead();
    const first = await callTool("handoff_to_advisor", call, t.deps);
    const retry = await callTool("handoff_to_advisor", call, t.deps);
    await t.settle();
    expect(first.ok && retry.ok).toBe(true);
    expect(t.db.handoffs).toHaveLength(1);
    expect(t.email.sent).toHaveLength(1);
    expect(t.email.sent[0].subject).toBe("[Callback] Call Vander Silco at 7:00 PM Lagos (2:00 PM ET)");
    expect(t.email.sent[0].text.split("\n")[0]).toBe("Call +2349032234467 around 7:00 PM Lagos time, Sunday 25 October (2:00 PM ET).");
    expect(t.email.sent[0].idempotencyKey).toBe(`handoff-alert/${t.db.handoffs[0].id}`);
    expect(t.db.handoffs[0].alert_emailed_at).not.toBeNull();
  });

  it("a different callback time is a new request and gets its own email", async () => {
    const t = await withLead();
    await callTool("handoff_to_advisor", call, t.deps);
    await callTool("handoff_to_advisor", { ...call, preferred_callback_time: "2026-10-25T20:00:00+01:00" }, t.deps);
    await t.settle();
    expect(t.email.sent.map((m) => m.subject)).toEqual([
      "[Callback] Call Vander Silco at 7:00 PM Lagos (2:00 PM ET)",
      "[Callback] Call Vander Silco at 8:00 PM Lagos (3:00 PM ET)",
    ]);
  });

  it("chat: one email with the chat subject", async () => {
    const t = await withLead();
    await callTool("handoff_to_advisor", chat, t.deps);
    await callTool("handoff_to_advisor", chat, t.deps);
    await t.settle();
    expect(t.email.sent.map((m) => m.subject)).toEqual(["[Chat handoff] Vander Silco wants a specialist on WhatsApp"]);
  });

  it("new_applicant: one email despite duplicate webhooks and a status check", async () => {
    const t = await withLead();
    const app = createApp(t.deps, { mcpBearerToken: "t", adminBearerToken: "a", paystackSecretKey: "sk_test_x" });
    const created = await callTool("create_application_payment", { contact_id: "c1" }, t.deps);
    const body = JSON.stringify({ event: "charge.success", data: { reference: created.reference } });
    const sig = createHmac("sha512", "sk_test_x").update(body).digest("hex");
    for (let i = 0; i < 2; i++) await request(app).post("/webhooks/paystack").set("content-type", "application/json").set("x-paystack-signature", sig).send(body);
    await callTool("get_payment_status", { contact_id: "c1" }, t.deps);
    await t.settle();
    expect(t.email.sent.map((m) => m.subject)).toEqual(["[New applicant] Vander Silco paid the $25 fee for MBA with a Fintech and Blockchain specialisation"]);
    expect(t.email.sent[0].text).toContain(`Application fee: success (ref ${created.reference})`);
  });

  it("an email failure doesn't fail the tool; the error is recorded", async () => {
    const t = await withLead();
    t.email.send.mockRejectedValueOnce(new Error("Resend: validation_error: domain not verified"));
    const out = await callTool("handoff_to_advisor", call, t.deps);
    await t.settle();
    expect(out).toMatchObject({ ok: true, channel: "call" });
    expect(t.db.handoffs[0]).toMatchObject({ alert_emailed_at: null, alert_error: "Resend: validation_error: domain not verified" });
  });

  it("without Resend configured, handoffs still work and nothing is recorded as failed", async () => {
    const t = await withLead({ email: false });
    expect((await callTool("handoff_to_advisor", call, t.deps)).ok).toBe(true);
    await t.settle();
    expect(t.db.handoffs[0]).toMatchObject({ alert_emailed_at: null, alert_error: null });
  });

  it("links the Chord thread found from the handoff_to_advisor turn", async () => {
    const t = await withLead({ strategy: "takeover" });
    await callTool("handoff_to_advisor", chat, t.deps);
    t.chord.addCustomerThread("t_vander", Date.parse(t.db.handoffs[0].created_at), { tool: "handoff_to_advisor" });
    await t.settle();
    expect(t.email.sent[0].text).toContain("Chord thread: https://chord.example/threads/t_vander");
    expect(t.db.leads[0].chord_thread_id).toBe("t_vander");
  });
});

describe("buildHandoffEmail", () => {
  const lead = {
    id: "l1", full_name: "Ada <Obi>", email: "ada@example.com", country: "Nigeria", programme: "MBA", has_bachelors_degree: true,
    degree_field: "other", years_relevant_experience: 1, eligibility_result: "foundation_likely", foundation_courses: ["FND 5100"],
  } as Lead;
  const handoff = { id: "h1", reason: "complaint", channel: "call", callback_number: "+234800", callback_time: null, summary: "Unhappy <b>about</b> wait" } as Handoff;

  it("handles a callback with no agreed time and escapes HTML", () => {
    const e = buildHandoffEmail({ handoff, lead, payment: null, threadUrl: null });
    expect(e.subject).toBe("[Callback] Call Ada <Obi> during specialist hours (no time agreed)");
    expect(e.text).toContain("Waiver can be requested: no");
    expect(e.text).toContain("Eligibility: foundation_likely, foundation: FND 5100");
    expect(e.text).toContain("Handoff id: h1 (mark it contacted with update_handoff_status)");
    expect(e.html).toContain("Ada &lt;Obi&gt;");
    expect(e.html).toContain("Unhappy &lt;b&gt;about&lt;/b&gt; wait");
    expect(e.html).not.toContain("<b>about");
  });
});

describe("specialist hours and callback guidance", () => {
  it("today's window in Lagos is 12:00 PM to 11:00 PM before the US clock change and 1:00 PM to 12:00 AM after", () => {
    expect(specialistHoursLagosToday(DateTime.fromISO("2026-10-25T09:00:00Z"))).toBe("12:00 PM to 11:00 PM");
    expect(specialistHoursLagosToday(DateTime.fromISO("2026-11-02T09:00:00Z"))).toBe("1:00 PM to 12:00 AM");
  });

  it("every handoff result carries today's window", async () => {
    const t = await withLead();
    for (const args of [call, chat, { ...call, callback_number: undefined }]) {
      expect(await callTool("handoff_to_advisor", args, t.deps)).toMatchObject({ specialist_hours_lagos_today: "12:00 PM to 11:00 PM" });
    }
  });

  it("an out-of-window request returns the next slot to offer and books nothing", async () => {
    const t = await withLead();
    const out = await callTool("handoff_to_advisor", { ...call, preferred_callback_time: "2026-10-25T09:00:00+01:00" }, t.deps);
    expect(out).toMatchObject({ ok: false, reason: "outside_hours", next_available_slot: { display: "Sun 25 Oct, 12:00 PM (Lagos time)" } });
    expect(out.agent_guidance).toMatch(/Nothing was booked/);
    expect(t.db.handoffs).toHaveLength(0);
  });

  it("only a successful handoff tells the agent to say the request is in, with the returned time", async () => {
    const t = await withLead();
    const out = await callTool("handoff_to_advisor", call, t.deps);
    expect(out.agent_guidance).toMatch(/call request is in: an Application Specialist will call \+2349032234467 around Sun 25 Oct, 7:00 PM \(Lagos time\)/);
    const bad = await callTool("handoff_to_advisor", { ...call, callback_number: undefined }, t.deps);
    expect(bad.agent_guidance).not.toMatch(/request is in/);
  });

  it("an internal error never claims anything was booked and offers the booking link", async () => {
    const t = await withLead();
    t.deps.repo.insertHandoff = async () => {
      throw new Error("db down");
    };
    const out = await callTool("handoff_to_advisor", call, t.deps);
    expect(out).toMatchObject({ ok: false, error: "internal_error" });
    expect(out.agent_guidance).toMatch(/nothing was saved or booked/);
    expect(out.agent_guidance).toContain("hub.nexford.edu/meetings/nxu/consultation");
  });
});
