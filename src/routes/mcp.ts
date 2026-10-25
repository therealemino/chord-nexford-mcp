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
