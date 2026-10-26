/**
 * Calls every tool once against a running server, using the MCP client SDK.
 *   MCP_URL=https://<host>/mcp MCP_BEARER_TOKEN=... pnpm smoke
 * Defaults to PUBLIC_BASE_URL/mcp from .env. Writes a test lead (contact_id smoke_<timestamp>)
 * and creates a Paystack TEST transaction.
 */
import "dotenv/config";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

const url = process.env.MCP_URL || `${(process.env.PUBLIC_BASE_URL ?? "http://localhost:3000").replace(/\/+$/, "")}/mcp`;
const token = process.env.MCP_BEARER_TOKEN;
if (!token) {
  console.error("Set MCP_BEARER_TOKEN (and MCP_URL or PUBLIC_BASE_URL).");
  process.exit(1);
}

const contact_id = `smoke_${Date.now()}`;
const calls: [string, Record<string, unknown>][] = [
  ["save_lead", { contact_id, full_name: "Smoke Test", email: "smoke.test@example.com", whatsapp_number: "+2348030000099", country: "Nigeria" }],
  ["assess_eligibility", { contact_id, programme: "MBA", has_bachelors_degree: true, degree_field: "other", years_relevant_experience: 4 }],
  ["get_tuition", { programme: "MBA", country: "Nigeria" }],
  ["create_application_payment", { contact_id }],
  ["get_payment_status", { contact_id }],
  ["handoff_to_advisor", { contact_id, reason: "other", channel: "whatsapp", summary: "Smoke test handoff: Nigerian engineering graduate interested in the MBA." }],
];

const client = new Client({ name: "nexford-smoke", version: "1.0.0" });
await client.connect(new StreamableHTTPClientTransport(new URL(url), { requestInit: { headers: { Authorization: `Bearer ${token}` } } }));

const { tools } = await client.listTools();
console.log(`Connected to ${url}. Tools: ${tools.map((t) => t.name).join(", ")}\n`);

let failures = 0;
for (const [name, args] of calls) {
  const res = await client.callTool({ name, arguments: args });
  const text = (res.content as { type: string; text: string }[])[0]?.text ?? "";
  const out = JSON.parse(text) as { ok: boolean };
  if (!out.ok) failures++;
  console.log(`${out.ok ? "PASS" : "FAIL"} ${name}\n  ${text}\n`);
}

await client.close();
console.log(failures ? `${failures} tool call(s) returned ok:false` : "All tool calls returned ok:true");
process.exit(failures ? 1 : 0);
