/**
 * Creates (or updates) a staff dashboard user in Supabase Auth, marked as admin.
 *   pnpm dashboard:user --email admin@example.com --password '<password>'
 * Safe to rerun: an existing user gets the new password and the admin role.
 */
import "dotenv/config";
import { parseArgs } from "node:util";
import { createClient } from "@supabase/supabase-js";
import { ADMIN_ROLE } from "../src/services/adminAuth.js";

const { values } = parseArgs({ options: { email: { type: "string" }, password: { type: "string" } } });
const email = values.email?.trim().toLowerCase();
const password = values.password;
if (!email || !password || password.length < 8) {
  console.error("Usage: pnpm dashboard:user --email <email> --password <at least 8 characters>");
  process.exit(1);
}
if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
  console.error("Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env.");
  process.exit(1);
}

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

let existing: { id: string } | undefined;
for (let page = 1; !existing; page++) {
  const { data, error } = await supabase.auth.admin.listUsers({ page, perPage: 1000 });
  if (error) throw error;
  existing = data.users.find((u) => u.email?.toLowerCase() === email);
  if (data.users.length < 1000) break;
}

const attrs = { password, email_confirm: true, app_metadata: { role: ADMIN_ROLE } };
const { data, error } = existing
  ? await supabase.auth.admin.updateUserById(existing.id, attrs)
  : await supabase.auth.admin.createUser({ email, ...attrs });
if (error) {
  console.error(`Failed: ${error.message}`);
  process.exit(1);
}
console.log(`${existing ? "Updated" : "Created"} dashboard admin ${data.user.email} (${data.user.id}).`);
