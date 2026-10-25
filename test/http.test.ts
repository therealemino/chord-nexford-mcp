import request from "supertest";
import { describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { loadEnv } from "../src/env.js";
import { makeDeps } from "./helpers/fakes.js";

const TOKEN = "test-bearer-token";
const app = () => createApp(makeDeps().deps, { mcpBearerToken: TOKEN, paystackSecretKey: "sk_test_x" });
const rpc = (method: string, params: unknown = {}) => ({ jsonrpc: "2.0", id: 1, method, params });
const mcp = (token?: string) => {
  const r = request(app()).post("/mcp").set("accept", "application/json, text/event-stream").set("content-type", "application/json");
  return token ? r.set("authorization", `Bearer ${token}`) : r;
};

describe("/mcp auth", () => {
  it("rejects missing and wrong bearer tokens", async () => {
    expect((await mcp().send(rpc("tools/list"))).status).toBe(401);
    expect((await mcp("wrong").send(rpc("tools/list"))).status).toBe(401);
  });
});

describe("/mcp protocol", () => {
  it("lists all six tools with object input schemas", async () => {
    const res = await mcp(TOKEN).send(rpc("tools/list"));
    expect(res.status).toBe(200);
    const tools = res.body.result.tools as { name: string; inputSchema: { type: string; required?: string[] } }[];
    expect(tools.map((t) => t.name)).toEqual([
      "save_lead",
      "assess_eligibility",
      "get_tuition",
      "create_application_payment",
      "get_payment_status",
      "handoff_to_advisor",
    ]);
    expect(tools.every((t) => t.inputSchema.type === "object")).toBe(true);
    expect(tools.find((t) => t.name === "get_tuition")!.inputSchema.required).toEqual(["programme", "country"]);
  });

  it("calls a tool and returns JSON text; invalid input is ok:false, not a protocol error", async () => {
    const good = await mcp(TOKEN).send(rpc("tools/call", { name: "get_tuition", arguments: { programme: "BBA", country: "Nigeria" } }));
    expect(JSON.parse(good.body.result.content[0].text)).toMatchObject({ ok: true, usd: 120 });

    const bad = await mcp(TOKEN).send(rpc("tools/call", { name: "get_tuition", arguments: { programme: "BBA" } }));
    expect(bad.body.error).toBeUndefined();
    expect(JSON.parse(bad.body.result.content[0].text)).toMatchObject({ ok: false });
  });

  it("GET /mcp is not allowed in stateless mode", async () => {
    const res = await request(app()).get("/mcp").set("authorization", `Bearer ${TOKEN}`);
    expect(res.status).toBe(405);
  });
});

describe("other routes", () => {
  it("health and payment callback page", async () => {
    expect((await request(app()).get("/health")).body).toEqual({ ok: true });
    const page = await request(app()).get("/payments/callback?reference=abc");
    expect(page.status).toBe(200);
    expect(page.text).toMatch(/return to WhatsApp/);
  });
});

describe("loadEnv", () => {
  const full = {
    PORT: "3000",
    MCP_BEARER_TOKEN: "t",
    SUPABASE_URL: "https://x.supabase.co",
    SUPABASE_SERVICE_ROLE_KEY: "k",
    PAYSTACK_SECRET_KEY: "sk_test_abc",
    PUBLIC_BASE_URL: "https://x.onrender.com/",
  };

  it("loads a complete test-mode config", () => {
    expect(loadEnv(full).PUBLIC_BASE_URL).toBe("https://x.onrender.com");
  });

  it("refuses missing variables and live keys", () => {
    expect(() => loadEnv({ ...full, SUPABASE_URL: "" })).toThrow(/SUPABASE_URL/);
    expect(() => loadEnv({ ...full, PAYSTACK_SECRET_KEY: "sk_live_abc" })).toThrow(/TEST key/);
  });
});
