import { createHmac } from "node:crypto";
import request from "supertest";
import { describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { callTool } from "../src/mcp/server.js";
import { makeDeps } from "./helpers/fakes.js";

const SECRET = "sk_test_webhook_secret";
const sign = (body: string) => createHmac("sha512", SECRET).update(body).digest("hex");

async function setup(verify = {}) {
  const ctx = makeDeps({ verify });
  const app = createApp(ctx.deps, { mcpBearerToken: "token", adminBearerToken: "admin", paystackSecretKey: SECRET });
  await callTool("save_lead", { contact_id: "w1", full_name: "Ada", email: "a@example.com" }, ctx.deps);
  const created = await callTool("create_application_payment", { contact_id: "w1" }, ctx.deps);
  const body = JSON.stringify({ event: "charge.success", data: { reference: created.reference, amount: 3_321_700, currency: "NGN" } });
  const send = (b = body, sig = sign(b)) =>
    request(app).post("/webhooks/paystack").set("content-type", "application/json").set("x-paystack-signature", sig).send(b);
  return { ...ctx, send, body };
}

describe("POST /webhooks/paystack", () => {
  it("rejects a bad signature with 401 and records nothing", async () => {
    const { send, body, db } = await setup();
    const res = await send(body, "deadbeef");
    expect(res.status).toBe(401);
    expect(db.webhookEvents).toHaveLength(0);
    expect(db.payments[0].status).toBe("pending");
  });

  it("rejects a missing signature with 401", async () => {
    const { deps } = makeDeps();
    const app = createApp(deps, { mcpBearerToken: "token", adminBearerToken: "admin", paystackSecretKey: SECRET });
    const res = await request(app).post("/webhooks/paystack").set("content-type", "application/json").send("{}");
    expect(res.status).toBe(401);
  });

  it("marks the payment and lead paid once; a duplicate delivery changes nothing", async () => {
    const { send, db, repo = db.repo } = await setup();

    const first = await send();
    expect(first.status).toBe(200);
    expect(db.payments[0].status).toBe("success");
    const paidAt = db.payments[0].paid_at;
    const updatedAt = db.payments[0].updated_at;
    expect(db.leads[0].status).toBe("paid");

    // Simulate a later lead change so we can see the duplicate doesn't touch it.
    db.leads[0].status = "handed_off";

    const second = await send();
    expect(second.status).toBe(200);
    expect(db.payments[0]).toMatchObject({ status: "success", paid_at: paidAt, updated_at: updatedAt });
    expect(db.leads[0].status).toBe("handed_off");
    expect(repo.markPaymentSuccess).toHaveBeenCalledTimes(1);
    expect(db.webhookEvents).toHaveLength(2);
  });

  it("does not trust the payload: an amount mismatch from verify marks the payment failed", async () => {
    const { send, db } = await setup({ amount: 100 });
    const res = await send();
    expect(res.status).toBe(200);
    expect(db.payments[0].status).toBe("failed");
    expect(db.leads[0].status).toBe("applied");
  });

  it("acknowledges other events without changing anything", async () => {
    const { send, db, paystack } = await setup();
    const res = await send(JSON.stringify({ event: "transfer.success", data: { reference: "x" } }));
    expect(res.status).toBe(200);
    expect(paystack.verify).not.toHaveBeenCalled();
    expect(db.payments[0].status).toBe("pending");
  });
});
