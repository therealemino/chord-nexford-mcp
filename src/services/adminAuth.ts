import { createClient } from "@supabase/supabase-js";

export interface AdminUser {
  id: string;
  email: string;
}

/** Checks staff dashboard logins. */
export interface AdminAuth {
  /** The user if the email/password are right AND the user is an admin; otherwise null. */
  signIn(email: string, password: string): Promise<AdminUser | null>;
}

/** Role required in the Supabase user's app_metadata. Only the service role can set app_metadata. */
export const ADMIN_ROLE = "admin";

/**
 * Supabase Auth email/password sign-in. A fresh client per call, so no session is ever shared between requests.
 * Requiring app_metadata.role = "admin" matters: if public sign-ups are enabled on the project, anyone could
 * create an account, but they can't give themselves that role.
 */
export function createSupabaseAdminAuth(url: string, serviceRoleKey: string): AdminAuth {
  return {
    async signIn(email, password) {
      const client = createClient(url, serviceRoleKey, {
        auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
      });
      const { data, error } = await client.auth.signInWithPassword({ email: email.trim(), password });
      const user = data?.user;
      if (error || !user || user.app_metadata?.role !== ADMIN_ROLE) return null;
      return { id: user.id, email: user.email ?? email.trim() };
    },
  };
}
