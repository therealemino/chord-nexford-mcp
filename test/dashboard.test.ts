import { DateTime } from "luxon";
import request from "supertest";
import { describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { createSessions } from "../src/dashboard/auth.js";
import type { AdminAuth } from "../src/services/adminAuth.js";
import { followUps, leadRows, overview } from "../src/lib/dashboard.js";
import type { Handoff, Lead, Payment } from "../src/services/types.js";
import { makeDeps } from "./helpers/fakes.js";

const CREDS = { email: "admin@example.com", password: "correct-horse" };
/** Stands in for Supabase Auth: one admin, plus a valid non-admin account that must be refused. */
const fakeAuth: AdminAuth = {
  async signIn(email, password) {
    if (email.trim().toLowerCase() === CREDS.email && password === CREDS.password) return { id: "u1", email: CREDS.email };
    return null; // wrong password, unknown user, or a user without the admin role
  },
};
const appWith = (deps = makeDeps().deps, dashboardAuth: AdminAuth | null = fakeAuth) =>
  createApp(deps, { mcpBearerToken: "t", adminBearerToken: "a", paystackSecretKey: "sk_test_x", dashboardAuth });

async function signedIn(app = appWith()) {
  const res = await request(app).post("/dashboard/login").type("form").send(CREDS);
  return { app, cookie: res.headers["set-cookie"][0].split(";")[0] };
}

describe("dashboard login", () => {
  it("redirects to the login page when signed out", async () => {
    const res = await request(appWith()).get("/dashboard");
    expect(res.status).toBe(303);
    expect(res.headers.location).toBe("/dashboard/login");
    expect((await request(appWith()).get("/dashboard/login")).text).toContain('type="password"');
  });

  it("rejects a wrong password and accepts an admin (email is case-insensitive)", async () => {
    const app = appWith();
    const bad = await request(app).post("/dashboard/login").type("form").send({ ...CREDS, password: "nope" });
    expect(bad.status).toBe(401);
    expect(bad.headers["set-cookie"]).toBeUndefined();

    const good = await request(app).post("/dashboard/login").type("form").send({ ...CREDS, email: " ADMIN@example.com " });
    expect(good.status).toBe(303);
    expect(good.headers["set-cookie"][0]).toMatch(/^nxu_dashboard=.+HttpOnly/);
    expect(good.headers["set-cookie"][0]).toMatch(/SameSite=Lax/);
  });

  it("shows a friendly error if Supabase Auth is down", async () => {
    const app = appWith(undefined, { signIn: async () => { throw new Error("network"); } });
    const res = await request(app).post("/dashboard/login").type("form").send(CREDS);
    expect(res.status).toBe(503);
    expect(res.text).toContain("Sign-in is unavailable");
  });

  it("a session opens every page and shows who is signed in; a tampered one doesn't", async () => {
    const { app, cookie } = await signedIn();
    for (const path of ["/dashboard", "/dashboard/leads", "/dashboard/follow-ups"]) {
      const res = await request(app).get(path).set("cookie", cookie);
      expect(res.status, path).toBe(200);
      expect(res.text).toContain("admin@example.com");
      expect(res.headers["content-security-policy"]).toContain("script-src 'self'");
      expect(res.headers["cache-control"]).toBe("no-store");
    }
    const [payload, sig] = cookie.split("=")[1].split(".");
    const forged = Buffer.from(JSON.stringify({ id: "x", email: "evil@example.com", exp: Date.now() + 1e9 })).toString("base64url");
    expect((await request(app).get("/dashboard").set("cookie", `nxu_dashboard=${forged}.${sig}`)).status).toBe(303);
    expect((await request(app).get("/dashboard").set("cookie", `nxu_dashboard=${payload}.x${sig}`)).status).toBe(303);
  });

  it("sessions expire after 12 hours and don't survive a new server secret", () => {
    const s = createSessions("secret");
    const token = s.issue({ id: "u1", email: "a@b.c" }, 0);
    expect(s.verify(token, 11 * 3_600_000)).toEqual({ id: "u1", email: "a@b.c" });
    expect(s.verify(token, 13 * 3_600_000)).toBeNull();
    expect(createSessions("other-secret").verify(token, 1000)).toBeNull();
    expect(s.verify("garbage", 0)).toBeNull();
    expect(s.verify(undefined, 0)).toBeNull();
  });

  it("locks out after 10 failed attempts", async () => {
    const app = appWith();
    for (let i = 0; i < 10; i++) await request(app).post("/dashboard/login").type("form").send({ ...CREDS, password: "x" });
    const res = await request(app).post("/dashboard/login").type("form").send(CREDS);
    expect(res.status).toBe(429);
  });

  it("sign out clears the cookie", async () => {
    const { app, cookie } = await signedIn();
    const res = await request(app).post("/dashboard/logout").set("cookie", cookie);
    expect(res.headers.location).toBe("/dashboard/login");
    expect(res.headers["set-cookie"][0]).toMatch(/^nxu_dashboard=;/);
  });

  it("is off (404) without an auth provider", async () => {
    expect((await request(appWith(undefined, null)).get("/dashboard/login")).status).toBe(404);
  });

  it("serves the table script without login", async () => {
    const res = await request(appWith()).get("/dashboard/assets/app.js");
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toMatch(/javascript/);
    expect(res.text).toContain("showModal");
  });
});

// ─── Metrics ─────────────────────────────────────────────────────────────────

const NOW = DateTime.fromISO("2026-10-26T12:00:00Z");
let n = 0;
const lead = (over: Partial<Lead>): Lead =>
  ({ id: `l${++n}`, contact_id: `c${n}`, full_name: null, email: null, country: "Nigeria", programme: "MBA", eligibility_result: null, status: "enquiring", created_at: "2026-10-25T10:00:00Z", ...over }) as Lead;
const payment = (lead_id: string, over: Partial<Payment>): Payment =>
  ({ id: `p${++n}`, lead_id, paystack_reference: `ref${n}`, status: "pending", amount_kobo: 3_321_700, paid_at: null, created_at: "2026-10-25T11:00:00Z", ...over }) as Payment;
const handoff = (lead_id: string, over: Partial<Handoff>): Handoff =>
  ({ id: `h${++n}`, lead_id, reason: "requested_by_user", channel: "call", status: "pending", callback_time: null, callback_number: "+234", summary: "s", alert_error: null, alert_emailed_at: null, chord_flag_error: null, created_at: "2026-10-25T10:30:00Z", ...over }) as Handoff;

function sample() {
  const a = lead({ full_name: "Ada", programme: "MBA", eligibility_result: "foundation_likely" });
  const b = lead({ full_name: "Bola", programme: "MBA", eligibility_result: "direct_entry" });
  const c = lead({ full_name: "Chidi", programme: "BBA", country: "Ghana", eligibility_result: "advisor_review" });
  const d = lead({ full_name: "Old Lead", created_at: "2026-09-01T10:00:00Z" });
  return {
    leads: [a, b, c, d],
    payments: [
      payment(a.id, { status: "success", paid_at: "2026-10-25T11:20:00Z" }), // 20 min after link, after a callback
      payment(b.id, { status: "pending" }), // abandoned link, then paid with a new one 2 days later
      payment(b.id, { status: "success", created_at: "2026-10-25T12:00:00Z", paid_at: "2026-10-25T15:00:00Z" }),
      payment(c.id, { status: "pending" }),
      payment(d.id, { status: "success", created_at: "2026-09-01T11:00:00Z", paid_at: "2026-10-26T09:00:00Z" }), // old lead, paid today
    ],
    handoffs: [
      handoff(a.id, { created_at: "2026-10-25T10:30:00Z" }),
      handoff(c.id, { callback_time: "2026-10-26T10:00:00Z" }), // overdue
      handoff(a.id, { reason: "new_applicant", channel: "whatsapp", created_at: "2026-10-25T11:21:00Z" }),
    ],
  };
}

describe("overview metrics", () => {
  it("funnel, conversion and fees for the last 7 days", () => {
    const o = overview(sample(), "last_7_days", NOW);
    expect(o.new_leads).toBe(3);
    expect(o.funnel.map((f) => f.count)).toEqual([3, 3, 3, 2]);
    expect(o.paid_from_new_leads).toBe(2);
    expect(o.conversion).toBe(67);
    expect(o.payments_received).toBe(3); // includes the old lead who paid today
    expect(o.fees_usd).toBe(75);
    expect(o.fees_ngn).toBe(99_651);
  });

  it("splits payments into after-a-person vs AI only, and now vs later", () => {
    const o = overview(sample(), "last_7_days", NOW);
    expect(o.paid_after_human).toBe(1); // Ada had a callback before paying; the new_applicant handoff doesn't count
    expect(o.paid_ai_only).toBe(2);
    expect(o.paid_within_hour_of_link).toBe(1);
    expect(o.paid_later).toBe(2);
  });

  it("breaks down by programme and country, and counts follow-up work", () => {
    const o = overview(sample(), "last_7_days", NOW);
    expect(o.by_programme).toEqual([
      { name: "MBA", leads: 2, paid: 2, conversion: 100 },
      { name: "BBA", leads: 1, paid: 0, conversion: 0 },
    ]);
    expect(o.by_country[0]).toMatchObject({ name: "Nigeria", leads: 2 });
    expect(o.eligibility).toEqual({ direct_entry: 1, foundation_likely: 1, advisor_review: 1, not_eligible: 0 });
    expect(o).toMatchObject({ handoffs_pending: 3, callbacks_overdue: 1, unpaid_links: 1 });
  });

  it("'today' only counts today's leads but every payment received today", () => {
    const o = overview(sample(), "today", NOW);
    expect(o.new_leads).toBe(0);
    expect(o.conversion).toBeNull();
    expect(o.payments_received).toBe(1);
  });
});

describe("leads and follow-ups", () => {
  it("searches by name, email, programme or country and filters by status", () => {
    const data = sample();
    expect(leadRows(data, "ghana", "").map((r) => r.lead.full_name)).toEqual(["Chidi"]);
    expect(leadRows(data, "", "enquiring")).toHaveLength(4);
    expect(leadRows(data, "", "paid")).toHaveLength(0);
    expect(leadRows(data, "ada", "")[0].payment?.status).toBe("success");
  });

  it("lists unpaid links and open handoffs, overdue first", () => {
    const f = followUps(sample(), NOW);
    expect(f.unpaid.map((u) => u.lead?.full_name)).toEqual(["Chidi"]);
    expect(f.open[0]).toMatchObject({ overdue: true, lead: { full_name: "Chidi" } });
  });

  it("keeps the summary out of the follow-ups table and puts it in the View details", async () => {
    const ctx = makeDeps();
    const l = lead({ full_name: "Ada", created_at: new Date().toISOString() });
    ctx.db.leads.push(l);
    ctx.db.handoffs.push(handoff(l.id, { summary: "Wants to discuss scholarships and the FND 5100 waiver in detail." }));
    const { app, cookie } = await signedIn(appWith(ctx.deps));
    const html = (await request(app).get("/dashboard/follow-ups").set("cookie", cookie)).text;
    const table = html.slice(html.indexOf('data-table="handoffs"'), html.indexOf("</table>", html.indexOf('data-table="handoffs"')));
    expect(table).not.toContain("FND 5100 waiver");
    expect(table).toContain('data-detail="handoff-0"');
    expect(html).toMatch(/<template id="handoff-0">[\s\S]*FND 5100 waiver[\s\S]*<\/template>/);
  });

  it("escapes applicant data in the pages", async () => {
    const ctx = makeDeps();
    ctx.db.leads.push(lead({ full_name: '<script>alert("x")</script>', created_at: new Date().toISOString() }));
    const { app, cookie } = await signedIn(appWith(ctx.deps));
    const res = await request(app).get("/dashboard/leads").set("cookie", cookie);
    expect(res.text).not.toContain("<script>alert");
    expect(res.text).toContain("&lt;script&gt;");
  });
});
