import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { Router, type RequestHandler } from "express";
import { isValidBearer } from "../lib/auth.js";
import { log } from "../lib/log.js";
import { buildMcpServer } from "../mcp/server.js";
import type { Deps } from "../mcp/types.js";

export function mcpRouter(deps: Deps, bearerToken: string): Router {
  const router = Router();

  const requireBearer: RequestHandler = (req, res, next) => {
    if (!isValidBearer(req.headers.authorization, bearerToken)) {
      res.status(401).json({ jsonrpc: "2.0", error: { code: -32001, message: "Unauthorized" }, id: null });
      return;
    }
    next();
  };

  router.use(requireBearer);

  router.post("/", async (req, res) => {
    if (process.env.LOG_MCP_CONTEXT === "1") logToolCallContext(req.headers, req.body);
    // Stateless: new server + transport per request, no session ids.
    const server = buildMcpServer(deps);
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
    res.on("close", () => {
      void transport.close();
      void server.close();
    });
    try {
      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);
    } catch (err) {
      log.error("mcp request failed", { error: (err as Error).message });
      if (!res.headersSent) res.status(500).json({ jsonrpc: "2.0", error: { code: -32603, message: "Internal error" }, id: null });
    }
  });

  const notAllowed: RequestHandler = (_req, res) => {
    res.status(405).set("Allow", "POST").json({ jsonrpc: "2.0", error: { code: -32000, message: "Method not allowed (stateless server)" }, id: null });
  };
  router.get("/", notAllowed);
  router.delete("/", notAllowed);

  return router;
}

const HIDDEN_HEADERS = new Set(["authorization", "cookie", "x-forwarded-for", "x-real-ip", "cf-connecting-ip", "true-client-ip"]);

/**
 * Temporary discovery aid (LOG_MCP_CONTEXT=1): shows what Chord sends with a tool call, to find a thread
 * identifier we can link to contact_id. Logs headers (minus credentials and IPs), _meta and contact_id only.
 */
function logToolCallContext(headers: Record<string, unknown>, body: unknown) {
  const msg = body as { method?: string; params?: { name?: string; _meta?: unknown; arguments?: { contact_id?: unknown } } };
  if (msg?.method !== "tools/call") return;
  log.info("mcp tool call context", {
    tool: msg.params?.name,
    contact_id: String(msg.params?.arguments?.contact_id ?? ""),
    meta: JSON.stringify(msg.params?._meta ?? null),
    headers: JSON.stringify(Object.fromEntries(Object.entries(headers).filter(([k]) => !HIDDEN_HEADERS.has(k)))),
  });
}
