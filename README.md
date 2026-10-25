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
| `POST /mcp` | MCP endpoint (Streamable HTTP, stateless, JSON responses). Requires `Authorization: Bearer $MCP_BEARER_TOKEN` |
| `POST /webhooks/paystack` | Paystack webhook, HMAC-SHA512 signature verified |
| `GET /payments/callback` | Page Paystack redirects to after checkout ("return to WhatsApp") |
| `GET /health` | Health check |

## Tools

Every tool returns JSON: `ok`, the data, and `agent_guidance` (how to phrase the result). Bad input returns `ok: false` with an `error`; the tools never throw.

| Tool | What it does |
| --- | --- |
| `save_lead` | Create or update the lead for `contact_id`; only the fields you pass are written |
| `assess_eligibility` | `direct_entry` / `foundation_likely` (with course codes, waiver flag) / `advisor_review` / `not_eligible` / `need_more_info`; saves the result on the lead |
| `get_tuition` | Published USD price and billing unit, local currency at Nexford's rate where published, MBA 9/18-month examples; `available: false` otherwise |
| `create_application_payment` | Paystack transaction for 3,321,700 kobo. Reuses a pending link under 30 min old; never charges twice |
| `get_payment_status` | Latest application-fee status; if pending, re-verifies with Paystack (covers a missed webhook) |
| `handoff_to_advisor` | Records a handoff (WhatsApp or call). Callback times are checked against specialist hours; outside them, nothing is saved and three alternative times (Lagos time) come back |

## Layout

```
src/server.ts            entry point (env, wiring, listen)
src/app.ts               Express app (routes, body parsing)
src/env.ts               env validation (refuses non sk_test_ keys)
src/config/*.ts          FX rates, tuition, programmes, foundation rules, hours, constants
src/lib/*.ts             pure logic: eligibility, tuition, hours, contact id, auth, logging
src/services/            Supabase repository, Paystack client, shared payment reconcile
src/mcp/                 MCP server + one file per tool in tools/
src/routes/              /mcp, /webhooks/paystack, /payments/callback
supabase/                migration + seed
scripts/smoke.ts         calls every tool once against a running server
scripts/db.ts            db:push (migrations) and db:seed
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
| `SUPABASE_URL` | Project URL |
| `SUPABASE_SERVICE_ROLE_KEY` | Service role key. Server-side only |
| `PAYSTACK_SECRET_KEY` | Must start with `sk_test_` or the server won't start |
| `PUBLIC_BASE_URL` | Public URL of this server, no trailing slash. Used for Paystack's `callback_url` |
| `DATABASE_URL` | Only for `pnpm db:push` / `pnpm db:seed`. Not needed on Render |

The server refuses to start if any are missing.

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

## Assumptions and open questions

- **Chord's contact identifier.** It's not yet clear what Chord gives the agent as `contact_id` (possibly the WhatsApp number). All handling is in `normaliseContactId()` in `src/lib/contact.ts`: phone-like values are reduced to digits, anything else is used as is. Nothing else depends on its format, so if Chord's identifier turns out different, only that function changes.
- **Specialist hours** are treated as 07:00–18:00 America/New_York **every day** (Nexford says "most days"). Suggested callback slots start on the hour, at least an hour ahead, and no later than 17:00 New York time. Times are computed in the IANA zone, so the US daylight-saving change (1 Nov 2026) moves the window from 12:00–23:00 to 13:00–00:00 Lagos time.
- **Exchange rates** are Nexford's published rates effective **1 October 2026**, fixed in `src/config/fx.ts`. Amounts are rounded to whole units; kobo = whole naira × 100.
- **Test mode only.** The server won't start with a key that doesn't begin with `sk_test_`.
- **Tuition** is only what's published: MBA/BBA for the US, Saudi Arabia, Kenya and Nigeria, plus US-only rates for the other programmes. Everything else returns `available: false` with the tuition calculator link.
- **Programme names** are free text, matched to known programmes with aliases (`src/config/programmes.ts`). Anything unrecognised gets `advisor_review`.
- **Economics** counts as a business background for every rule, including the MBA in Finance (the table lists only business, finance and accounting for that row).
- **Foundation waivers** are only ever "can be requested" (3+ years of relevant experience; certifications are mentioned in the guidance but not captured as a field).
- **Lead status** only moves forward (enquiring → qualified → applied → paid). Creating a payment link sets `applied`; `handed_off` and `paid` are always applied.
- **Paystack `abandoned`.** Paystack reports unpaid, initialised transactions as `abandoned`. Since the person can still pay, those stay `pending` here. Only `failed` (or a verified mismatch) marks a payment failed.
- **Webhook processing** runs before the 200 response (one verify call). After a valid signature it always answers 200, even if processing fails; `get_payment_status` reconciles later.
- **Logging** records references, lead ids, statuses and events only, never names, emails, phone numbers or card details.
