import { DateTime } from "luxon";
import { formatLocal } from "../config/fx.js";
import { SPECIALIST_ZONE } from "../config/hours.js";
import { formatForApplicant } from "../lib/hours.js";
import { DASHBOARD_PERIODS, humanDuration, PERIOD_LABELS, type DashboardPeriod, type Overview, type followUps, type leadRows } from "../lib/dashboard.js";
import { isOverdue } from "../lib/pipeline.js";
import type { Handoff, Lead, Payment } from "../services/types.js";

const esc = (v: unknown) =>
  String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
const lagos = (iso: string | null) => (iso ? formatForApplicant(DateTime.fromISO(iso)).replace(" (Lagos time)", "") : "–");
const pct = (v: number | null) => (v === null ? "–" : `${v}%`);

const STYLES = `
:root{--bg:#f6f7f9;--card:#fff;--text:#16191d;--muted:#5d6672;--line:#e3e6ea;--accent:#2f6fde;--accent-soft:#dfe9fb;--good:#1f8a4c;--good-soft:#dcf1e4;--warn:#b5530b;--warn-soft:#fbe9d9;--bad:#c62f2f;--bad-soft:#f9dede}
@media (prefers-color-scheme:dark){:root:not([data-theme="light"]){--bg:#111317;--card:#1a1d22;--text:#e8eaed;--muted:#9aa3ad;--line:#2b2f36;--accent:#6c9cf0;--accent-soft:#1f2c44;--good:#55c286;--good-soft:#173324;--warn:#e69a52;--warn-soft:#3a2a1a;--bad:#ef7373;--bad-soft:#3d1f1f}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--text);font:15px/1.5 system-ui,-apple-system,"Segoe UI",sans-serif}
a{color:var(--accent);text-decoration:none}a:hover{text-decoration:underline}
header{background:var(--card);border-bottom:1px solid var(--line)}
.bar{max-width:1120px;margin:0 auto;padding:12px 16px;display:flex;gap:16px;align-items:center;flex-wrap:wrap}
.brand{font-weight:650;margin-right:auto}nav{display:flex;gap:4px;flex-wrap:wrap}
nav a{padding:6px 12px;border-radius:8px;color:var(--muted)}nav a.on{background:var(--accent-soft);color:var(--accent);font-weight:600}
main{max-width:1120px;margin:0 auto;padding:20px 16px 48px}h1{font-size:22px;margin:0 0 4px}h2{font-size:16px;margin:0 0 12px}
.sub{color:var(--muted);margin:0 0 20px}
.grid{display:grid;gap:12px;grid-template-columns:repeat(auto-fit,minmax(min(170px,100%),1fr));margin-bottom:16px}
.two{display:grid;gap:16px;grid-template-columns:repeat(auto-fit,minmax(min(320px,100%),1fr));margin-bottom:16px}
.card{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:16px;min-width:0}
.kpi .label{color:var(--muted);font-size:13px}.kpi .value{font-size:28px;font-weight:650;line-height:1.2;margin-top:4px}.kpi .hint{color:var(--muted);font-size:12px;margin-top:4px}
.tabs{display:flex;gap:6px;flex-wrap:wrap;margin-bottom:16px}.tabs a{padding:6px 12px;border:1px solid var(--line);border-radius:999px;background:var(--card);color:var(--text);font-size:14px}.tabs a.on{border-color:var(--accent);color:var(--accent);font-weight:600}
.funnel .row{display:grid;grid-template-columns:140px 1fr 90px;gap:10px;align-items:center;margin:8px 0;font-size:14px}
.track{background:var(--bg);border-radius:6px;height:22px;overflow:hidden}.fill{background:var(--accent);height:100%;border-radius:6px}
.num{text-align:right;font-variant-numeric:tabular-nums}.muted{color:var(--muted)}
.scroll{overflow-x:auto}table{width:100%;border-collapse:collapse;font-size:14px}th,td{text-align:left;padding:8px 10px;border-bottom:1px solid var(--line);white-space:nowrap}th{color:var(--muted);font-weight:600;font-size:12px;text-transform:uppercase;letter-spacing:.03em}td.wrap{white-space:normal;min-width:240px}
.pill{display:inline-block;padding:1px 8px;border-radius:999px;font-size:12px;font-weight:600;background:var(--bg);color:var(--muted)}
.pill.good{background:var(--good-soft);color:var(--good)}.pill.warn{background:var(--warn-soft);color:var(--warn)}.pill.bad{background:var(--bad-soft);color:var(--bad)}.pill.info{background:var(--accent-soft);color:var(--accent)}
form.filters{display:flex;gap:8px;flex-wrap:wrap;margin-bottom:12px}
input,select,button{font:inherit;padding:8px 10px;border:1px solid var(--line);border-radius:8px;background:var(--card);color:var(--text)}
button{background:var(--accent);border-color:var(--accent);color:#fff;font-weight:600;cursor:pointer}button.link{background:none;border:none;color:var(--muted);padding:6px 8px;font-weight:400}
.legend{display:flex;gap:16px;font-size:13px;color:var(--muted);margin-top:8px}.dot{display:inline-block;width:10px;height:10px;border-radius:3px;margin-right:6px;vertical-align:-1px}
.login{max-width:360px;margin:12vh auto;padding:0 16px}.login .card{padding:24px}.login label{display:block;font-size:13px;color:var(--muted);margin:12px 0 4px}.login input{width:100%}.login button{width:100%;margin-top:16px}
.error{background:var(--bad-soft);color:var(--bad);padding:8px 12px;border-radius:8px;font-size:14px;margin-top:12px}
.note{font-size:12px;color:var(--muted);margin-top:24px}
.sr{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0)}
[hidden]{display:none!important}.who{color:var(--muted);font-size:13px}
.toolbar{display:flex;gap:8px;flex-wrap:wrap;align-items:center;justify-content:space-between;margin-bottom:12px}.toolbar h2{margin:0}
th.sortable{cursor:pointer;user-select:none}th.sortable:hover{color:var(--text)}th.sortable::after{content:"↕";opacity:.35;margin-left:4px;font-size:11px}
th[aria-sort=ascending]::after{content:"↑";opacity:1}th[aria-sort=descending]::after{content:"↓";opacity:1}
td.act{text-align:right;width:1%}td.act,th[data-col=view]{position:sticky;right:0;background:var(--card);box-shadow:-10px 0 10px -10px rgba(0,0,0,.35)}button.view{background:var(--card);color:var(--accent);border:1px solid var(--line);padding:4px 10px;font-size:13px;font-weight:600}button.view:hover{border-color:var(--accent)}
details.columns{position:relative}details.columns summary{list-style:none;cursor:pointer;padding:7px 12px;border:1px solid var(--line);border-radius:8px;background:var(--card);font-size:14px}details.columns summary::-webkit-details-marker{display:none}details.columns summary::before{content:"☰ ";color:var(--muted)}
details.columns .menu{position:absolute;right:0;top:calc(100% + 6px);z-index:5;background:var(--card);border:1px solid var(--line);border-radius:10px;padding:8px;min-width:200px;box-shadow:0 8px 24px rgba(0,0,0,.18)}
details.columns label{display:flex;gap:8px;align-items:center;padding:6px 8px;border-radius:6px;font-size:14px;cursor:pointer}details.columns label:hover{background:var(--bg)}details.columns input{padding:0}
dialog{border:1px solid var(--line);border-radius:14px;background:var(--card);color:var(--text);padding:0;width:min(640px,calc(100vw - 32px));max-height:calc(100vh - 48px)}dialog::backdrop{background:rgba(10,12,16,.55)}
.dialog-head{display:flex;justify-content:space-between;align-items:center;gap:12px;padding:14px 18px;border-bottom:1px solid var(--line);position:sticky;top:0;background:var(--card)}.dialog-title{font-size:17px;margin:0}
.dialog-close{background:none;border:none;color:var(--muted);font-size:22px;line-height:1;padding:2px 6px}.dialog-body{padding:6px 18px 18px;overflow:auto}
.dialog-body h3{font-size:12px;text-transform:uppercase;letter-spacing:.04em;color:var(--muted);margin:18px 0 8px}
dl.kv{display:grid;grid-template-columns:minmax(120px,38%) 1fr;gap:6px 14px;margin:0;font-size:14px}dl.kv dt{color:var(--muted)}dl.kv dd{margin:0;overflow-wrap:anywhere}
.prose{white-space:pre-wrap;font-size:14px;background:var(--bg);border-radius:8px;padding:10px 12px;margin:0}
.item{border:1px solid var(--line);border-radius:10px;padding:10px 12px;margin-bottom:8px}
@media (max-width:560px){.funnel .row{grid-template-columns:96px 1fr 76px;font-size:13px}.kpi .value{font-size:24px}.grid{grid-template-columns:1fr 1fr}.brand{width:100%}}
`;

