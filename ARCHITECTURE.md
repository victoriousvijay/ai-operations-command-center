# Architecture — AI Operations Command Center

Status: Supabase and GoHighLevel are both live and fully verified —
including a real GHL contact search (by name) resolving to a real
contact, and a real write (task creation) against that contact. n8n has 4
workflows deployed to a real connected account, pending 3 credential
attachments. OpenClaw remains on its mock adapter pending Gateway details
— the real adapter is implemented and independently switchable. See
[README.md § What's mocked vs. actually connected](./README.md#whats-mocked-vs-actually-connected).

## Verified end-to-end run

Submitting "Move John Smith's opportunity to Qualified and create a
follow-up task for tomorrow." through the live dashboard against the real
Supabase project produced, confirmed by direct SQL query:

```
automation_requests: status=success, intent=CRM_UPDATE
  automation_actions: UPDATE_OPPORTUNITY → success (ghl-opportunity-workflow)
  automation_actions: CREATE_TASK → success (ghl-task-workflow)
  execution_logs: 2 rows, both status=success
```

The `workflow_name` values above are what the *real* n8n workflows would
be called if `N8N_ADAPTER=http` were set — `MockN8nClient` reuses the same
`WORKFLOW_BY_ACTION` naming for its log entries, so the audit trail reads
identically regardless of which adapter actually ran.

A second run, after `GHL_ADAPTER=real` was set, exercised `RealGhlClient`
against the live API for a `GET_CONTACT` action. The mock agent's
synthesized contact ID doesn't exist in the real account, so GoHighLevel
correctly returned a 400 "not found" — proving real authentication and
real error propagation end to end:

```
GoHighLevel API error 400 on /contacts/mock-contact-john-smith:
  {"error":"Contact with id mock-contact-john-smith not found","status":400}
→ automation_actions.status = failed
→ automation_requests.status = failed
```

That "not found" was correct behavior, not a bug — but it read like a
failure of the GHL integration rather than what it actually was (a fake
placeholder ID with nothing to resolve it). `lib/n8n/client.ts`'s
`resolveContactId` now closes that gap: it mirrors the "Find Contact" step
the architecture's own n8n workflow design already called for, resolving
a name/email hint against `GhlClient.searchContacts` before any
contact-touching action runs, so a synthetic ID either resolves to a real
one or fails with a specific, actionable message
(`GHL_LOCATION_ID is not configured` / `No GoHighLevel contact found
matching "..."`) instead of a generic "not found." A real contact ID
supplied directly — via the dashboard's manual override field or
`contactIdOverride` on `POST /api/execute` — skips resolution and is used
as-is, for testing a full success path without `GHL_LOCATION_ID`.

Building this surfaced a real reliability bug, fixed the same session: the
first version called `resolveContactId` outside `MockN8nClient.execute`'s
try/catch, so a thrown `GhlApiError` (missing `GHL_LOCATION_ID`) escaped
uncaught and left a request stuck at `status: executing` indefinitely
instead of resolving to `failed`. Fixed by moving the call inside the try
block, and by adding a second layer of defense in

### Full real success path, both read and write

With `GHL_LOCATION_ID` set, submitting "Get contact for Amanda Torres"
through the dashboard: the mock agent synthesized a placeholder ID and a
`contactLookupHint`, `resolveContactId` searched the real GHL location and
found a real matching contact (a lead already in that GHL sub-account),
substituted the real ID, and `RealGhlClient.getContact` returned real data
— `automation_requests.status = success` in 1120ms. A follow-up "Create a
follow-up task for Amanda Torres for tomorrow" resolved the same real
contact and created a **real task** in that GHL account via
`RealGhlClient.createTask` — `success` in 3182ms. Both confirmed in the
dashboard's Execution Logs panel and via direct SQL query. This is the
full THINK → resolve → DO path working against live data, not just
mocked or read-only.

One more real-world correction along the way: GHL's `/contacts/search`
endpoint rejects an unrecognized `limit` field — the real parameter name
is `pageLimit` (`RealGhlClient.searchContacts` initially guessed `limit`
by convention; the live API's `422` response corrected it immediately).
`lib/orchestration/execute.ts`'s dispatch loop: `n8n.execute()` is now
wrapped in its own try/catch too, so no `N8nClient` implementation — mock,
HTTP, or a future one — can leave a request stuck no matter what it
throws. The one row this left stranded mid-fix was manually reconciled to
`failed` in Supabase with a note explaining why.

## System diagram

```
USER
  |
  v
NEXT.JS DASHBOARD (app/page.tsx, app/components/)
  |  HTTPS
  v
BACKEND API (app/api/*)
  |  validate input, persist, orchestrate
  v
ORCHESTRATION (lib/orchestration/execute.ts)
  |
  +-- AGENT ADAPTER (lib/agent) --------- THINK: intent + proposed actions
  |     openclaw-adapter.ts (real) | mock-adapter.ts (mock)
  |
  +-- ALLOWLIST CHECK (lib/actions/allowlist.ts) -- independent of the agent
  |
  +-- N8N ADAPTER (lib/n8n) ------------- DO: validate + execute
        client.ts: HttpN8nClient (real) | MockN8nClient (mock, in-process)
              |
              v
        GHL ADAPTER (lib/ghl)
        client.ts: RealGhlClient (real) | MockGhlClient (mock)
              |
              v
        GoHighLevel API (services.leadconnectorhq.com)
  |
  v
SUPABASE (lib/supabase) — every step logged/persisted throughout, not just at the end
  |
  v
STRUCTURED RESULT -> DASHBOARD
```

## THINK vs DO

- **The agent (THINK)** receives the natural-language request and a fixed
  set of client-side "function tools" — exactly the six actions in
  `lib/actions/allowlist.ts`. It can only ever propose calls to those
  tools; it has no network path to GoHighLevel, n8n, or Supabase, and
  holds no credentials for any of them.
- **The backend (seam)**, in `lib/orchestration/execute.ts`, receives the
  agent's proposed actions and re-validates each one against the same
  allowlist server-side — independent of whether the agent adapter already
  filtered. This is not a formality: a future or misbehaving agent adapter
  cannot get a disallowed action executed no matter what it returns.
- **n8n (DO)** is the only layer that holds GoHighLevel credentials in a
  real deployment. It validates the payload again, performs the actual API
  call, logs the execution, and returns structured JSON. Locally,
  `MockN8nClient` runs this same contract in-process against `MockGhlClient`
  or `RealGhlClient` (whichever `GHL_ADAPTER` selects), so the "n8n
  validates, then calls GHL" behavior is genuinely exercised, not stubbed
  out — see `lib/n8n/README.md`.

## Adapter boundaries

Every external system this project talks to is behind a small adapter
interface with exactly two implementations — a real one and a mock one —
selected by an explicit, mock-by-default environment variable:

| Adapter | Interface | Real | Mock | Switch |
|---|---|---|---|---|
| Agent | `lib/agent/types.ts` | `openclaw-adapter.ts` | `mock-adapter.ts` | `AGENT_ADAPTER` |
| n8n | `lib/n8n/types.ts` | `client.ts`'s `HttpN8nClient` | `client.ts`'s `MockN8nClient` | `N8N_ADAPTER` |
| GoHighLevel | `lib/ghl/types.ts` | `client.ts`'s `RealGhlClient` | `client.ts`'s `MockGhlClient` | `GHL_ADAPTER` |

Presence of a credential never silently switches an adapter to real — each
switch is its own explicit env var, so a demo can have a real
`GHL_PRIVATE_INTEGRATION_TOKEN` configured for later use without any risk
of accidentally calling the live CRM.

### What was verified vs. assumed, per adapter

- **GoHighLevel** (`lib/ghl/README.md`): base URL, required `Version`
  header, and Bearer auth were confirmed with direct HTTP requests against
  the live API (not just documentation) before `RealGhlClient` was
  written. Endpoint paths came from GHL's public docs, cross-checked for
  consistency across five separate endpoint pages.
- **OpenClaw** (`lib/agent/README.md`): the request shape, auth, and
  function-calling contract are directly documented by OpenClaw. The exact
  non-streaming response envelope is not shown in OpenClaw's own docs;
  `openclaw-adapter.ts` assumes the standard OpenResponses/OpenAI Responses
  `output` array shape (OpenClaw documents itself as compatible with that
  family) and fails loudly with a specific error if a live Gateway's
  response doesn't match, rather than silently returning nothing.
- **n8n**: the webhook request/response contract
  (`N8nExecuteRequest`/`N8nExecuteResult` in `lib/n8n/types.ts`) is this
  project's own design, since n8n workflows are user-authored — there is
  no third-party contract to verify against. `n8n/workflows/*.json` are
  genuine, importable n8n exports (standard schema) built from the
  verified GHL contract, but have not been run against a live n8n
  instance — see `n8n/workflows/README.md` for that caveat.

## Agent safety — action allowlist

Allowed (`lib/actions/allowlist.ts`, used both as the tool schema
advertised to the agent and as the independent server-side check in
`lib/orchestration/execute.ts`):

`GET_CONTACT`, `GET_OPPORTUNITY`, `UPDATE_CONTACT`, `UPDATE_OPPORTUNITY`,
`CREATE_TASK`, `ADD_NOTE`

Never exposed to the agent: `DELETE_CONTACT`, `DELETE_OPPORTUNITY`,
`BULK_DELETE`, `CHANGE_CREDENTIALS` — these are not filtered out, they are
simply never offered as a tool, so the agent has no way to request them.
If a destructive action is ever added, it must go through an explicit
propose → human approval → execute gate; `automation_actions.status`
already has a `pending_approval` value reserved for this, unused by any
action today.

## Orchestration pipeline (`lib/orchestration/execute.ts`)

For one call to `executeAutomationRequest`:

1. If an `idempotencyKey` was supplied and already exists, return the
   original result instead of re-executing.
2. Insert an `automation_requests` row (`status: received`), resolving
   `agent_id` from the `agents` table by the active `AGENT_ADAPTER` type.
3. Set `status: interpreting`, call the agent adapter. On agent error or an
   empty action list, log it and set `status: failed`.
4. Set `intent` from the agent's response, `status: executing`.
5. For each proposed action: re-check the allowlist; insert an
   `automation_actions` row; dispatch to the n8n adapter; insert an
   `execution_logs` row; update the action's `status`/`response`.
6. Compute the request's final status (`success` / `partial_failure` /
   `failed` from the per-action results), set `completed_at`.
7. Return `{ requestId, status, intent, actions }` — the shape the
   dashboard and API consumers render.

## Data model (Supabase)

Schema across four migrations, applied in filename order to the live
project (`wvifvkdwjxhxvzieloam`):
`20260830163243_init_schema.sql` (all six tables, indexes, RLS, seed
agents) → `20260830164642_add_intent_and_idempotency.sql` (adds `intent`,
`idempotency_key` to `automation_requests`) →
`20260830170043_seed_integrations.sql` →
`20260830174600_harden_set_updated_at_search_path.sql` (pins the trigger
function's `search_path`, closing the one actionable finding from
Supabase's security advisor). TypeScript types: `lib/supabase/types.ts`.

| Table | Purpose |
|---|---|
| `automation_requests` | one row per user request: text, status, `agent_id` (FK → `agents`), `intent`, `idempotency_key`, timestamps |
| `automation_actions` | one row per proposed/executed action: type, target system, payload, status, response, `integration_id` (FK → `integrations`) |
| `execution_logs` | one row per execution attempt: workflow name, status, error, duration, links to both a request and an action |
| `contacts_cache` | local reference cache of GHL contacts touched by the system (not a full mirror) |
| `agents` | registry of agent adapters (`openclaw` \| `mock`) — seeded with `mock-dev` and `openclaw-main`; holds no credentials |
| `integrations` | connection metadata for external systems (`n8n` \| `gohighlevel`) — seeded with `n8n-primary` and `gohighlevel-main`; holds no credentials |

`agents` and `integrations` are additive beyond the architecture spec's
minimum four tables — a registry/metadata layer the four core tables
reference via foreign key, not a replacement for them.

Row Level Security is enabled on all six tables with zero policies granted
to `anon`/`authenticated` — only the `service_role` key (used exclusively
server-side, see `lib/supabase/server.ts`) can access any of them.

## n8n workflows

Kept modular rather than one workflow (`n8n/workflows/`, matching
`WORKFLOW_BY_ACTION` in `lib/n8n/types.ts`). **Actually deployed** to a
real, connected n8n Cloud account (`vijaysharma04.app.n8n.cloud`) via the
n8n MCP server — not just exported JSON — currently inactive pending three
credentials (see `n8n/workflows/README.md`):

1. `ghl-contact-workflow` (`7fXGzZ3t5LDxmzEZ`) — `GET_CONTACT`, `UPDATE_CONTACT`
2. `ghl-opportunity-workflow` (`3x7is9oXX7zk5IB7`) — `GET_OPPORTUNITY`, `UPDATE_OPPORTUNITY`
3. `ghl-task-workflow` (`A50aS059Vd31QRz3`) — `CREATE_TASK`, `ADD_NOTE`
4. `execution-logger-workflow` (`l1AmbDI9rZG36jGx`) — shared sub-workflow
   the other three call (via n8n's Execute Sub-workflow node), using n8n's
   native Supabase node to write to `execution_logs`

Each of 1-3 follows: Webhook (header-auth) → validate input (Code node) →
branch on action type (If node) → call the matching verified GHL endpoint
→ call the Execution Logger sub-workflow → respond with structured JSON.

## Reliability

- **Timeouts + bounded retry**: `lib/http/fetch-with-retry.ts` wraps every
  real outbound call (GHL, n8n) with an `AbortController` timeout and one
  retry on network failure or 5xx — never on 4xx, since a caller error
  won't succeed on repeat.
- **Idempotency**: an optional `idempotencyKey` on `POST /api/execute`
  maps to a unique partial index on `automation_requests.idempotency_key`;
  a repeated call with the same key returns the original result instead of
  re-executing.
- **Structured errors**: every API route returns `{ ok: false, error: {
  type, message } }` with an appropriate status code (400 invalid input,
  404 not found, 409 conflict, 500 unexpected) rather than an unhandled
  exception or a bare stack trace.
- **Full audit trail**: every action and every execution attempt is a row
  in Supabase, independent of whether the overall request succeeded.
- **No adapter can wedge a request**: `n8n.execute()` is called inside a
  try/catch in `lib/orchestration/execute.ts`'s dispatch loop, on top of
  every `N8nClient` implementation already being expected to never throw.
  This is a real bug found and fixed in this project, not a hypothetical —
  see "Verified end-to-end run" above.

## Repository structure

```
app/
  page.tsx, components/         dashboard UI
  api/execute/                   POST — full pipeline
  api/requests/, requests/[id]/  GET — history / detail
  api/execution-logs/            GET
  api/agents/, agents/[id]/      GET+POST / PATCH
  api/integrations/, integrations/[id]/  GET+POST / PATCH
  api/contacts/                  GET+POST
  api/ghl/contacts/search/        GET — direct access to real contact search
lib/
  actions/allowlist.ts           the allowlist (source of truth)
  agent/                         AgentAdapter (openclaw-adapter.ts, mock-adapter.ts)
  n8n/                           N8nClient (client.ts incl. resolveContactId, validation.ts, types.ts)
  ghl/                           GhlClient (client.ts incl. searchContacts, types.ts)
  http/fetch-with-retry.ts       shared timeout + retry wrapper
  orchestration/execute.ts       THINK -> allowlist -> DO pipeline, contact ID override
  supabase/                      server.ts, browser.ts, types.ts, queries/
  types/domain.ts                shared application types
supabase/migrations/             SQL schema, four files, filename-ordered
n8n/workflows/                   importable n8n workflow JSON + setup guide
test/                            node:test suite for the mock pipeline + resolveContactId
```

## Security decisions

- GoHighLevel credentials live only in the GHL adapter (server-side) or,
  for a real n8n deployment, in n8n's own credential store — never in the
  agent layer, never reachable from the browser.
- Every adapter defaults to mock; reaching a real external system requires
  an explicit `*_ADAPTER` opt-in, not just a present credential.
- Supabase access is server-side only (service role key), guarded by the
  `server-only` package so an accidental client-side import fails at
  build time. Row Level Security is enabled on every table regardless,
  with no policies granted to `anon`/`authenticated`.
- n8n webhooks require a shared-secret header, checked by each workflow's
  webhook node.
- All secrets are referenced only via environment variables;
  `.env.example` contains placeholders only.
