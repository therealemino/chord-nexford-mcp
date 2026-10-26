import express, { Router, type RequestHandler, type Response } from "express";
import { DASHBOARD_SCRIPT } from "../dashboard/client.js";
import { createLoginLimiter, readCookie, SESSION_COOKIE, SESSION_HOURS, type Sessions } from "../dashboard/auth.js";
import { followUpsPage, leadsPage, loginPage, overviewPage } from "../dashboard/views.js";
import type { AdminAuth, AdminUser } from "../services/adminAuth.js";
import { DASHBOARD_PERIODS, followUps, leadRows, overview, type DashboardPeriod } from "../lib/dashboard.js";
import { log } from "../lib/log.js";
import type { Deps } from "../mcp/types.js";

/** Staff dashboard: login, overview, leads and follow-ups. Server-rendered HTML, no client-side scripts. */
export function dashboardRouter(deps: Deps, auth: AdminAuth, sessions: Sessions): Router {
  const router = Router();
  const limiter = createLoginLimiter();

  router.use((_req, res, next) => {
    res.set({
      "Cache-Control": "no-store",
      "X-Frame-Options": "DENY",
      "Referrer-Policy": "no-referrer",
      "Content-Security-Policy":
        "default-src 'none'; script-src 'self'; style-src 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'",
    });
    next();
  });
  router.use(express.urlencoded({ extended: false, limit: "10kb" }));

  const setSession = (res: Response, value: string, maxAgeMs: number, secure: boolean) =>
    res.cookie(SESSION_COOKIE, value, { httpOnly: true, sameSite: "lax", secure, path: "/dashboard", maxAge: maxAgeMs });

  // Table sorting, column toggles and the details pop-up. No data in it, so it's served without login.
  router.get("/assets/app.js", (_req, res) => {
    res.set("Cache-Control", "public, max-age=300").type("application/javascript").send(DASHBOARD_SCRIPT);
  });

  router.get("/login", (_req, res) => {
    res.type("html").send(loginPage());
  });

  router.post("/login", async (req, res) => {
    const ip = req.ip ?? "unknown";
    const now = Date.now();
    if (limiter.blocked(ip, now)) {
      res.status(429).type("html").send(loginPage("Too many attempts. Try again in 15 minutes."));
      return;
    }
    const { email, password } = (req.body ?? {}) as { email?: string; password?: string };
    let user: AdminUser | null = null;
    try {
      user = email && password ? await auth.signIn(String(email), String(password)) : null;
    } catch (err) {
      log.error("dashboard sign-in error", { error: (err as Error).message });
      res.status(503).type("html").send(loginPage("Sign-in is unavailable right now. Try again in a minute."));
      return;
    }
    if (!user) {
      limiter.fail(ip, now);
      log.warn("dashboard login failed");
      res.status(401).type("html").send(loginPage("That email and password don't match an admin account."));
      return;
    }
    limiter.reset(ip);
    log.info("dashboard login", { user_id: user.id });
    setSession(res, sessions.issue(user, now), SESSION_HOURS * 3_600_000, req.secure);
    res.redirect(303, "/dashboard");
  });

  router.post("/logout", (req, res) => {
    setSession(res, "", 0, req.secure);
    res.redirect(303, "/dashboard/login");
  });

  const requireLogin: RequestHandler = (req, res, next) => {
    const user = sessions.verify(readCookie(req.headers.cookie, SESSION_COOKIE), Date.now());
    if (!user) return res.redirect(303, "/dashboard/login");
    res.locals.user = user;
    next();
  };
  router.use(requireLogin);

  const load = async () => {
    const [leads, payments, handoffs] = await Promise.all([deps.repo.allLeads(), deps.repo.allPayments(), deps.repo.allHandoffs()]);
    return { leads, payments, handoffs };
  };

  router.get("/", async (req, res) => {
    const period = (DASHBOARD_PERIODS as readonly string[]).includes(String(req.query.period)) ? (req.query.period as DashboardPeriod) : "last_7_days";
    res.type("html").send(overviewPage(overview(await load(), period, deps.now()), res.locals.user.email));
  });

  router.get("/leads", async (req, res) => {
    const q = String(req.query.q ?? "").slice(0, 100);
    const status = String(req.query.status ?? "");
    res.type("html").send(leadsPage(leadRows(await load(), q, status), q, status, res.locals.user.email, deps.now()));
  });

  router.get("/follow-ups", async (_req, res) => {
    res.type("html").send(followUpsPage(followUps(await load(), deps.now()), res.locals.user.email, deps.now()));
  });

  return router;
}