function page(title: string, body: string, active?: "overview" | "leads" | "follow-ups", user?: string): string {
  const link = (href: string, key: string, text: string) => `<a href="${href}"${active === key ? ' class="on"' : ""}>${text}</a>`;
  const nav = active
    ? `<header><div class="bar"><span class="brand">Nexford Admissions</span><nav>${link("/dashboard", "overview", "Overview")}${link("/dashboard/leads", "leads", "Leads")}${link("/dashboard/follow-ups", "follow-ups", "Follow-ups")}</nav>${user ? `<span class="who">${esc(user)}</span>` : ""}<form method="post" action="/dashboard/logout"><button class="link">Sign out</button></form></div></header>`
    : "";
  const extras = active
    ? `<dialog id="detail-dialog" aria-labelledby="detail-title"><div class="dialog-head"><h2 class="dialog-title" id="detail-title">Details</h2><button type="button" class="dialog-close" aria-label="Close">×</button></div><div class="dialog-body"></div></dialog><script src="/dashboard/assets/app.js" defer></script>`
    : "";
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex"><title>${esc(title)} · Nexford Admissions</title><style>${STYLES}</style></head><body>${nav}${body}${extras}</body></html>`;
}

export function loginPage(error?: string): string {
  return page(
    "Sign in",
    `<main class="login"><div class="card"><h1>Nexford Admissions</h1><p class="sub" style="margin:0">Sign in to the admissions dashboard.</p>
<form method="post" action="/dashboard/login"><label for="email">Email</label><input id="email" name="email" type="email" autocomplete="username" required autofocus>
<label for="password">Password</label><input id="password" name="password" type="password" autocomplete="current-password" required>
${error ? `<div class="error">${esc(error)}</div>` : ""}<button type="submit">Sign in</button></form></div>
<p class="note">Prototype on mock data. Not affiliated with Nexford University.</p></main>`,
  );
}

