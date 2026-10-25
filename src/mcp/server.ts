import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { CallToolRequestSchema, ListToolsRequestSchema, type CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { log } from "../lib/log.js";
import { fail, type ToolOutput } from "../lib/result.js";
import { assessEligibilityTool } from "./tools/assessEligibility.js";
import { createApplicationPayment } from "./tools/createApplicationPayment.js";
import { getPaymentStatus } from "./tools/getPaymentStatus.js";
import { getTuition } from "./tools/getTuition.js";
import { handoffToAdvisor } from "./tools/handoffToAdvisor.js";
import { saveLead } from "./tools/saveLead.js";
import { WHATSAPP_FORMAT } from "./shared.js";
import type { Deps, ToolDef } from "./types.js";

export const TOOLS = [
  saveLead,
  assessEligibilityTool,
  getTuition,
  createApplicationPayment,
  getPaymentStatus,
  handoffToAdvisor,
] as unknown as ToolDef[];

const asResult = (out: ToolOutput): CallToolResult => ({ content: [{ type: "text", text: JSON.stringify(out) }] });

const formatIssues = (error: z.ZodError) =>
  error.issues.map((i) => `${i.path.join(".") || "input"}: ${i.message}`).join("; ");

/** Runs a tool by name with our own validation, so bad input becomes { ok: false, error } instead of a protocol error. */
export async function callTool(name: string, args: unknown, deps: Deps): Promise<ToolOutput> {
  const out = await runTool(name, args, deps);
  return { ...out, agent_guidance: `${out.agent_guidance ?? ""} ${WHATSAPP_FORMAT}`.trim() };
}

async function runTool(name: string, args: unknown, deps: Deps): Promise<ToolOutput> {
  const tool = TOOLS.find((t) => t.name === name);
  if (!tool) return fail("unknown_tool", `There is no tool called ${name}.`);

  const parsed = z.object(tool.shape).safeParse(args ?? {});
  if (!parsed.success) {
    return fail(`invalid_input: ${formatIssues(parsed.error)}`, "Fix the listed fields (ask the person if needed) and call the tool again.");
  }
  try {
    return await tool.handler(parsed.data, deps);
  } catch (err) {
    log.error("tool failed", { tool: name, error: (err as Error).message });
    return fail("internal_error", "Something went wrong on our side. Apologise briefly and offer to connect them with an Application Specialist.");
  }
}

/**
 * Low-level MCP server (rather than McpServer) so we control validation errors and the JSON we return.
 * A fresh instance is created per HTTP request (stateless mode).
 */
export function buildMcpServer(deps: Deps): Server {
  const server = new Server({ name: "nexford-admissions", version: "1.0.0" }, { capabilities: { tools: {} } });

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: TOOLS.map((t) => {
      const { $schema: _s, ...inputSchema } = z.toJSONSchema(z.object(t.shape), { io: "input" }) as Record<string, unknown>;
      return { name: t.name, description: t.description, inputSchema: inputSchema as { type: "object" } };
    }),
  }));

  server.setRequestHandler(CallToolRequestSchema, async (req) =>
    asResult(await callTool(req.params.name, req.params.arguments, deps)),
  );

  return server;
}
