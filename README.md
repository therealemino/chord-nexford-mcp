# Nexford Admissions Assistant on Chord

A WhatsApp admissions agent for Nexford University, built on [Chord](https://chordhq.xyz). The agent answers questions from a knowledge base (set up in Chord) and calls the tools in this repo to:
- record the applicant's details
- check whether they'll likely need a foundation course
- quote published tuition
- take the $25 application fee through Paystack
- hand over to a human

> Prototype on mock data, built for a TSG Labs take-home. Not affiliated with Nexford University. Paystack runs in test mode only; the server refuses to start with a live key.

## What's in the repo

| Path | What it is |
| --- | --- |
| `src/` | The MCP server (Node, TypeScript, Express) |
| `docs/ops-teammate-skill.md` | Skill for the internal "Nexford Admissions Ops" teammate |
| `supabase/` | Database migrations and seed data |
| `scripts/` | `smoke` (calls every tool), `db` (migrate and seed), `chord-*` (Chord setup helpers) |
| `test/` | Vitest suite. It runs offline, with Supabase, Paystack, Chord and email faked |

The server exposes:

| Route | Purpose |
| --- | --- |
| `POST /mcp` | Customer tools for the WhatsApp teammate (bearer token) |
| `POST /mcp-admin` | Staff tools for the Ops teammate (a separate bearer token) |
| `POST /webhooks/paystack` | Paystack webhook (signature verified) |
| `GET /payments/callback` | Page Paystack returns to after checkout |
| `GET /dashboard` | Staff dashboard: leads, conversion, payments, follow-ups (Supabase admin login) |
| `GET /health` | Health check |

**Customer tools:**
- `save_lead`: save the applicant's details.
- `assess_eligibility`: whether they'll likely need a foundation course.
- `get_tuition`: tuition by programme and country, from Nexford's tier table in `src/config/tuition.ts`.
- `create_application_payment`: Paystack link for the application fee.
- `get_payment_status`: whether the fee has been paid.
- `handoff_to_advisor`: book a chat or callback with an Application Specialist.

**Admin tools:**
- `get_pipeline_summary`: leads, payments and conversion for a period.
- `list_pending_handoffs`: handoffs waiting for a person.
- `update_handoff_status`: mark a handoff contacted or closed.
- `get_lead`: look up an applicant.
- `get_handoff_alerts_health`: handoff alerts that failed.

When a fee is paid, the server messages the applicant in their Chord thread and creates a "new applicant" handoff. Every handoff also emails the team (Resend).

## Run it locally

You need Node 20+, pnpm, a Supabase project and a Paystack test secret key.

```bash
pnpm install
cp .env.example .env        # fill in the values (see below)
pnpm db:push                # create the tables (pnpm db:seed adds 3 demo leads)
pnpm test                   # offline test suite
pnpm dev                    # http://localhost:3000
pnpm smoke                  # calls every tool against PUBLIC_BASE_URL/mcp (or MCP_URL)
```

### Environment variables

| Variable | Notes |
| --- | --- |
| `MCP_BEARER_TOKEN`, `ADMIN_MCP_BEARER_TOKEN` | Two different random strings (`openssl rand -hex 32`) |
| `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` | Supabase project settings |
| `PAYSTACK_SECRET_KEY` | Must start with `sk_test_` |
| `PUBLIC_BASE_URL` | Where the server is reachable, no trailing slash |
| `CHORD_API_KEY`, `CHORD_WORKSPACE_ID`, `CHORD_TEAMMATE_ID` | For payment confirmations in the chat. The teammate is the WhatsApp one. Not needed if `CHORD_NOTIFY_STRATEGY=off` |
| `RESEND_API_KEY`, `ALERT_EMAIL_FROM`, `ALERT_EMAIL_TO` | Optional handoff emails. The sender must be on a domain verified in Resend |
| `DATABASE_URL` | For `pnpm db:push` only: the Supabase **Session pooler** connection string |

## Deploy (Render)

1. Render → **New → Blueprint** → this repo. `render.yaml` sets up the build, start and health check.
2. Add the environment variables above, with `PUBLIC_BASE_URL` set to the Render URL.
3. Paystack dashboard (test mode) → **Settings → API Keys & Webhooks** → set the test webhook URL to `<PUBLIC_BASE_URL>/webhooks/paystack`.

The free plan sleeps when idle. Open `/health` a minute before testing.

## Connect it to Chord

```bash
CHORD=https://api.chordhq.xyz/v1
AUTH="Authorization: Bearer $CHORD_API_KEY"

# Register both servers (note each returned id)
curl -X POST "$CHORD/workspaces/$WORKSPACE_ID/mcp-servers" -H "$AUTH" -H "Content-Type: application/json" \
  -d '{"name":"Nexford Admissions","url":"<PUBLIC_BASE_URL>/mcp","transport":"streamable_http","auth_type":"bearer","auth_token":"<MCP_BEARER_TOKEN>"}'
curl -X POST "$CHORD/workspaces/$WORKSPACE_ID/mcp-servers" -H "$AUTH" -H "Content-Type: application/json" \
  -d '{"name":"Nexford Admissions Admin","url":"<PUBLIC_BASE_URL>/mcp-admin","transport":"streamable_http","auth_type":"bearer","auth_token":"<ADMIN_MCP_BEARER_TOKEN>"}'

# Check Chord can see the tools
curl -X POST "$CHORD/workspaces/$WORKSPACE_ID/mcp-servers/$SERVER_ID/tools" -H "$AUTH"

# Give each teammate only its own server
curl -X PUT "$CHORD/teammates/$WHATSAPP_TEAMMATE_ID" -H "$AUTH" -H "Content-Type: application/json" -d '{"set_mcp_server_ids":["<customer server id>"]}'
curl -X PUT "$CHORD/teammates/$OPS_TEAMMATE_ID" -H "$AUTH" -H "Content-Type: application/json" -d '{"set_mcp_server_ids":["<admin server id>"]}'
```

Assign both teammates explicitly. A teammate with an empty list can use every server in the workspace, which would expose the admin tools in customer chats.

For the Ops teammate, create an internal teammate with no customer channels and add `docs/ops-teammate-skill.md` as its skill.

## Dashboard

Create a staff login (a Supabase Auth user marked as admin), then open `<PUBLIC_BASE_URL>/dashboard`:

```bash
pnpm dashboard:user --email you@example.com --password '<at least 8 characters>'
```

Only users created this way can sign in. Anyone else who signs up to the Supabase project is refused, because only the server can mark a user as admin.

It has three screens:
- **Overview** (today, 7 days, 30 days or all time):
  - new leads, how many paid, conversion and fees received
  - the funnel: enquired, eligibility checked, payment link sent, paid
  - leads and payments per day
  - paid after talking to a person vs with the AI only, and time to pay
  - results by programme and country, and the eligibility mix
- **Leads:** a searchable list with each lead's status, eligibility and payment.
- **Follow-ups:** open handoffs (overdue callbacks first) and payment links that haven't been paid.

Tables sort when you click a column header, and the **Columns** menu shows or hides columns. **View** opens a row's full details, including the handoff summary.

## Test it

In the WhatsApp simulator:
1. **Tuition:** "How much is the MS in Digital Transformation in Nigeria?" The answer should be $280 a month (₦372,028).
2. **Eligibility:** say you have an engineering degree and want the MBA. You should hear that the FND 5100 foundation course is likely.
3. **Payment:** give a name and email, agree to the $25 fee, and pay the link with Paystack's test card: `4084 0840 8408 4081`, CVV `408`, any future expiry, PIN `0000`, OTP `123456`.
4. **Confirmation:** the "Payment received ✅" message appears in the Chord dashboard thread. Supabase shows the payment as `success` and a `new_applicant` handoff.
5. **Handoff:** ask for a callback at a given time. You should get a confirmation, a `handoffs` row and an alert email.

## Known limitations

- **The "Payment received" message doesn't show up in the WhatsApp simulator.**
  - When someone pays, the server briefly steps into the chat as a staff member, posts "Payment received ✅", and hands the chat back to the AI.
  - Chord records the message as sent and shows it in the Chord dashboard.
  - But the simulator (Chord's practice WhatsApp) only displays messages written by the AI. It hides messages from staff, including Chord's own "connecting you with a teammate" notice.
  - This is a Chord simulator bug. To see the confirmation, open the conversation in the Chord dashboard.
- **Sometimes we can't tell which chat to send the "Payment received" message to.**
  - Chord gives the AI an ID for each person (`customer_…`), but never tells us which conversation that ID belongs to.
  - So the server matches by timing: it looks for the conversation where the AI created a payment link at the same moment we created this person's link.
  - If two people get payment links within the same two minutes, we can't tell their chats apart. To avoid sending a confirmation to the wrong person, neither gets the automatic message.
  - Their payments are still recorded correctly, and if they ask whether their payment went through, the AI checks and tells them.
- **Specialist hours are assumed to be 7am to 6pm New York time, every day.** Exchange rates are Nexford's published rates from 1 October 2026. Prices come from Nexford's catalogue, checked 26 October 2026.
