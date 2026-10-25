import { NOTIFY_STRATEGIES, type NotifyStrategy } from "./config/chord.js";

export interface Env {
  PORT: number;
  MCP_BEARER_TOKEN: string;
  ADMIN_MCP_BEARER_TOKEN: string;
  SUPABASE_URL: string;
  SUPABASE_SERVICE_ROLE_KEY: string;
  PAYSTACK_SECRET_KEY: string;
  PUBLIC_BASE_URL: string;
  CHORD_NOTIFY_STRATEGY: NotifyStrategy;
  /** Present unless CHORD_NOTIFY_STRATEGY is "off". */
  chord: { apiKey: string; workspaceId: string; teammateId: string } | null;
  /** Handoff alert emails; null when Resend isn't fully configured (alerts are then skipped, not fatal). */
  email: { resendApiKey: string; from: string; to: string[] } | null;
  CHORD_DASHBOARD_THREAD_URL_TEMPLATE: string | null;
  /** Non-fatal configuration problems to log at startup. */
  warnings: string[];
}

const REQUIRED = [
  "PORT",
  "MCP_BEARER_TOKEN",
  "ADMIN_MCP_BEARER_TOKEN",
  "SUPABASE_URL",
  "SUPABASE_SERVICE_ROLE_KEY",
  "PAYSTACK_SECRET_KEY",
  "PUBLIC_BASE_URL",
] as const;
const CHORD_REQUIRED = ["CHORD_API_KEY", "CHORD_WORKSPACE_ID", "CHORD_TEAMMATE_ID"] as const;

/** Throws (so the process refuses to start) if anything is missing or Paystack is not in test mode. */
export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const v = (k: string) => source[k]?.trim() ?? "";

  const strategy = (v("CHORD_NOTIFY_STRATEGY") || "takeover") as NotifyStrategy;
  if (!NOTIFY_STRATEGIES.includes(strategy)) {
    throw new Error(`CHORD_NOTIFY_STRATEGY must be one of: ${NOTIFY_STRATEGIES.join(", ")}`);
  }

  const required = [...REQUIRED, ...(strategy === "off" ? [] : CHORD_REQUIRED)];
  const missing = required.filter((k) => !v(k));
  if (missing.length > 0) throw new Error(`Missing required environment variables: ${missing.join(", ")}`);

  if (!v("PAYSTACK_SECRET_KEY").startsWith("sk_test_")) {
    throw new Error("PAYSTACK_SECRET_KEY must be a Paystack TEST key (sk_test_...). This prototype never runs in live mode.");
  }
  if (v("ADMIN_MCP_BEARER_TOKEN") === v("MCP_BEARER_TOKEN")) {
    throw new Error("ADMIN_MCP_BEARER_TOKEN must be different from MCP_BEARER_TOKEN");
  }
  const warnings: string[] = [];
  const emailKeys = ["RESEND_API_KEY", "ALERT_EMAIL_FROM", "ALERT_EMAIL_TO"];
  const emailMissing = emailKeys.filter((k) => !v(k));
  if (emailMissing.length > 0) warnings.push(`Handoff alert emails are OFF (missing ${emailMissing.join(", ")})`);
  const to = v("ALERT_EMAIL_TO").split(",").map((a) => a.trim()).filter(Boolean);
  const template = v("CHORD_DASHBOARD_THREAD_URL_TEMPLATE") || null;
  if (template && !template.includes("{thread_id}")) throw new Error("CHORD_DASHBOARD_THREAD_URL_TEMPLATE must contain {thread_id}");

  const port = Number(v("PORT"));
  if (!Number.isInteger(port) || port <= 0) throw new Error("PORT must be a positive integer");

  return {
    PORT: port,
    MCP_BEARER_TOKEN: v("MCP_BEARER_TOKEN"),
    ADMIN_MCP_BEARER_TOKEN: v("ADMIN_MCP_BEARER_TOKEN"),
    SUPABASE_URL: v("SUPABASE_URL"),
    SUPABASE_SERVICE_ROLE_KEY: v("SUPABASE_SERVICE_ROLE_KEY"),
    PAYSTACK_SECRET_KEY: v("PAYSTACK_SECRET_KEY"),
    PUBLIC_BASE_URL: v("PUBLIC_BASE_URL").replace(/\/+$/, ""),
    CHORD_NOTIFY_STRATEGY: strategy,
    chord:
      strategy === "off"
        ? null
        : { apiKey: v("CHORD_API_KEY"), workspaceId: v("CHORD_WORKSPACE_ID"), teammateId: v("CHORD_TEAMMATE_ID") },
    email: emailMissing.length === 0 ? { resendApiKey: v("RESEND_API_KEY"), from: v("ALERT_EMAIL_FROM"), to } : null,
    CHORD_DASHBOARD_THREAD_URL_TEMPLATE: template,
    warnings,
  };
}
