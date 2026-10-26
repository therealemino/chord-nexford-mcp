import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import type { AdminUser } from "../services/adminAuth.js";

export const SESSION_COOKIE = "nxu_dashboard";
export const SESSION_HOURS = 12;

/**
 * Dashboard sessions: a signed, expiring cookie holding the signed-in user ("<payload>.<hmac>"), so there's
 * nothing to store server-side. Passwords are checked by Supabase Auth at sign-in only.
 */
export function createSessions(serverSecret: string) {
  const key = createHash("sha256").update(`dashboard-session|${serverSecret}`).digest();
  const sign = (value: string) => createHmac("sha256", key).update(value).digest("base64url");

  return {
    issue(user: AdminUser, nowMs: number): string {
      const payload = Buffer.from(JSON.stringify({ ...user, exp: nowMs + SESSION_HOURS * 3_600_000 })).toString("base64url");
      return `${payload}.${sign(payload)}`;
    },
    verify(token: string | undefined, nowMs: number): AdminUser | null {
      const [payload, sig] = token?.split(".") ?? [];
      if (!payload || !sig) return null;
      const expected = Buffer.from(sign(payload));
      const given = Buffer.from(sig);
      if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
      try {
        const { id, email, exp } = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
        return typeof exp === "number" && exp > nowMs && id && email ? { id, email } : null;
      } catch {
        return null;
      }
    },
  };
}

export type Sessions = ReturnType<typeof createSessions>;

export function readCookie(header: string | undefined, name: string): string | undefined {
  for (const part of header?.split(";") ?? []) {
    const [k, ...v] = part.trim().split("=");
    if (k === name) return decodeURIComponent(v.join("="));
  }
  return undefined;
}

/** At most `max` failed logins per IP per window. In memory: resets on restart, which is fine for a prototype. */
export function createLoginLimiter(max = 10, windowMs = 15 * 60_000) {
  const failures = new Map<string, { count: number; resetAt: number }>();
  return {
    blocked(ip: string, nowMs: number): boolean {
      const f = failures.get(ip);
      return !!f && f.resetAt > nowMs && f.count >= max;
    },
    fail(ip: string, nowMs: number) {
      const f = failures.get(ip);
      if (!f || f.resetAt <= nowMs) failures.set(ip, { count: 1, resetAt: nowMs + windowMs });
      else f.count++;
    },
    reset(ip: string) {
      failures.delete(ip);
    },
  };
}
