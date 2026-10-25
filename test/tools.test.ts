import { describe, expect, it } from "vitest";
import { callTool } from "../src/mcp/server.js";
import { makeDeps } from "./helpers/fakes.js";

describe("save_lead", () => {
  it("creates then partially updates a lead without wiping other fields", async () => {
    const { deps, db } = makeDeps();
    await callTool("save_lead", { contact_id: "+234 803 000 0000", full_name: "Ada Obi", country: "nigeria" }, deps);
    const out = await callTool("save_lead", { contact_id: "2348030000000", email: "ADA@example.com", full_name: null }, deps);
    expect(out.ok).toBe(true);
    expect(db.leads).toHaveLength(1);
    expect(out.lead).toMatchObject({ contact_id: "2348030000000", full_name: "Ada Obi", country: "Nigeria", email: "ada@example.com" });
    expect(out.lead).not.toHaveProperty("id");
  });

  it("returns ok:false with a clear error on bad input", async () => {
    const { deps } = makeDeps();
    const out = await callTool("save_lead", { contact_id: "x", email: "not-an-email", years_relevant_experience: 99 }, deps);
    expect(out.ok).toBe(false);
    expect(out.error).toMatch(/email/);
    expect(out.error).toMatch(/years_relevant_experience/);
  });
});

describe("assess_eligibility", () => {
  it("uses saved facts, persists the result and marks the lead qualified", async () => {
    const { deps, db } = makeDeps();
    await callTool("save_lead", { contact_id: "c1", programme: "MBA", has_bachelors_degree: true, degree_field: "other", years_relevant_experience: 4 }, deps);
    const out = await callTool("assess_eligibility", { contact_id: "c1" }, deps);
    expect(out).toMatchObject({ ok: true, result: "foundation_likely", waiver_can_be_requested: true });
    expect(out.agent_guidance).toMatch(/likely/);
    expect(db.leads[0]).toMatchObject({ eligibility_result: "foundation_likely", foundation_courses: ["FND 5100"], status: "qualified" });
  });

  it("not_eligible does not mark the lead qualified", async () => {
    const { deps, db } = makeDeps();
    const out = await callTool("assess_eligibility", { contact_id: "c2", programme: "MBA", has_bachelors_degree: false }, deps);
    expect(out.result).toBe("not_eligible");
    expect(db.leads[0].status).toBe("enquiring");
  });

  it("need_more_info for MS Data Analytics without the statistics answer", async () => {
    const { deps } = makeDeps();
    const out = await callTool("assess_eligibility", { contact_id: "c3", programme: "MS Data Analytics", has_bachelors_degree: true, degree_field: "business" }, deps);
    expect(out).toMatchObject({ ok: true, result: "need_more_info", missing_fields: ["has_statistics_course"] });
  });
});