const kpi = (label: string, value: string, hint = "") =>
  `<div class="card kpi"><div class="label">${esc(label)}</div><div class="value">${esc(value)}</div>${hint ? `<div class="hint">${esc(hint)}</div>` : ""}</div>`;

function dailyChart(daily: Overview["daily"]): string {
  const max = Math.max(1, ...daily.flatMap((d) => [d.leads, d.paid]));
  const w = 640, h = 180, pad = 24, slot = (w - pad) / daily.length, bw = Math.max(3, Math.min(14, slot / 3));
  const y = (v: number) => h - pad - (v / max) * (h - pad * 2);
  const bars = daily
    .map((d, i) => {
      const x = pad + i * slot + slot / 2;
      const label = daily.length <= 14 ? `<text x="${x}" y="${h - 6}" text-anchor="middle" font-size="10" fill="var(--muted)">${esc(d.day)}</text>` : "";
      return `<rect x="${x - bw - 1}" y="${y(d.leads)}" width="${bw}" height="${h - pad - y(d.leads)}" rx="2" fill="var(--accent)"><title>${esc(d.day)}: ${d.leads} leads</title></rect>
<rect x="${x + 1}" y="${y(d.paid)}" width="${bw}" height="${h - pad - y(d.paid)}" rx="2" fill="var(--good)"><title>${esc(d.day)}: ${d.paid} paid</title></rect>${label}`;
    })
    .join("");
  return `<svg viewBox="0 0 ${w} ${h}" width="100%" role="img" aria-label="New leads and payments per day"><line x1="${pad}" x2="${w}" y1="${h - pad}" y2="${h - pad}" stroke="var(--line)"/><text x="0" y="${y(max) + 4}" font-size="10" fill="var(--muted)">${max}</text>${bars}</svg>
<div class="legend"><span><span class="dot" style="background:var(--accent)"></span>New leads</span><span><span class="dot" style="background:var(--good)"></span>Paid</span></div>`;
}

