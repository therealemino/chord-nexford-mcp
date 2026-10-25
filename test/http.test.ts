import request from "supertest";
import { describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { loadEnv } from "../src/env.js";
import { makeDeps } from "./helpers/fakes.js";

const TOKEN = "test-bearer-token";
const ADMIN_TOKEN = "test-admin-token";
const app = () => createApp(makeDeps().deps, { mcpBearerToken: TOKEN, adminBearerToken: ADMIN_TOKEN, paystackSecretKey: "sk_test_x" });
const rpc = (method: string, params: unknown = {}) => ({ jsonrpc: "2.0", id: 1, method, params });
const mcp = (token?: string, path = "/mcp") => {
  const r = request(app()).post(path).set("accept", "application/json, text/event-stream").set("content-type", "application/json");
  return token ? r.set("authorization", `Bearer ${token}`) : r;
};

describe("/mcp auth", () => {
  it("rejects missing and wrong bearer tokens", async () => {
    expect((await mcp().send(rpc("tools/list"))).status).toBe(401);
    expect((await mcp("wrong").send(rpc("tools/list"))).status).toBe(401);
  });
});

describe("/mcp-admin", () => {
  const names = async (path: string, token: string) =>
    ((await mcp(token, path).send(rpc("tools/list"))).body.result.tools as { name: string }[]).map((t) => t.name);

  it("customer and admin endpoints share no tools", async () => {
    const customer = await names("/mcp", TOKEN);
    const admin = await names("/mcp-admin", ADMIN_TOKEN);
    expect(admin).toEqual(["get_pipeline_summary", "list_pending_handoffs", "update_handoff_status", "get_lead"]);
    expect(customer.filter((n) => admin.includes(n))).toEqual([]);
    expect(admin.filter((n) => customer.includes(n))).toEqual([]);
  });

  it("each endpoint only accepts its own token", async () => {
    expect((await mcp(TOKEN, "/mcp-admin").send(rpc("tools/list"))).status).toBe(401);
    expect((await mcp(ADMIN_TOKEN, "/mcp").send(rpc("tools/list"))).status).toBe(401);
    expect((await mcp(undefined, "/mcp-admin").send(rpc("tools/list"))).status).toBe(401);
  });

  it("admin tools cannot be called on the customer endpoint", async () => {
    const res = await mcp(TOKEN).send(rpc("tools/call", { name: "get_lead", arguments: { query: "ada" } }));
    expect(JSON.parse(res.body.result.content[0].text)).toMatchObject({ ok: false, error: "unknown_tool" });
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
    ADMIN_MCP_BEARER_TOKEN: "admin-t",
    CHORD_API_KEY: "chord_key",
    CHORD_WORKSPACE_ID: "ws_1",
    CHORD_TEAMMATE_ID: "tm_1",
    SUPABASE_URL: "https://x.supabase.co",
    SUPABASE_SERVICE_ROLE_KEY: "k",
    PAYSTACK_SECRET_KEY: "sk_test_abc",
    PUBLIC_BASE_URL: "https://x.onrender.com/",
  };

  it("loads a complete test-mode config, defaulting to the takeover strategy", () => {
    const env = loadEnv(full);
    expect(env.PUBLIC_BASE_URL).toBe("https://x.onrender.com");
    expect(env.CHORD_NOTIFY_STRATEGY).toBe("takeover");
    expect(env.chord).toEqual({ apiKey: "chord_key", workspaceId: "ws_1", teammateId: "tm_1" });
  });

  it("doesn't need Chord settings when notifications are off", () => {
    const { CHORD_API_KEY: _k, CHORD_WORKSPACE_ID: _w, CHORD_TEAMMATE_ID: _t, ...rest } = full;
    expect(loadEnv({ ...rest, CHORD_NOTIFY_STRATEGY: "off" }).chord).toBeNull();
    expect(() => loadEnv(rest)).toThrow(/CHORD_API_KEY/);
  });

  it("refuses a bad strategy and a shared admin token", () => {
    expect(() => loadEnv({ ...full, CHORD_NOTIFY_STRATEGY: "smoke_signals" })).toThrow(/CHORD_NOTIFY_STRATEGY/);
    expect(() => loadEnv({ ...full, ADMIN_MCP_BEARER_TOKEN: "t" })).toThrow(/different/);
  });

  it("refuses missing variables and live keys", () => {
    expect(() => loadEnv({ ...full, SUPABASE_URL: "" })).toThrow(/SUPABASE_URL/);
    expect(() => loadEnv({ ...full, PAYSTACK_SECRET_KEY: "sk_live_abc" })).toThrow(/TEST key/);
  });
});