describe("get_tuition", () => {
  it("returns Ghana MBA as unavailable with the calculator link", async () => {
    const { deps } = makeDeps();
    const out = await callTool("get_tuition", { programme: "MBA", country: "Ghana" }, deps);
    expect(out).toMatchObject({ ok: true, available: false, tuition_calculator: "https://www.nexford.edu/tuition" });
  });

  it("returns the Nigeria MBA price with guidance about the current rate", async () => {
    const { deps } = makeDeps();
    const out = await callTool("get_tuition", { programme: "MBA", country: "Nigeria" }, deps);
    expect(out).toMatchObject({ ok: true, usd: 275, local: { currency: "NGN", amount: 365_385 } });
    expect(out.agent_guidance).toMatch(/at Nexford's current rate/);
  });
});

describe("create_application_payment", () => {
  const ready = { contact_id: "p1", full_name: "Ada Obi", email: "ada@example.com" };

  it("asks for missing name and email", async () => {
    const { deps, paystack } = makeDeps();
    await callTool("save_lead", { contact_id: "p1" }, deps);
    const out = await callTool("create_application_payment", { contact_id: "p1" }, deps);
    expect(out).toMatchObject({ ok: false, missing_fields: ["full_name", "email"] });
    expect(paystack.initialize).not.toHaveBeenCalled();
  });

  it("creates a pending payment for 3,321,700 kobo before returning the link", async () => {
    const { deps, db, paystack } = makeDeps();
    await callTool("save_lead", ready, deps);
    const out = await callTool("create_application_payment", { contact_id: "p1" }, deps);
    expect(out).toMatchObject({ ok: true, payment_status: "pending", amount_ngn: 33_217, amount_usd: 25, reused_existing_link: false });
    expect(paystack.initialize).toHaveBeenCalledWith(
      expect.objectContaining({ amountKobo: 3_321_700, currency: "NGN", callbackUrl: "https://example.test/payments/callback" }),
    );
    expect(db.payments).toHaveLength(1);
    expect(db.payments[0]).toMatchObject({ status: "pending", paystack_reference: out.reference, authorization_url: out.authorization_url });
    expect(out.reference).toMatch(/^nxu_app_[0-9a-f]{8}_\d+$/);
    expect(db.leads[0].status).toBe("applied");
  });

  it("reuses a pending link under 30 minutes old, creates a new one after", async () => {
    const { deps, db, paystack, setNow } = makeDeps({ now: new Date().toISOString() });
    await callTool("save_lead", ready, deps);
    const first = await callTool("create_application_payment", { contact_id: "p1" }, deps);
    const second = await callTool("create_application_payment", { contact_id: "p1" }, deps);
    expect(second).toMatchObject({ reused_existing_link: true, authorization_url: first.authorization_url });
    expect(paystack.initialize).toHaveBeenCalledTimes(1);

    setNow(new Date(Date.now() + 31 * 60_000).toISOString());
    const third = await callTool("create_application_payment", { contact_id: "p1" }, deps);
    expect(third.reused_existing_link).toBe(false);
    expect(db.payments).toHaveLength(2);
  });

  it("never charges again once paid", async () => {
    const { deps, db, paystack } = makeDeps();
    await callTool("save_lead", ready, deps);
    await callTool("create_application_payment", { contact_id: "p1" }, deps);
    db.payments[0].status = "success";
    const out = await callTool("create_application_payment", { contact_id: "p1" }, deps);
    expect(out).toMatchObject({ ok: true, already_paid: true });
    expect(paystack.initialize).toHaveBeenCalledTimes(1);
  });
});

describe("get_payment_status", () => {
  it("reconciles a pending payment with Paystack (missed webhook)", async () => {
    const { deps, db, paystack } = makeDeps();
    await callTool("save_lead", { contact_id: "s1", full_name: "Ada", email: "a@example.com" }, deps);
    await callTool("create_application_payment", { contact_id: "s1" }, deps);
    const out = await callTool("get_payment_status", { contact_id: "s1" }, deps);
    expect(paystack.verify).toHaveBeenCalledTimes(1);
    expect(out).toMatchObject({ ok: true, payment_status: "success" });
    expect(db.leads[0].status).toBe("paid");
  });

  it("stays pending when Paystack hasn't seen a payment", async () => {
    const { deps, db } = makeDeps({ verify: { status: "abandoned" } });
    await callTool("save_lead", { contact_id: "s2", full_name: "Ada", email: "a@example.com" }, deps);
    await callTool("create_application_payment", { contact_id: "s2" }, deps);
    const out = await callTool("get_payment_status", { contact_id: "s2" }, deps);
    expect(out.payment_status).toBe("pending");
    expect(out.agent_guidance).toMatch(/hasn't come through/);
    expect(db.leads[0].status).toBe("applied");
  });

  it("returns none when nothing was started", async () => {
    const { deps } = makeDeps();
    expect(await callTool("get_payment_status", { contact_id: "nobody" }, deps)).toMatchObject({ ok: true, payment_status: "none" });
  });
});

describe("handoff_to_advisor", () => {
  // 08:00 Lagos Monday 26 Oct = 03:00 New York
  const now = "2026-10-26T07:00:00Z";
  const base = { contact_id: "h1", reason: "scholarship_or_funding", summary: "Nigerian engineering graduate asking about MBA scholarships." };

  it("rejects a 9am Lagos callback, saves nothing, and offers alternatives", async () => {
    const { deps, db } = makeDeps({ now });
    const out = await callTool("handoff_to_advisor", { ...base, channel: "call", callback_number: "+2348030000000", preferred_callback_time: "2026-10-26T09:00:00+01:00" }, deps);
    expect(out).toMatchObject({ ok: false, reason: "outside_hours" });
    expect(out.alternatives).toHaveLength(3);
    expect(db.handoffs).toHaveLength(0);
  });

  it("books a valid callback using the saved WhatsApp number", async () => {
    const { deps, db } = makeDeps({ now });
    await callTool("save_lead", { contact_id: "h1", whatsapp_number: "+2348030000000" }, deps);
    const out = await callTool("handoff_to_advisor", { ...base, channel: "call", use_whatsapp_number: true, preferred_callback_time: "2026-10-26T15:00:00+01:00" }, deps);
    expect(out).toMatchObject({ ok: true, channel: "call", callback_time: "Mon 26 Oct, 3:00 PM (Lagos time)" });
    expect(db.handoffs[0]).toMatchObject({ callback_number: "+2348030000000", callback_time: "2026-10-26T14:00:00.000Z" });
    expect(db.leads[0].status).toBe("handed_off");
  });

  it("call without a preferred time is saved and returns the next window", async () => {
    const { deps, db } = makeDeps({ now });
    const out = await callTool("handoff_to_advisor", { ...base, channel: "call", callback_number: "+2348030000000" }, deps);
    expect(out).toMatchObject({ ok: true, callback_time: null, next_available_window: { opens: "Mon 26 Oct, 12:00 PM (Lagos time)" } });
    expect(db.handoffs[0].callback_time).toBeNull();
  });

  it("call requires a number", async () => {
    const { deps } = makeDeps({ now });
    const out = await callTool("handoff_to_advisor", { ...base, channel: "call" }, deps);
    expect(out).toMatchObject({ ok: false, error: "callback_number_required" });
  });

  it("rejects a too-short summary", async () => {
    const { deps } = makeDeps({ now });
    const out = await callTool("handoff_to_advisor", { ...base, summary: "short", channel: "whatsapp" }, deps);
    expect(out.ok).toBe(false);
    expect(out.error).toMatch(/summary/);
  });
});
