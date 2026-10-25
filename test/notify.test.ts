import { createHmac } from "node:crypto";
import request from "supertest";
import { describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import type { NotifyStrategy } from "../src/config/chord.js";
import { callTool } from "../src/mcp/server.js";
import { confirmationMessage, sendViaTakeover } from "../src/services/notify.js";
import type { Lead } from "../src/services/types.js";
import { makeDeps } from "./helpers/fakes.js";

const SECRET = "sk_test_notify";
const sign = (body: string) => createHmac("sha512", SECRET).update(body).digest("hex");

/** A lead who has paid in Chord thread "t_peace", ready for the webhook. */
async function paidApplicant(strategy: NotifyStrategy | null = "takeover") {
  const ctx = makeDeps({ strategy });
  const app = createApp(ctx.deps, { mcpBearerToken: "t", adminBearerToken: "a", paystackSecretKey: SECRET });
  await callTool("save_lead", { contact_id: "customer_peace", full_name: "Ejei-Okeke Peace", email: "peace@example.com", country: "Nigeria", programme: "MBA in Fintech and Blockchain", has_bachelors_degree: true, degree_field: "other", years_relevant_experience: 4 }, ctx.deps);
  await callTool("assess_eligibility", { contact_id: "customer_peace" }, ctx.deps);
  const created = await callTool("create_application_payment", { contact_id: "customer_peace" }, ctx.deps);
  ctx.chord.addCustomerThread("t_peace", Date.parse(ctx.db.payments[0].created_at));
  const body = JSON.stringify({ event: "charge.success", data: { reference: created.reference } });
  const webhook = () => request(app).post("/webhooks/paystack").set("content-type", "application/json").set("x-paystack-signature", sign(body)).send(body);
  return { ...ctx, created, webhook, newApplicant: () => ctx.db.handoffs.filter((h) => h.reason === "new_applicant") };
}

describe("payment success side effects", () => {
  it("notifies once and creates one new_applicant handoff despite duplicate webhooks and a status check", async () => {
    const t = await paidApplicant();
    expect((await t.webhook()).status).toBe(200);
    expect((await t.webhook()).status).toBe(200);
    await callTool("get_payment_status", { contact_id: "customer_peace" }, t.deps);
    await t.settle();

    expect(t.chord.client.sendMessage).toHaveBeenCalledTimes(1);
    expect(t.chord.client.takeOver).toHaveBeenCalledTimes(1);
    expect(t.chord.client.handBack).toHaveBeenCalledTimes(1);
    expect(t.newApplicant()).toHaveLength(1);
    expect(t.db.payments[0]).toMatchObject({ status: "success", notify_error: null });
    expect(t.db.payments[0].customer_notified_at).not.toBeNull();
    expect(t.db.leads[0].chord_thread_id).toBe("t_peace");

    const [, body] = t.chord.client.sendMessage.mock.calls[0] as unknown as [string, { text: string }];
    expect(body.text).toContain("Payment received ✅ Your $25 application fee (₦33,217) has come through, Peace.");
    expect(body.text).toContain("next steps for the MBA with a Fintech and Blockchain specialisation.");
  });

  it("when get_payment_status confirms first, the agent tells them in-chat and no proactive message is sent", async () => {
    const t = await paidApplicant();
    const out = await callTool("get_payment_status", { contact_id: "customer_peace" }, t.deps);
    expect(out.payment_status).toBe("success");
    await t.webhook();
    await t.settle();
    expect(t.chord.client.sendMessage).not.toHaveBeenCalled();
    expect(t.db.payments[0].customer_notified_at).not.toBeNull();
    expect(t.newApplicant()).toHaveLength(1);
  });

  it("a notification failure doesn't affect the payment or the webhook response, and still hands back", async () => {
    const t = await paidApplicant();
    t.chord.client.sendMessage.mockRejectedValueOnce(new Error("Chord POST /v1/threads/x/messages failed (500)"));
    expect((await t.webhook()).status).toBe(200);
    await t.settle();
    expect(t.db.payments[0].status).toBe("success");
    expect(t.db.leads[0].status).toBe("paid");
    expect(t.db.payments[0].customer_notified_at).toBeNull();
    expect(t.db.payments[0].notify_error).toMatch(/failed \(500\)/);
    expect(t.chord.client.handBack).toHaveBeenCalledTimes(1);
  });

  it("doesn't message anyone when two threads match (ambiguous)", async () => {
    const t = await paidApplicant();
    t.chord.addCustomerThread("t_other", Date.parse(t.db.payments[0].created_at) + 5000, { displayName: "Someone" });
    await t.webhook();
    await t.settle();
    expect(t.chord.client.sendMessage).not.toHaveBeenCalled();
    expect(t.db.payments[0].notify_error).toBe("thread_not_found");
    expect(t.db.leads[0].chord_thread_id).toBeNull();
  });

  it("ignores the owner's PRINCIPAL thread and threads where the tool wasn't used in the window", async () => {
    const t = await paidApplicant();
    const at = Date.parse(t.db.payments[0].created_at);
    t.chord.threads.push({ id: "t_owner", channel_role: "PRINCIPAL", last_turn_at: at + 1000 });
    t.chord.turns.t_owner = [{ direction: "outbound", timestamp: at + 1000, metadata: { tools_used: [{ name: "mcp__X__create_application_payment" }] } }];
    t.chord.addCustomerThread("t_old", at - 10 * 60_000); // payment link made 10 minutes earlier
    t.chord.threads.find((x) => x.id === "t_old")!.last_turn_at = at + 2000; // but active recently
    await t.webhook();
    await t.settle();
    expect(t.chord.client.sendMessage).toHaveBeenCalledWith("t_peace", expect.anything());
  });

  it("scheduled_task strategy posts a MESSAGE task with conversation_id and body", async () => {
    const t = await paidApplicant("scheduled_task");
    await t.webhook();
    await t.settle();
    const [task] = t.chord.client.createScheduledTask.mock.calls[0] as unknown as [Record<string, unknown>];
    expect(task).toMatchObject({ task_type: "MESSAGE", workspace_id: "ws_1", teammate_id: "tm_1", payload: { conversation_id: "pconv_t_peace" } });
    expect((task.payload as { body: string }).body).toMatch(/^Payment received/);
    expect(Date.parse(String(task.scheduled_at))).toBeGreaterThan(t.deps.now().toMillis());
    expect(t.chord.client.takeOver).not.toHaveBeenCalled();
  });

  it("with notifications off nothing is sent, the handoff is still created, and the agent isn't told to promise a message", async () => {
    const t = await paidApplicant(null);
    expect(t.created.agent_guidance).not.toMatch(/as soon as the payment comes through/);
    await t.webhook();
    await t.settle();
    expect(t.chord.client.listThreads).not.toHaveBeenCalled();
    expect(t.newApplicant()).toHaveLength(1);
  });

  it("the payment link guidance promises a message here and doesn't ask them to report back", async () => {
    const t = await paidApplicant();
    expect(t.created.agent_guidance).toMatch(/you'll message them here as soon as the payment comes through/);
    expect(t.created.agent_guidance).toMatch(/Do not ask them to message you after paying/);
  });

  it("new applicant summary has programme with specialisation, eligibility, waiver, reference and callback", async () => {
    const t = await paidApplicant();
    await callTool("handoff_to_advisor", { contact_id: "customer_peace", reason: "scholarship_or_funding", summary: "Wants to discuss scholarships for the MBA specialisation.", channel: "call", callback_number: "+2349032234467" }, t.deps);
    await t.webhook();
    const summary = t.newApplicant()[0].summary;
    expect(summary).toContain("Programme: MBA with a Fintech and Blockchain specialisation.");
    expect(summary).toContain("Eligibility: foundation_likely (FND 5100); waiver can be requested: yes.");
    expect(summary).toContain(`Payment ref: ${t.created.reference}.`);
    expect(summary).toContain("Callback requested: +2349032234467, no time agreed (pending).");
    expect(t.newApplicant()[0]).toMatchObject({ channel: "whatsapp", status: "pending" });
  });
});

describe("sendViaTakeover", () => {
  it("always hands back after taking over, even if sending fails", async () => {
    const { chord } = makeDeps();
    chord.client.sendMessage.mockRejectedValueOnce(new Error("boom"));
    await expect(sendViaTakeover(chord.client, "t1", { control_state: "agent_active" }, "hi")).rejects.toThrow("boom");
    expect(chord.client.takeOver).toHaveBeenCalledWith("t1");
    expect(chord.client.handBack).toHaveBeenCalledWith("t1");
  });

  it("leaves a thread a human is handling with the human", async () => {
    const { chord } = makeDeps();
    await sendViaTakeover(chord.client, "t1", { control_state: "human_active" }, "hi");
    expect(chord.client.takeOver).not.toHaveBeenCalled();
    expect(chord.client.handBack).not.toHaveBeenCalled();
    expect(chord.client.sendMessage).toHaveBeenCalledWith("t1", { text: "hi" });
  });
});

describe("confirmationMessage", () => {
  const lead = { full_name: "Ada Obi", programme: null } as Lead;
  it("falls back to the lead's first name and leaves out a missing programme, with no Markdown", () => {
    const text = confirmationMessage(lead, null);
    expect(text).toContain("has come through, Ada.");
    expect(text).toContain("about next steps. Anything else");
    expect(text).not.toMatch(/\*|#/);
  });
});
