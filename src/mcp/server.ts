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
import { getLead } from "./admin/getLead.js";
import { getPipelineSummary } from "./admin/getPipelineSummary.js";
import { listPendingHandoffs } from "./admin/listPendingHandoffs.js";
import { updateHandoffStatus } from "./admin/updateHandoffStatus.js";
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

/** Internal tools for staff, served only on /mcp-admin. Must share nothing with TOOLS. */
export const ADMIN_TOOLS = [getPipelineSummary, listPendingHandoffs, updateHandoffStatus, getLead] as unknown as ToolDef[];

export interface Toolset {
  serverName: string;
  tools: ToolDef[];
  /** Appended to every agent_guidance (customer tools add WhatsApp formatting rules). */
  guidanceSuffix?: string;
}

export const CUSTOMER_TOOLSET: Toolset = { serverName: "nexford-admissions", tools: TOOLS, guidanceSuffix: WHATSAPP_FORMAT };
export const ADMIN_TOOLSET: Toolset = { serverName: "nexford-admissions-admin", tools: ADMIN_TOOLS };

const asResult = (out: ToolOutput): CallToolResult => ({ content: [{ type: "text", text: JSON.stringify(out) }] });

const formatIssues = (error: z.ZodError) =>
  error.issues.map((i) => `${i.path.join(".") || "input"}: ${i.message}`).join("; ");

/** Runs a tool by name with our own validation, so bad input becomes { ok: false, error } instead of a protocol error. */
export async function runToolset(set: Toolset, name: string, args: unknown, deps: Deps): Promise<ToolOutput> {
  const out = await runTool(set.tools, name, args, deps);
  return set.guidanceSuffix ? { ...out, agent_guidance: `${out.agent_guidance ?? ""} ${set.guidanceSuffix}`.trim() } : out;
}

export const callTool = (name: string, args: unknown, deps: Deps) => runToolset(CUSTOMER_TOOLSET, name, args, deps);
export const callAdminTool = (name: string, args: unknown, deps: Deps) => runToolset(ADMIN_TOOLSET, name, args, deps);

async function runTool(tools: ToolDef[], name: string, args: unknown, deps: Deps): Promise<ToolOutput> {
  const tool = tools.find((t) => t.name === name);
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
export function buildMcpServer(deps: Deps, set: Toolset = CUSTOMER_TOOLSET): Server {
  const server = new Server({ name: set.serverName, version: "1.0.0" }, { capabilities: { tools: {} } });

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: set.tools.map((t) => {
      const { $schema: _s, ...inputSchema } = z.toJSONSchema(z.object(t.shape), { io: "input" }) as Record<string, unknown>;
      return { name: t.name, description: t.description, inputSchema: inputSchema as { type: "object" } };
    }),
  }));

  server.setRequestHandler(CallToolRequestSchema, async (req) =>
    asResult(await runToolset(set, req.params.name, req.params.arguments, deps)),
  );

  return server;
}
