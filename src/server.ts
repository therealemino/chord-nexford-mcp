import "dotenv/config";
import { DateTime } from "luxon";
import { createApp } from "./app.js";
import { loadEnv } from "./env.js";
import { log } from "./lib/log.js";
import { createSupabaseAdminAuth } from "./services/adminAuth.js";
import { createChordClient } from "./services/chord.js";
import { createResendSender } from "./services/email.js";
import { createPaystackClient } from "./services/paystack.js";
import { createSupabaseRepo } from "./services/supabase.js";

let env;
try {
  env = loadEnv();
} catch (err) {
  console.error(`Refusing to start: ${(err as Error).message}`);
  process.exit(1);
}

const app = createApp(
  {
    repo: createSupabaseRepo(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY),
    paystack: createPaystackClient(env.PAYSTACK_SECRET_KEY),
    now: () => DateTime.utc(),
    publicBaseUrl: env.PUBLIC_BASE_URL,
    chord: env.chord && {
      client: createChordClient(env.chord.apiKey),
      workspaceId: env.chord.workspaceId,
      teammateId: env.chord.teammateId,
      strategy: env.CHORD_NOTIFY_STRATEGY,
    },
    alerts: {
      email: env.email && createResendSender(env.email.resendApiKey, env.email.from),
      to: env.email?.to ?? [],
      threadUrlTemplate: env.CHORD_DASHBOARD_THREAD_URL_TEMPLATE,
      threadLookupDelaysMs: [8_000, 15_000, 30_000],
    },
    runInBackground: (task) => {
      task().catch((err) => log.error("background task failed", { error: (err as Error).message }));
    },
  },
  { mcpBearerToken: env.MCP_BEARER_TOKEN, adminBearerToken: env.ADMIN_MCP_BEARER_TOKEN, paystackSecretKey: env.PAYSTACK_SECRET_KEY,
    dashboardAuth: createSupabaseAdminAuth(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY),
  },
);

for (const warning of env.warnings) log.warn(warning);

app.listen(env.PORT, () => log.info("server listening", { port: env.PORT, notify_strategy: env.CHORD_NOTIFY_STRATEGY }));
