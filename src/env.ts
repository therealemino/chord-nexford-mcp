export interface Env {
  PORT: number;
  MCP_BEARER_TOKEN: string;
  SUPABASE_URL: string;
  SUPABASE_SERVICE_ROLE_KEY: string;
  PAYSTACK_SECRET_KEY: string;
  PUBLIC_BASE_URL: string;
}

const REQUIRED = [
  "PORT",
  "MCP_BEARER_TOKEN",
  "SUPABASE_URL",
  "SUPABASE_SERVICE_ROLE_KEY",
  "PAYSTACK_SECRET_KEY",
  "PUBLIC_BASE_URL",
] as const;

/** Throws (so the process refuses to start) if anything is missing or Paystack is not in test mode. */
export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const missing = REQUIRED.filter((k) => !source[k]?.trim());
  if (missing.length > 0) throw new Error(`Missing required environment variables: ${missing.join(", ")}`);

  const v = (k: (typeof REQUIRED)[number]) => source[k]!.trim();
  if (!v("PAYSTACK_SECRET_KEY").startsWith("sk_test_")) {
    throw new Error("PAYSTACK_SECRET_KEY must be a Paystack TEST key (sk_test_...). This prototype never runs in live mode.");
  }
  const port = Number(v("PORT"));
  if (!Number.isInteger(port) || port <= 0) throw new Error("PORT must be a positive integer");

  return {
    PORT: port,
    MCP_BEARER_TOKEN: v("MCP_BEARER_TOKEN"),
    SUPABASE_URL: v("SUPABASE_URL"),
    SUPABASE_SERVICE_ROLE_KEY: v("SUPABASE_SERVICE_ROLE_KEY"),
    PAYSTACK_SECRET_KEY: v("PAYSTACK_SECRET_KEY"),
    PUBLIC_BASE_URL: v("PUBLIC_BASE_URL").replace(/\/+$/, ""),
  };
}