function breakdown(title: string, rows: Overview["by_programme"]): string {
  const body = rows.length
    ? rows.slice(0, 10).map((r) => `<tr><td>${esc(r.name)}</td><td class="num">${r.leads}</td><td class="num">${r.paid}</td><td class="num">${pct(r.conversion)}</td></tr>`).join("")
    : `<tr><td colspan="4" class="muted">No leads in this period.</td></tr>`;
  return `<div class="card"><h2>${esc(title)}</h2><div class="scroll"><table><thead><tr><th>${esc(title.replace("By ", ""))}</th><th class="num">Leads</th><th class="num">Paid</th><th class="num">Conv.</th></tr></thead><tbody>${body}</tbody></table></div></div>`;
}

export function overviewPage(o: Overview, user?: string): string {
  const tabs = DASHBOARD_PERIODS.map((p: DashboardPeriod) => `<a href="/dashboard?period=${p}"${p === o.period ? ' class="on"' : ""}>${PERIOD_LABELS[p]}</a>`).join("");
  const top = o.funnel[0].count || 1;
  const funnel = o.funnel
    .map((f, i) => {
      const prev = i === 0 ? null : o.funnel[i - 1].count;
      const rate = prev ? `${Math.round((f.count / prev) * 100)}%` : "";
      return `<div class="row"><span>${esc(f.step)}</span><div class="track"><div class="fill" style="width:${Math.max(f.count ? 2 : 0, (f.count / top) * 100)}%"></div></div><span class="num">${f.count}${rate ? ` <span class="muted">· ${rate}</span>` : ""}</span></div>`;
    })
    .join("");
  const paidTotal = o.paid_after_human + o.paid_ai_only;
  const e = o.eligibility;

  return page(
    "Overview",
    `<main><h1>Overview</h1><p class="sub">${esc(o.label)}</p><nav class="tabs">${tabs}</nav>
<div class="grid">
${kpi("New leads", String(o.new_leads), "people who messaged for the first time")}
${kpi("Paid", String(o.paid_from_new_leads), "of those new leads, paid the fee so far")}
${kpi("Conversion", pct(o.conversion), "paid ÷ new leads")}
${kpi("Fees received", formatLocal(o.fees_ngn, "NGN"), `${o.payments_received} payment${o.payments_received === 1 ? "" : "s"} in this period · $${o.fees_usd.toLocaleString("en-US")}`)}
</div>
<div class="two">
<div class="card funnel"><h2>Funnel</h2>${funnel}<p class="muted" style="font-size:12px;margin:8px 0 0">New leads in this period, followed to today. Percentages are of the step above.</p></div>
<div class="card"><h2>New leads and payments per day</h2>${dailyChart(o.daily)}</div>
</div>
<div class="grid">
${kpi("Paid after talking to a person", String(o.paid_after_human), paidTotal ? `${Math.round((o.paid_after_human / paidTotal) * 100)}% of payments in this period` : "a callback or chat with a specialist before paying")}
${kpi("Paid with the AI only", String(o.paid_ai_only), "no specialist before paying")}
${kpi("Time to pay", o.median_time_to_pay, "median, first message to payment")}
${kpi("Paid straight away", `${o.paid_within_hour_of_link} / ${o.paid_later}`, "within an hour of the link / later")}
</div>
<div class="two">${breakdown("By programme", o.by_programme)}${breakdown("By country", o.by_country)}</div>
<div class="grid">
${kpi("Direct entry", String(e.direct_entry), "likely no foundation course")}
${kpi("Foundation likely", String(e.foundation_likely), "likely need a foundation course")}
${kpi("Specialist review", String(e.advisor_review), "no published rule for the programme")}
${kpi("Not eligible", String(e.not_eligible), "master's without a bachelor's")}
</div>
<div class="grid">
${kpi("Unpaid payment links", String(o.unpaid_links), "all time")}
${kpi("Handoffs waiting", String(o.handoffs_pending), "all time")}
${kpi("Overdue callbacks", String(o.callbacks_overdue), "agreed time has passed")}
${kpi("Failed alerts", String(o.alerts_failed), "team may not have been told")}
</div>
<p class="note">Prototype on mock data with Paystack in test mode. Not affiliated with Nexford University. Times in Lagos time.</p></main>`,
    "overview",
    user,
  );
}

