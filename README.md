# Nexford Admissions MCP Server

> **Prototype on mock data.** Built for a TSG Labs take-home exercise. **Not affiliated with, endorsed by, or connected to Nexford University.** Paystack runs in **test mode only**; the server refuses to start with a live key.

This is the tool server for an AI admissions agent ("teammate") on [Chord](https://chordhq.xyz). The agent talks to Nexford applicants on WhatsApp, answers from a knowledge base (configured in Chord, not here), and calls the tools below to:

- record what it learns about the applicant (`save_lead`)
- tell them whether they're **likely** to need a foundation course (`assess_eligibility`)
- quote **published** tuition only, never estimates (`get_tuition`)
- take the $25 (₦33,217) application fee through Paystack (`create_application_payment`, `get_payment_status`)
- hand over to a human Application Specialist in chat or by phone callback (`handoff_to_advisor`)

One Node process serves:

| Route | Purpose |
| --- | --- |
| `POST /mcp` | Customer MCP endpoint (Streamable HTTP, stateless, JSON responses). Requires `Authorization: Bearer $MCP_BEARER_TOKEN` |
| `POST /mcp-admin` | Internal admin MCP endpoint, separate tools. Requires `Authorization: Bearer $ADMIN_MCP_BEARER_TOKEN` |
| `POST /webhooks/paystack` | Paystack webhook, HMAC-SHA512 signature verified |
| `GET /payments/callback` | Page Paystack redirects to after checkout ("return to WhatsApp") |
| `GET /health` | Health check |

## Tools

Every tool returns JSON: `ok`, the data, and `agent_guidance` (how to phrase the result). Bad input returns `ok: false` with an `error`; the tools never throw.

| Tool | What it does |
| --- | --- |
| `save_lead` | Create or update the lead for `contact_id`; only the fields you pass are written |
| `assess_eligibility` | `direct_entry` / `foundation_likely` (with course codes, waiver flag) / `advisor_review` / `not_eligible` / `need_more_info`; saves the result on the lead |
| `get_tuition` | Nexford's tier price for a programme in a country: USD and local currency, billing basis (per month or per course), length and course count, 9/18-month totals for the MBA family and MS degrees. Otherwise `available: false` with a reason: `unknown_country`, `unknown_programme`, `ambiguous_programme` (with candidates) or `not_offered_via_tool`. An optional `contact_id` saves the programme and country to the lead |
| `create_application_payment` | Paystack transaction for 3,321,700 kobo. Reuses a pending link under 30 min old; never charges twice |
| `get_payment_status` | Latest application-fee status; if pending, re-verifies with Paystack (covers a missed webhook) |
| `handoff_to_advisor` | Records a handoff (WhatsApp or call). Callback times are checked against specialist hours; outside them, nothing is saved and three alternative times (Lagos time) come back |

Customer guidance always ends with WhatsApp formatting rules (plain text, no asterisks or Markdown, section labels on their own line). MBA specialisations (AI, Cybersecurity, Enabling E-Commerce, Fintech and Blockchain, International Business, Sustainability, Healthcare Management) are priced and assessed as the MBA and keep their name, e.g. "MBA in Fintech and Blockchain". MBA in Entrepreneurship is priced as the MBA but has no published foundation rule. MBA in Finance is not a specialisation: it's priced with the MS degrees.

### Pricing

All pricing data is in [src/config/tuition.ts](src/config/tuition.ts), and a test fails if a price or exchange-rate literal appears anywhere else in `src/`. That file holds:
- the tier price table
- the countries per tier, with their name, ISO-code and informal aliases
- programme aliases and published facts (course count, structure, length)
- exchange rates
- the source URL and the date it was checked

The source is Nexford's catalogue page "Learner account, tuition and fees", checked 26 October 2026.

Only the example countries the catalogue lists are tiered:
- Tier 1: United States, United Kingdom, Canada
- Tier 2: China, Turkey, and Saudi Arabia (from Nexford's refund-policy examples)
- Tier 3: Egypt, Indonesia, Kenya, Philippines, Thailand
- Tier 4: Nigeria, Ghana

Any other country gets `unknown_country` and the tuition calculator link, even if Nexford publishes an exchange rate for it (e.g. South Africa).

### Admin tools (`/mcp-admin`)

For an internal Chord teammate. These share no tools with `/mcp`, and a test checks both directions.

| Tool | What it does |
| --- | --- |
| `get_pipeline_summary` | `today` / `yesterday` / `last_7_days` / `last_30_days` (Lagos time): new leads, qualified, paid, conversion, leads by programme, foundation-likely share, pending handoffs, overdue callbacks |
| `list_pending_handoffs` | Oldest first: lead, programme, reason, channel, callback time (Lagos), `overdue`, summary. `include_contacted` adds contacted-but-open ones |
| `update_handoff_status` | Mark `contacted` or `closed` (sets `contacted_at` / `closed_at`) with an optional note, appended with a timestamp |
| `get_lead` | Search by email, `contact_id` or name fragment (max 5): profile, payment status, handoff history |
| `get_handoff_alerts_health` | Handoffs from the last 7 days whose alert email or Chord action failed, with ids and errors |

`list_pending_handoffs` also shows `alert_emailed_at`, `chord_flagged_at` and any `alert_error` / `chord_flag_error`, so a handoff nobody was told about is visible.

## Human alerts for every handoff

Every handoff row, whatever its kind, alerts a person. Kinds:
- callback: `handoff_to_advisor` with channel `call`
- chat: channel `whatsapp`
- new_applicant: fee paid

The alert runs in the background after the row is saved, and a failure never fails the tool or the webhook.

- **Email (Resend).** One email per handoff to `ALERT_EMAIL_TO`. Subjects:
  - `[Callback] Call {name} at {time} Lagos ({time} ET)`
  - `[Chat handoff] {name} wants a specialist on WhatsApp`
  - `[New applicant] {name} paid the $25 fee for {programme}`

  The body opens with the action to take (number and time for callbacks), then the lead's profile, eligibility and payment, the agent's summary, a link to the Chord thread when known, and the handoff id for `update_handoff_status`.
- **One email per handoff, guaranteed in three ways:**
  - The send is claimed atomically on the row (`alert_emailed_at`).
  - Resend gets an idempotency key.
  - A `handoff_to_advisor` retry with the same details within 15 minutes reuses the existing handoff instead of creating a new one.

  Failures are recorded in `alert_error`.
- **Sender domain.** Resend's shared `onboarding@resend.dev` sender only delivers to the Resend account owner's own address. To reach the team inbox, `ALERT_EMAIL_FROM` must be on a domain verified in Resend (e.g. `alerts@eminotechnologies.com`).
- **Chord thread link.** The thread is found the same way as for payment confirmations, anchored on this `handoff_to_advisor` call (or on the payment link for new applicants). The agent's turn appears a few seconds after the tool returns, so the alert retries the lookup after 8, 15 and 30 seconds before sending without a link.
- **Specialist hours.** `handoff_to_advisor` always returns `specialist_hours_lagos_today` (e.g. "12:00 PM to 11:00 PM"), computed from 07:00–18:00 New York time, so the agent never works hours out itself. An out-of-hours callback request returns `next_available_slot`.

## When an application fee is paid

On the payment's **first** transition to `success` (the update is guarded by `status <> 'success'`, so duplicate webhooks and status checks can't repeat it):

1. The lead becomes `paid`.
2. A `new_applicant` handoff is created for the admissions team. Its summary has name, email, country, programme (with specialisation), degree, eligibility and foundation courses, the waiver flag, the payment reference and any callback request. A unique index on `handoffs.payment_id` guarantees one per payment.
3. **From the webhook only:** after Paystack has its `200`, a background task messages the applicant in their Chord thread ("Payment received ✅ …") and records `customer_notified_at`, or `notify_error` if it fails. If `get_payment_status` confirms the payment first, the agent is already telling the person in the conversation, so no extra message is sent.

### How the Chord thread is found

The `contact_id` the agent passes (`customer_…`) doesn't appear anywhere Chord exposes: not in thread fields, turns, request headers or MCP `_meta`. However, each agent turn records the tools it used (`metadata.tools_used`). So when the payment succeeds, the server looks at customer (`EXTERNAL`) threads and picks the one whose agent used `create_application_payment` within 2 minutes after this payment was created. It links the lead (`leads.chord_thread_id`) only if **exactly one** thread matches. If none or several match, no proactive message is sent (`notify_error = thread_not_found`), and the agent still confirms when the person asks.

### Delivery strategies (`CHORD_NOTIFY_STRATEGY`)

| Value | What happens |
| --- | --- |
| `takeover` (default) | Take over the thread, post the message, hand back. Hand-back is in a `finally` block, and happens only if we took over: a thread a human is already handling is left with them. The customer also sees Chord's fixed take-over acknowledgement |
| `scheduled_task` | `POST /v1/scheduled-tasks` with a `MESSAGE` payload of `{ conversation_id, body }`. In testing (25 Oct 2026) Chord accepted these tasks but every one failed inside Chord with `tenant_id is required in x-tenant-id header`. It's kept for when that's fixed |
| `off` | No messages; the `CHORD_*` variables aren't required |

`pnpm chord:discover` is the tool used to find these API shapes: listing threads, `--task <id>`, `--thread <id> --try-message`, `--thread <id> --try-takeover` and `--thread <id> --try-flag`. The last one showed that thumbs-down feedback on the latest agent turn, `{ rating: "down", correction }`, sets the thread's `review_state` to `needs_review`.

`pnpm chord:setup-alerts` (one-time, safe to rerun) points Chord's own take-over escalation email at `ALERT_EMAIL_TO`, or at `--notify-to`. It also tries to create backup keyword escalation rules, which Chord now rejects (see "Known Chord issues").

## Layout

```
src/server.ts            entry point (env, wiring, listen)
src/app.ts               Express app (routes, body parsing)
src/env.ts               env validation (refuses non sk_test_ keys)
src/config/*.ts          FX rates, tuition, programmes, foundation rules, hours, constants
src/lib/*.ts             pure logic: eligibility, tuition, hours, contact id, auth, logging
src/services/            Supabase repository, Paystack and Chord clients, payment reconcile,
                         Chord thread linking (chordThreads.ts) and payment notification (notify.ts)
src/mcp/                 MCP server; customer tools in tools/, admin tools in admin/
src/routes/              /mcp, /webhooks/paystack, /payments/callback
supabase/                migration + seed
scripts/smoke.ts         calls every tool once against a running server
scripts/db.ts            db:push (migrations) and db:seed
scripts/chord-discover.ts  probes undocumented Chord API shapes
scripts/chord-setup-alerts.ts  one-time Chord escalation email setup
test/                    Vitest suite (Supabase and Paystack faked in memory)
```

## Local setup

Requires Node 20+ and pnpm.

```bash
pnpm install
cp .env.example .env     # fill in the values below
pnpm test                 # runs without any external services
pnpm dev              # http://localhost:3000
```

### Environment variables

| Variable | Notes |
| --- | --- |
| `PORT` | Set automatically on Render; use 3000 locally |
| `MCP_BEARER_TOKEN` | Long random string, e.g. `openssl rand -hex 32`. Chord sends it as a bearer token |
| `ADMIN_MCP_BEARER_TOKEN` | Different long random string for `/mcp-admin` |
| `CHORD_NOTIFY_STRATEGY` | `takeover` (default), `scheduled_task` or `off` |
| `CHORD_API_KEY` | Chord API key with `thread:read`, `thread:write`, `teammate:read`, `teammate:update`. Required unless the strategy is `off` |
| `CHORD_WORKSPACE_ID` | Chord workspace id. Required unless `off` |
| `CHORD_TEAMMATE_ID` | The WhatsApp admissions teammate's id. Required unless `off` |
| `RESEND_API_KEY` | Resend API key for handoff alert emails. Optional: without it (or the next two), alerts are skipped with a startup warning |
| `ALERT_EMAIL_FROM` | Sender on a Resend-verified domain, e.g. `Nexford Admissions Bot <alerts@eminotechnologies.com>` |
| `ALERT_EMAIL_TO` | Alert recipients, comma-separated |
| `CHORD_DASHBOARD_THREAD_URL_TEMPLATE` | Chord dashboard thread URL containing `{thread_id}`, used for the link in alert emails. Optional |
| `SUPABASE_URL` | Project URL |
| `SUPABASE_SERVICE_ROLE_KEY` | Service role key. Server-side only |
| `PAYSTACK_SECRET_KEY` | Must start with `sk_test_` or the server won't start |
| `PUBLIC_BASE_URL` | Public URL of this server, no trailing slash. Used for Paystack's `callback_url` |
| `DATABASE_URL` | Only for `pnpm db:push` / `pnpm db:seed`. Not needed on Render |

The server refuses to start if any required variable is missing, or if the admin token equals the customer token.

## Database

1. In Supabase, open **Connect → Session pooler** and copy the connection string. Put it in `.env` as `DATABASE_URL`, with your database password filled in. Only these scripts use it; the server doesn't.
2. Run:
   ```bash
   pnpm db:push    # applies supabase/migrations/*.sql in order
   pnpm db:seed    # optional: three demo leads
   ```

`pnpm db:push` records applied files in a `schema_migrations` table, so rerunning it skips anything already applied. Each migration runs in a transaction, so a failing one leaves nothing half-applied. `pnpm db:seed` is safe to rerun because duplicates are skipped.

You can also paste the SQL files into the Supabase **SQL Editor** instead. If you do, `pnpm db:push` won't know they were applied.

All tables have row-level security enabled and no policies, so only the service role can read or write them.

## Deploy to Render (free plan)

1. Push this repo to GitHub.
2. Render → **New → Blueprint** → pick the repo. `render.yaml` defines one free web service. It builds with `pnpm install --frozen-lockfile && pnpm run build`, starts with `pnpm start` and health-checks `/health`.
3. Fill in `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `PAYSTACK_SECRET_KEY` and `PUBLIC_BASE_URL` (the service's `https://<name>.onrender.com` URL). `MCP_BEARER_TOKEN` is generated; copy it from the service's **Environment** tab.
4. Check the deploy:
   ```bash
   curl https://<app-url>/health
   MCP_URL=https://<app-url>/mcp MCP_BEARER_TOKEN=<token> pnpm smoke
   ```

**Free plan sleep.** A free Render service sleeps after about 15 minutes without traffic, and the next request waits up to a minute while it wakes. In practice:
- Chord's first tool call after a quiet spell may time out. Open `https://<app-url>/health` a minute before a demo to wake it.
- Paystack retries webhooks that fail, and `get_payment_status` re-verifies pending payments, so a webhook that arrives while the service is waking isn't lost.
- To keep it awake, point a free uptime monitor (e.g. UptimeRobot or cron-job.org) at `/health` every 10 minutes. The free plan's 750 hours a month covers one service running all month.

`pnpm smoke` connects with the MCP client SDK, lists the tools and calls each one once. It creates a lead with `contact_id` `smoke_<timestamp>` and a Paystack **test** transaction. You can open the printed `authorization_url` and pay with a Paystack test card to try the full payment flow.

## Paystack test webhook

Paystack dashboard (test mode) → **Settings → API Keys & Webhooks** → **Test Webhook URL**:

```
https://<app-url>/webhooks/paystack
```

The webhook only acts on `charge.success`. It never trusts the payload: it re-verifies the transaction with `GET /transaction/verify/:reference` and requires `status = success`, currency `NGN` and the stored amount. A mismatch marks the payment `failed`. Duplicate deliveries change nothing, and every verified event is logged in `webhook_events`. The same reconcile function runs from `get_payment_status`, so a missed webhook is recovered the next time the agent checks.

## Register the server in Chord

```bash
CHORD=https://api.chordhq.xyz/v1
# Authenticate with your Chord API key, e.g. -H "Authorization: Bearer $CHORD_API_KEY"

# 1. Register the MCP server
curl -X POST "$CHORD/workspaces/$WORKSPACE_ID/mcp-servers" \
  -H "Authorization: Bearer $CHORD_API_KEY" -H "Content-Type: application/json" \
  -d '{
    "name": "Nexford Admissions",
    "url": "https://<app-url>/mcp",
    "transport": "streamable_http",
    "auth_type": "bearer",
    "auth_token": "<MCP_BEARER_TOKEN>"
  }'
# -> note the returned id as $MCP_SERVER_ID

# 2. Confirm Chord can see the six tools
curl -X POST "$CHORD/workspaces/$WORKSPACE_ID/mcp-servers/$MCP_SERVER_ID/tools" \
  -H "Authorization: Bearer $CHORD_API_KEY"

# 3. Attach it to the teammate
curl -X PUT "$CHORD/teammates/$TEAMMATE_ID" \
  -H "Authorization: Bearer $CHORD_API_KEY" -H "Content-Type: application/json" \
  -d '{"add_mcp_server_ids": ["'"$MCP_SERVER_ID"'"]}'
```

### Admin server and the Ops teammate

```bash
# 4. Register the admin endpoint as a second MCP server
curl -X POST "$CHORD/workspaces/$WORKSPACE_ID/mcp-servers" \
  -H "Authorization: Bearer $CHORD_API_KEY" -H "Content-Type: application/json" \
  -d '{
    "name": "Nexford Admissions Admin",
    "url": "https://<app-url>/mcp-admin",
    "transport": "streamable_http",
    "auth_type": "bearer",
    "auth_token": "<ADMIN_MCP_BEARER_TOKEN>"
  }'
# -> $ADMIN_SERVER_ID
```

5. In Chord, create a second teammate, **Nexford Admissions Ops**. It's internal only, with no customer channels (no WhatsApp). Note its id as `$OPS_ID`.

6. **Assign servers explicitly to both teammates.** A teammate with an *empty* MCP list can use *every* enabled MCP server in the workspace. So if you leave the WhatsApp teammate unassigned, applicants' agent could call the admin tools, and the Ops teammate could call customer tools. `set_mcp_server_ids` replaces the list exactly:

```bash
curl -X PUT "$CHORD/teammates/$TEAMMATE_ID" \
  -H "Authorization: Bearer $CHORD_API_KEY" -H "Content-Type: application/json" \
  -d '{"set_mcp_server_ids": ["'"$MCP_SERVER_ID"'"]}'

curl -X PUT "$CHORD/teammates/$OPS_ID" \
  -H "Authorization: Bearer $CHORD_API_KEY" -H "Content-Type: application/json" \
  -d '{"set_mcp_server_ids": ["'"$ADMIN_SERVER_ID"'"]}'
```

7. Daily report on the Ops teammate, 09:00 Lagos time:

```bash
curl -X POST "$CHORD/teammates/$OPS_ID/schedules" \
  -H "Authorization: Bearer $CHORD_API_KEY" -H "Content-Type: application/json" \
  -d '{
    "name": "Daily admissions report",
    "task_prompt": "Use get_handoff_alerts_health, get_pipeline_summary for yesterday and list_pending_handoffs. If any handoff alerts failed, say so at the very top with their ids. Then write a short report: new leads, payments, conversion, top programmes, then every pending handoff oldest first with overdue callbacks marked. Keep it under 200 words.",
    "cadence": { "type": "DAILY", "time_of_day": "09:00", "timezone": "Africa/Lagos" },
    "enabled": true,
    "workspace_id": "'"$WORKSPACE_ID"'"
  }'
# -> $SCHEDULE_ID
```

For a demo, run it immediately instead of waiting until 09:00:

```bash
curl -X POST "$CHORD/teammates/$OPS_ID/schedules/$SCHEDULE_ID/run" \
  -H "Authorization: Bearer $CHORD_API_KEY"
```

## Known Chord issues (found 25 Oct 2026)

These are on Chord's side. Our server's behaviour and the evidence are recorded so they can be raised with Chord.

- **The WhatsApp simulator doesn't show operator or system messages.** After a payment, the server takes over the thread, posts "Payment received ✅ …" and hands back. Chord's turns API records our message and Chord's own take-over acknowledgement ("One moment — connecting you with a teammate.") as `delivery_status: "sent"`, the control-events log shows `agent_active → human_active → agent_active`, and both messages appear in the Chord dashboard. Neither appears in the simulator (chat.tsglabs.dev), even after refreshing, and a message typed by hand after **Take over** in the dashboard doesn't arrive either. Agent messages arrive normally. For demos, show the confirmation in the dashboard thread view.
- **Scheduled `MESSAGE` tasks fail inside Chord.** `POST /v1/scheduled-tasks` accepts a payload of `{ conversation_id, body }`, but every task then fails with `UNAUTHENTICATED: tenant_id is required in x-tenant-id header`, even with that header on our request. That's why `CHORD_NOTIFY_STRATEGY` defaults to `takeover`.
- **Escalation rules are deprecated.** `POST /v1/escalation-rules` returns `ESCALATION_RULES_DEPRECATED` ("create an escalation trigger instead"), and no trigger endpoint exists in the API. `pnpm chord:setup-alerts` therefore only sets the escalation email. The backup trigger ("escalate when the customer asks to speak to a human or to be called") has to be added by hand in the dashboard.
- **The `customer_…` contact id isn't exposed on threads.** It isn't in thread fields, turns, request headers or MCP `_meta`, so threads are found from tool-use timing (see "How the Chord thread is found"). A new simulator conversation also gets a new `customer_…` id, so the same person in a new chat becomes a new lead.
- **The Ops teammate's chats failed with "Billing settlement failed after the model completed"**, costing about 3 credits per message. In that session the agent never called the admin tools ("admin server unreachable in this session"), although Chord's own tool listing reaches `/mcp-admin` fine. The admin endpoint works from any MCP client, e.g. `npx @modelcontextprotocol/inspector` with the admin bearer token.

## Assumptions and open questions

- **Chord's contact identifier** is Chord's customer id (`customer_…`), not a phone number. The agent can't see the sender's number and must ask for it. `normaliseContactId()` in `src/lib/contact.ts` still isolates the format. Chord exposes no link from that id to a thread, so the thread is found from tool-use timing (see "How the Chord thread is found").
- **Specialist hours** are treated as 07:00–18:00 America/New_York **every day** (Nexford says "most days"). Suggested callback slots start on the hour, at least an hour ahead, and no later than 17:00 New York time. Times are computed in the IANA zone, so the US daylight-saving change (1 Nov 2026) moves the window from 12:00–23:00 to 13:00–00:00 Lagos time.
- **Exchange rates** are Nexford's published rates effective **1 October 2026** (paynxu.nexford.edu/fxrates), fixed in `src/config/tuition.ts`. Local prices are shown for Nigeria (NGN), Ghana (GHS), Kenya (KES) and Egypt (EGP). Amounts are rounded once to whole units (totals are worked out from the USD total); kobo = whole naira × 100.
- **Test mode only.** The server won't start with a key that doesn't begin with `sk_test_`.
- **Tuition** uses the catalogue's four tiers, applied only to the example countries the catalogue lists (see "Pricing"). Undergraduate Career Pathways and pathway programmes (Constructor, San Francisco Bay, Capella) are priced separately and return `not_offered_via_tool`. The application fee is always quoted and charged in naira, because Paystack charges NGN. From 1 December 2026 (Lagos time), quotes include a note about Nexford's new payment model starting 1 January 2027.
- **Programme names** are free text, matched to known programmes with aliases (`src/config/programmes.ts`). Anything unrecognised gets `advisor_review`.
- **Economics** counts as a business background for every rule, including the MBA in Finance (the table lists only business, finance and accounting for that row).
- **Foundation waivers** are only ever "can be requested" (3+ years of relevant experience; certifications are mentioned in the guidance but not captured as a field).
- **Lead status** only moves forward (enquiring → qualified → applied → paid). Creating a payment link sets `applied`; `handed_off` and `paid` are always applied.
- **Paystack `abandoned`.** Paystack reports unpaid, initialised transactions as `abandoned`. Since the person can still pay, those stay `pending` here. Only `failed` (or a verified mismatch) marks a payment failed.
- **Proactive confirmation** depends on finding the thread from timing. If two applicants create payment links within the same two minutes, neither gets the proactive message; their agents still confirm when asked. Pipeline "paid" counts applicants whose fee was paid in the period, so conversion (paid / new leads) can exceed 100% on quiet days.
- **Webhook processing** runs before the 200 response (one verify call); the customer notification runs after it. After a valid signature it always answers 200, even if processing fails; `get_payment_status` reconciles later.
- **Logging** records references, lead ids, statuses and events only, never names, emails, phone numbers or card details.