const STATUSES = ["enquiring", "qualified", "applied", "paid", "handed_off"];
const paymentPill = (status: string | undefined) =>
  !status ? '<span class="muted">–</span>'
    : `<span class="pill ${{ success: "good", pending: "warn", failed: "bad", abandoned: "bad" }[status] ?? ""}">${esc(status === "success" ? "paid" : status)}</span>`;
const statusPill = (s: string) => `<span class="pill ${{ paid: "good", applied: "info", handed_off: "warn" }[s] ?? ""}">${esc(s.replace("_", " "))}</span>`;
const t = (iso: string | null) => (iso ? String(Date.parse(iso)) : "0");
const words = (s: string | null) => (s ? s.replace(/_/g, " ") : "–");
const yesNo = (v: boolean | null) => (v === null ? "–" : v ? "Yes" : "No");
const naira = (kobo: number) => formatLocal(kobo / 100, "NGN");
const et = (iso: string) => DateTime.fromISO(iso).setZone(SPECIALIST_ZONE).toFormat("h:mm a, ccc d LLL");

/** A header cell. `col` is the stable id used to remember hidden columns and sort. */
const th = (col: string, label: string, type: "text" | "num" = "text", extra = "") =>
  `<th data-col="${col}" data-type="${type}"${extra}>${esc(label)}</th>`;
const viewTh = `<th data-col="view" data-fixed data-nosort><span class="sr">Details</span></th>`;
const viewButton = (id: string, title: string) =>
  `<td class="act"><button type="button" class="view" data-detail="${id}" data-title="${esc(title)}">View</button></td>`;

/** Definition list from [label, escaped html] pairs. */
const kv = (rows: [string, string][]) => `<dl class="kv">${rows.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${v}</dd>`).join("")}</dl>`;

const handoffType = (h: Handoff) => (h.reason === "new_applicant" ? "New applicant" : h.channel === "call" ? "Callback" : "Chat");
const handoffWhen = (h: Handoff) =>
  h.channel !== "call" ? "Reply in Chord" : `${h.callback_number ?? "no number"}${h.callback_time ? ` at ${lagos(h.callback_time)}` : ", no time agreed"}`;
const alertPill = (h: Handoff) =>
  h.alert_error ? '<span class="pill bad">email failed</span>' : h.alert_emailed_at ? '<span class="pill good">emailed</span>' : '<span class="muted">–</span>';

function handoffDetail(h: Handoff, lead: Lead | null, now: DateTime): string {
  const overdue = isOverdue(h, now);
  return `${kv([
    ["Status", overdue ? '<span class="pill bad">overdue</span>' : esc(h.status)],
    ["Type", esc(handoffType(h))],
    ["Reason", esc(words(h.reason))],
    ["Name", esc(lead?.full_name ?? "–")],
    ["Email", esc(lead?.email ?? "–")],
    ["Programme", esc(lead?.programme ?? "–")],
    ...(h.channel === "call"
      ? ([
          ["Phone", esc(h.callback_number ?? "–")],
          ["Callback time", h.callback_time ? `${esc(lagos(h.callback_time))} Lagos<br><span class="muted">${esc(et(h.callback_time))} ET</span>` : "No time agreed"],
        ] as [string, string][])
      : []),
    ["Alert email", h.alert_error ? `<span class="pill bad">failed</span> ${esc(h.alert_error)}` : h.alert_emailed_at ? `Sent ${esc(lagos(h.alert_emailed_at))}` : "Not sent"],
    ["Created", esc(lagos(h.created_at))],
    ["Contacted", esc(lagos(h.contacted_at))],
    ["Closed", esc(lagos(h.closed_at))],
    ["Handoff id", `<code>${esc(h.id)}</code>`],
  ])}<h3>Summary</h3><p class="prose">${esc(h.summary)}</p>${h.notes ? `<h3>Notes</h3><p class="prose">${esc(h.notes)}</p>` : ""}`;
}

function paymentItem(p: Payment): string {
  return `<div class="item">${kv([
    ["Status", paymentPill(p.status)],
    ["Amount", esc(naira(p.amount_kobo))],
    ["Reference", `<code>${esc(p.paystack_reference)}</code>`],
    ["Link created", esc(lagos(p.created_at))],
    ["Paid", esc(lagos(p.paid_at))],
    ["Told in chat", p.customer_notified_at ? `Yes, ${esc(lagos(p.customer_notified_at))}` : p.notify_error ? `No: ${esc(p.notify_error)}` : "–"],
  ])}</div>`;
}

function leadDetail(l: Lead, payments: Payment[], handoffs: Handoff[], now: DateTime): string {
  return `<h3>Applicant</h3>${kv([
    ["Name", esc(l.full_name ?? "–")],
    ["Email", esc(l.email ?? "–")],
    ["Phone", esc(l.whatsapp_number ?? "–")],
    ["Country", esc(l.country ?? "–")],
    ["Programme", esc(l.programme ?? "–")],
    ["Status", statusPill(l.status)],
    ["First message", esc(lagos(l.created_at))],
    ["Last update", esc(lagos(l.updated_at))],
    ["Chord contact", `<code>${esc(l.contact_id)}</code>`],
  ])}<h3>Background</h3>${kv([
    ["Bachelor's degree", esc(yesNo(l.has_bachelors_degree))],
    ["Degree field", esc(l.degree_field ?? "–")],
    ["Statistics course", esc(yesNo(l.has_statistics_course))],
    ["Relevant experience", esc(l.years_relevant_experience === null ? "–" : `${l.years_relevant_experience} years`)],
    ["Eligibility", esc(words(l.eligibility_result))],
    ["Foundation courses", esc(l.foundation_courses?.length ? l.foundation_courses.join(", ") : "–")],
  ])}<h3>Application fee</h3>${payments.length ? payments.map(paymentItem).join("") : '<p class="muted">No payment link yet.</p>'}
<h3>Handoffs</h3>${handoffs.length ? handoffs.map((h) => `<div class="item">${handoffDetail(h, l, now)}</div>`).join("") : '<p class="muted">None.</p>'}`;
}

export function leadsPage(rows: ReturnType<typeof leadRows>, q: string, status: string, user?: string, now: DateTime = DateTime.now()): string {
  const options = ["", ...STATUSES].map((s) => `<option value="${s}"${s === status ? " selected" : ""}>${s ? s.replace("_", " ") : "All statuses"}</option>`).join("");
  const body = rows.length
    ? rows
        .map(({ lead: l, payment, handoffs }, i) => `<tr><td>${esc(l.full_name ?? "–")}</td><td>${esc(l.email ?? "–")}</td><td>${esc(l.programme ?? "–")}</td><td>${esc(l.country ?? "–")}</td><td>${statusPill(l.status)}</td><td>${esc(words(l.eligibility_result))}</td><td data-sort="${esc(payment?.status ?? "")}">${paymentPill(payment?.status)}</td><td class="num" data-sort="${handoffs.length}">${handoffs.length || "–"}</td><td data-sort="${t(l.created_at)}">${esc(lagos(l.created_at))}</td>${viewButton(`lead-${i}`, l.full_name ?? "Applicant")}</tr>`)
        .join("")
    : `<tr data-empty><td colspan="10" class="muted">No leads match.</td></tr>`;
  const templates = rows.map(({ lead, payments, handoffs }, i) => `<template id="lead-${i}">${leadDetail(lead, payments, handoffs, now)}</template>`).join("");
  return page(
    "Leads",
    `<main><h1>Leads</h1><p class="sub">${rows.length} lead${rows.length === 1 ? "" : "s"}. Click a column to sort; use View for the full record.</p>
<div class="toolbar"><form class="filters" method="get" action="/dashboard/leads" style="margin:0"><input type="search" name="q" value="${esc(q)}" placeholder="Name, email, programme or country" aria-label="Search"><select name="status" aria-label="Status">${options}</select><button type="submit">Filter</button></form><div data-columns-for="leads"></div></div>
<div class="card scroll"><table data-table="leads"><thead><tr>${th("name", "Name")}${th("email", "Email")}${th("programme", "Programme")}${th("country", "Country")}${th("status", "Status")}${th("eligibility", "Eligibility")}${th("fee", "Fee")}${th("handoffs", "Handoffs", "num")}${th("created", "First message", "num")}${viewTh}</tr></thead><tbody>${body}</tbody></table></div>${templates}</main>`,
    "leads",
    user,
  );
}

export function followUpsPage(f: ReturnType<typeof followUps>, user?: string, now: DateTime = DateTime.now()): string {
  const open = f.open.length
    ? f.open
        .map(({ handoff: h, lead: l, overdue }, i) => {
          const status = overdue ? '<span class="pill bad">overdue</span>' : `<span class="pill ${h.status === "pending" ? "warn" : "info"}">${esc(h.status)}</span>`;
          return `<tr><td data-sort="${overdue ? "0" : h.status === "pending" ? "1" : "2"}">${status}</td><td>${esc(handoffType(h))}</td><td>${esc(l?.full_name ?? "–")}</td><td data-sort="${t(h.callback_time)}">${esc(handoffWhen(h))}</td><td>${esc(words(h.reason))}</td><td>${alertPill(h)}</td><td data-sort="${t(h.created_at)}">${esc(lagos(h.created_at))}</td>${viewButton(`handoff-${i}`, `${handoffType(h)}: ${l?.full_name ?? "Applicant"}`)}</tr>`;
        })
        .join("")
    : `<tr data-empty><td colspan="8" class="muted">No open handoffs.</td></tr>`;
  const unpaid = f.unpaid.length
    ? f.unpaid
        .map(({ payment: p, lead: l, age }, i) => `<tr><td>${esc(l?.full_name ?? "–")}</td><td>${esc(l?.email ?? "–")}</td><td>${esc(l?.programme ?? "–")}</td><td>${paymentPill(p.status)}</td><td data-sort="${t(p.created_at)}">${esc(lagos(p.created_at))}</td><td data-sort="${now.toMillis() - Date.parse(p.created_at)}">${esc(age)}</td>${viewButton(`unpaid-${i}`, l?.full_name ?? "Applicant")}</tr>`)
        .join("")
    : `<tr data-empty><td colspan="7" class="muted">Every payment link has been paid.</td></tr>`;
  const templates = [
    ...f.open.map(({ handoff, lead }, i) => `<template id="handoff-${i}">${handoffDetail(handoff, lead, now)}</template>`),
    ...f.unpaid.map(({ payment: p, lead: l }, i) =>
      `<template id="unpaid-${i}">${kv([
        ["Name", esc(l?.full_name ?? "–")],
        ["Email", esc(l?.email ?? "–")],
        ["Phone", esc(l?.whatsapp_number ?? "–")],
        ["Programme", esc(l?.programme ?? "–")],
        ["Country", esc(l?.country ?? "–")],
      ])}<h3>Payment</h3>${paymentItem(p)}${p.authorization_url ? `<p><a href="${esc(p.authorization_url)}" target="_blank" rel="noopener noreferrer">Open the Paystack link</a> <span class="muted">(test mode)</span></p>` : ""}</template>`),
  ].join("");
  return page(
    "Follow-ups",
    `<main><h1>Follow-ups</h1><p class="sub">People who need chasing. Overdue callbacks first; click a column to sort.</p>
<div class="card" style="margin-bottom:16px"><div class="toolbar"><h2>Handoffs not yet closed (${f.open.length})</h2><div data-columns-for="handoffs"></div></div><div class="scroll"><table data-table="handoffs"><thead><tr>${th("status", "Status", "num")}${th("type", "Type")}${th("name", "Name")}${th("contact", "Contact", "num")}${th("reason", "Reason")}${th("alert", "Alert")}${th("created", "Created", "num")}${viewTh}</tr></thead><tbody>${open}</tbody></table></div></div>
<div class="card"><div class="toolbar"><h2>Payment links not paid (${f.unpaid.length})</h2><div data-columns-for="unpaid"></div></div><div class="scroll"><table data-table="unpaid"><thead><tr>${th("name", "Name")}${th("email", "Email")}${th("programme", "Programme")}${th("status", "Status")}${th("sent", "Link sent", "num")}${th("waiting", "Waiting", "num")}${viewTh}</tr></thead><tbody>${unpaid}</tbody></table></div></div>${templates}</main>`,
    "follow-ups",
    user,
  );
}
