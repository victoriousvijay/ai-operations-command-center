# AI Operations Command Center

A full-stack, agentic operations platform: a user gives a natural-language
instruction, an AI reasoning layer (OpenClaw) interprets it into a
constrained action plan, a deterministic workflow layer (n8n) executes it
against a real CRM (GoHighLevel), and every step is recorded in Supabase and
shown live on a Next.js dashboard.

See [`ARCHITECTURE.md`](./ARCHITECTURE.md) for the full system design.

## Status

**Live and verified end to end.** Supabase is a real, connected project
(schema applied, RLS enabled, zero advisory warnings beyond an intentional
deny-by-default policy gap) — not a placeholder. GoHighLevel is also real
and fully verified end to end, both reading and writing: the agent's
extracted contact name resolves through a real GHL contact search to a
real contact, then a real task is created against it (a 1120ms real
lookup, a 3182ms real write). The full pipeline — command input → agent
reasoning → allowlist validation → n8n dispatch → GoHighLevel → Supabase
audit log → dashboard — has been run for real against both, confirmed in
the dashboard and by direct SQL/API checks. Real n8n workflows are
deployed live to a connected n8n Cloud account, pending 3 credential
attachments on the n8n side — see
[`n8n/workflows/README.md`](./n8n/workflows/README.md). OpenClaw remains
mocked pending Gateway details; its real adapter is implemented and
verified against OpenClaw's docs, switching on with one environment
variable — see [What's mocked vs. connected](#whats-mocked-vs-actually-connected).

## What it does

Type a request like:

> "Move John Smith's opportunity to Qualified and create a follow-up task
> for tomorrow."

and the system:

1. Records the request in Supabase (`automation_requests`).
2. Asks the agent adapter to interpret it — intent (`CRM_UPDATE`) plus a
   plan of allowed actions (`UPDATE_OPPORTUNITY`, `CREATE_TASK`).
3. Re-validates every proposed action against a server-side allowlist,
   independent of whatever the agent already filtered.
4. For contact-touching actions, resolves the contact name/email the
   agent extracted into a real GoHighLevel contact ID via a live search —
   the agent only ever sees a name, never a real ID, so this step (mirroring
   the "Find Contact" stage in the architecture's own n8n workflow design)
   is what turns that into something GoHighLevel can act on. A real
   contact ID can also be supplied directly (dashboard override field, or
   `contactIdOverride` on the API) to skip resolution entirely.
5. Dispatches each validated, resolved action to the n8n execution layer,
   which validates the payload again and calls the GoHighLevel API.
6. Logs every execution (`execution_logs`) and updates each action's and
   the request's status in Supabase.
7. Returns a structured result the dashboard renders live.

## Architecture

```
USER
  → NEXT.JS DASHBOARD
  → NEXT.JS API ROUTES (validate, persist, orchestrate)
  → AGENT ADAPTER — OpenClaw or mock (THINK: intent + proposed actions)
  → ALLOWLIST CHECK (server-side, independent of the agent)
  → N8N ADAPTER — real n8n webhooks or mock (DO: validate + execute)
  → GOHIGHLEVEL API (contacts / opportunities / tasks / notes)
  → SUPABASE (automation_requests, automation_actions, execution_logs, contacts_cache, agents, integrations)
  → STRUCTURED RESULT → DASHBOARD
```

- **The agent (THINK)** decides *what* should happen. It is only ever
  offered six tools — the allowlist — so it cannot propose anything else,
  by construction. It never holds GHL, n8n, or Supabase credentials.
- **n8n (DO)** decides *how* it happens: payload validation, the actual
  GoHighLevel API calls, error handling, logging — as modular, per-domain
  workflows (`n8n/workflows/`).
- **GoHighLevel** is the external CRM. Its credentials live only in the
  GHL adapter (server-side) or, in the real n8n deployment, in n8n's own
  credential store — never in the agent layer, never in the browser.
- **Supabase** is the audit/state layer: every request, action, and
  execution is recorded, queryable, and shown in the dashboard.
- **Next.js** is both the dashboard and the backend; it never exposes any
  of the above credentials to the browser.

See [`ARCHITECTURE.md`](./ARCHITECTURE.md) for the full data model, the
adapter boundaries, and what was verified vs. assumed for each external
interface.

## Tech stack

Next.js (App Router) · React · TypeScript · Tailwind CSS · OpenClaw · n8n ·
Supabase/PostgreSQL · GoHighLevel API · Zod · Vercel

## Agent safety

The agent can only ever propose one of six actions: `GET_CONTACT`,
`GET_OPPORTUNITY`, `UPDATE_CONTACT`, `UPDATE_OPPORTUNITY`, `CREATE_TASK`,
`ADD_NOTE`. This is enforced twice, independently:

1. Only those six are ever advertised as callable tools to the agent
   (`lib/agent/openclaw-adapter.ts`) — it has no other tool to call.
2. The backend re-checks every proposed action against the same list
   (`lib/orchestration/execute.ts`) before it reaches n8n, regardless of
   what the agent adapter already did.

Destructive operations (`DELETE_CONTACT`, `DELETE_OPPORTUNITY`,
`BULK_DELETE`, `CHANGE_CREDENTIALS`) are not in the agent's reach at all —
not filtered, not rate-limited, simply never offered. If one is ever
needed, `automation_actions.status` already has a `pending_approval` value
reserved for an explicit propose → human-approve → execute gate; no such
action is wired to auto-execute today.

## Project structure

```
app/
  page.tsx                 dashboard (client component)
  components/               Dashboard, StatsRow, StatusBadge
  api/
    execute/                 POST — run the full pipeline for one request
    requests/, requests/[id]/  GET — history / single request detail
    execution-logs/           GET — execution log stream, optional ?requestId=
    agents/, agents/[id]/     GET+POST / PATCH — agent registry
    integrations/, integrations/[id]/  GET+POST / PATCH — integration registry
    contacts/                 GET+POST — contacts_cache read/upsert
lib/
  actions/allowlist.ts       the six allowed actions — single source of truth
  agent/                     AgentAdapter: openclaw-adapter.ts (real), mock-adapter.ts
  n8n/                       N8nClient: client.ts (real HTTP + mock), validation.ts
  ghl/                       GhlClient: client.ts (real HTTP + mock), types.ts
  http/fetch-with-retry.ts   shared timeout + bounded-retry fetch wrapper
  orchestration/execute.ts   the THINK → allowlist → DO pipeline
  supabase/                  server.ts, browser.ts, types.ts, queries/
  types/domain.ts            shared application types
supabase/migrations/         SQL schema, in the order they'd be applied
n8n/workflows/                importable n8n workflow JSON + setup guide
test/                         node:test suite for the mock pipeline
```

## Local development

Requires Node.js 20.9+ (developed against Node 24).

```bash
npm install
cp .env.example .env.local   # then fill in real values — see below
npm run dev
```

Runs at `http://localhost:3000`. With every `*_ADAPTER` left at its default
(`mock`), the full pipeline runs without any external account — you still
need a real Supabase project, since that's the persistence layer itself
(see [Supabase setup](#supabase)).

## Environment variables

See [`.env.example`](./.env.example) for the full list with inline
explanations, including how each one was verified. Summary:

| Variable | Where used | Required for |
|---|---|---|
| `AGENT_ADAPTER` | backend | `mock` (default) or `openclaw` |
| `OPENCLAW_GATEWAY_URL`, `OPENCLAW_GATEWAY_TOKEN` | backend only | real OpenClaw reasoning (`AGENT_ADAPTER=openclaw`) |
| `N8N_ADAPTER` | backend | `mock` (default) or `http` |
| `N8N_BASE_URL`, `N8N_WEBHOOK_SECRET` | backend + n8n | real n8n dispatch (`N8N_ADAPTER=http`) |
| `GHL_ADAPTER` | backend | `mock` (default) or `real` |
| `GHL_PRIVATE_INTEGRATION_TOKEN` | backend only | real GoHighLevel calls (`GHL_ADAPTER=real`) |
| `GHL_API_BASE_URL`, `GHL_API_VERSION` | backend only | pre-filled with verified values; override only if GoHighLevel changes them |
| `GHL_LOCATION_ID` | backend only | real contact search by name/email; direct-ID actions work without it |
| `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` | public (bundled to the browser) | reserved for a future client-side read path; unused today — RLS grants `anon` zero access |
| `SUPABASE_SERVICE_ROLE_KEY` | backend only | all persistence; bypasses RLS, never exposed to the client |

Every `*_ADAPTER` variable defaults to the safe/mock choice and requires an
explicit opt-in value to reach a real external system — a demo never
accidentally calls a live CRM or n8n instance just because a credential
happens to be present.

Only the two `NEXT_PUBLIC_` variables are ever bundled into client code —
by design, since the Supabase anon key is meant to be publishable and is
constrained by Row Level Security, not secrecy. Everything else is read
only in server-side code (enforced at build time by the `server-only`
package on every module that touches a credential). `.env.local` is
gitignored.

## Setup guides

### Supabase — done, connected project `wvifvkdwjxhxvzieloam`

All four migrations are applied to a live project (all six tables, RLS
enabled, seed `agents`/`integrations` rows present) and `.env.local` is
populated. `get_advisors` reports zero issues beyond the intentional
"RLS enabled, no policy" info-level notices (the deliberate deny-by-default
design — see ARCHITECTURE.md) and a platform-managed `rls_auto_enable`
function that ships with every Supabase project, not part of this schema.

To point this app at a different Supabase project instead:

1. Create a project at [supabase.com](https://supabase.com).
2. In the SQL Editor, run the four files in `supabase/migrations/` **in
   filename order**:
   - `20260830163243_init_schema.sql` — all six tables, indexes, RLS, seed agents
   - `20260830164642_add_intent_and_idempotency.sql` — adds `intent` and `idempotency_key`
   - `20260830170043_seed_integrations.sql` — seed integration rows
   - `20260830174600_harden_set_updated_at_search_path.sql` — pins the trigger function's `search_path`
3. From Project Settings → API, copy Project URL, `anon` key, and
   `service_role` key into `NEXT_PUBLIC_SUPABASE_URL`,
   `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`.

This is the one integration you cannot mock away — it's the persistence
layer itself, so a real Supabase project is required even to exercise the
mock agent/n8n/GHL pipeline end to end.

### n8n

Not required for local/demo use (`N8N_ADAPTER=mock` runs the same
validate → call GHL → log contract in-process). To connect a real
instance: see [`n8n/workflows/README.md`](./n8n/workflows/README.md) for
the four workflows to import, the two credentials to create, and exactly
which env vars flip `N8N_ADAPTER` to `http`.

### GoHighLevel — done, real Private Integration Token connected

`GHL_ADAPTER=real` is active with a working token, verified live against
`services.leadconnectorhq.com`. Direct-ID actions (given a real
contact/opportunity ID) work now. For the mock agent's synthesized IDs to
resolve to real contacts, also set `GHL_LOCATION_ID` (see `.env.example`
for where to find it) — or skip that and use the dashboard's manual
"Real GHL contact ID" override field to test against real data directly.
See [`lib/ghl/README.md`](./lib/ghl/README.md) for how the whole API
contract (base URL, headers, endpoint paths, and the contact-search
endpoint) was verified against the live API, including one assumption
that verification corrected (see "What was verified, and how").

To point this app at a different GHL sub-account instead: create a Private
Integration token scoped to one location, set
`GHL_PRIVATE_INTEGRATION_TOKEN` and `GHL_ADAPTER=real`.

### OpenClaw

Not required for local/demo use (`AGENT_ADAPTER=mock` runs a deterministic
keyword-based interpreter — see its documented limitations in
`lib/agent/mock-adapter.ts`). To connect a real Gateway: run
`openclaw onboard` (or point at a remote Gateway you control), set
`OPENCLAW_GATEWAY_URL`, `OPENCLAW_GATEWAY_TOKEN`, and `AGENT_ADAPTER=openclaw`.
See [`lib/agent/README.md`](./lib/agent/README.md) for exactly what was
verified against OpenClaw's docs vs. assumed from its "OpenResponses-
compatible" claim.

## Testing

```bash
npm run typecheck   # TypeScript strict-mode check
npm run lint        # ESLint (Next.js core-web-vitals + TypeScript rules)
npm run build       # production build
npm test            # node:test suite for the mock agent/n8n/GHL pipeline
```

`npm test` (9 tests) exercises real application code (not reimplemented
fixtures): it runs the architecture's canonical example request through
`MockAgentAdapter` and `MockN8nClient` (which itself calls `MockGhlClient`)
and asserts on the resulting actions; a payload-validation rejection case;
and five cases for `resolveContactId` (the real-contact-search resolution
step) against a fake `GhlClient`, covering both `GHL_ADAPTER` modes, a
successful resolution, a no-match error, and a no-hint error. It does not
require Supabase or live GHL credentials — everything requiring those
(`app/api/*`, `lib/orchestration/execute.ts`, `RealGhlClient` itself) is
verified via `typecheck`, `lint`, `build`, and manual testing against the
real, connected Supabase project and GoHighLevel sub-account (see
[What's mocked vs. actually connected](#whats-mocked-vs-actually-connected)).

## What's mocked vs. actually connected

| Layer | Default | Real implementation | Switch |
|---|---|---|---|
| Supabase | **Real, connected and verified** | `lib/supabase/server.ts` | always on; no mock exists (it's the persistence layer) |
| Agent (OpenClaw) | Mock | `lib/agent/openclaw-adapter.ts`, verified against OpenClaw's docs | `AGENT_ADAPTER=openclaw` |
| n8n | Mock (workflows **deployed live**, inactive pending 3 credentials — see `n8n/workflows/README.md`) | `lib/n8n/client.ts`'s `HttpN8nClient` + 4 real workflows in a connected n8n Cloud account | `N8N_ADAPTER=http` |
| GoHighLevel | **Real, connected and verified** | `lib/ghl/client.ts`'s `RealGhlClient`, authenticated with a real Private Integration token | `GHL_ADAPTER=real` |

## Deployment

Deploy to Vercel: connect the GitHub repository, set every environment
variable from `.env.example` (with real values) in the Vercel project's
Environment Variables settings — never in `vercel.json` or committed
config — and deploy. No build-time secrets are required (all env access is
lazy, inside request handlers), so a build succeeds even before Supabase
is configured; runtime requests will fail clearly until it is.

## Security considerations

- GoHighLevel credentials live only in the GHL adapter (server-side,
  guarded by the `server-only` package) or, for a real n8n deployment, in
  n8n's own credential store — never in the agent layer, never in the
  browser, never committed.
- Every `*_ADAPTER` defaults to mock; reaching a real external system
  requires an explicit opt-in value, not just a present credential.
- Supabase is accessed only from server-side code using the service role
  key. Row Level Security is enabled on every table with no policies
  granted to `anon`/`authenticated`, so the publishable anon key currently
  has zero read/write access even though it's bundled to the browser.
- n8n webhooks require a shared-secret header, validated per workflow.
- The agent's reachable action set is enforced in two independent places
  (tool schema + server-side re-check), not by configuration trust alone.
- Real HTTP adapters (GHL, n8n) use a shared fetch wrapper with a hard
  timeout and one bounded retry on 5xx/network failure — never on 4xx.
- `.env.example` contains placeholders only; real secrets are supplied via
  `.env.local` (gitignored) or your deployment platform's secret store.

## Example request

> "Move John Smith's opportunity to Qualified and create a follow-up task
> for tomorrow."

```json
{
  "ok": true,
  "requestId": "b6e1...",
  "status": "success",
  "intent": "CRM_UPDATE",
  "actions": [
    { "type": "UPDATE_OPPORTUNITY", "status": "success" },
    { "type": "CREATE_TASK", "status": "success" }
  ]
}
```

## Troubleshooting

- **"Missing required environment variable: NEXT_PUBLIC_SUPABASE_URL"** —
  expected until a real Supabase project is configured; every DB-backed
  route fails clearly with this rather than hanging or crashing silently.
- **`AGENT_ADAPTER=openclaw` but requests fail with an "Unexpected OpenClaw
  response shape" error** — the live Gateway's response envelope didn't
  match the assumed OpenResponses shape; see the verification note in
  `lib/agent/README.md` and adjust `lib/agent/openclaw-adapter.ts`'s
  parsing.
- **n8n workflow returns 401** — the Header Auth credential's value doesn't
  match `N8N_WEBHOOK_SECRET`, or (for the GHL-facing nodes) the GoHighLevel
  token credential is missing/expired.
- **GHL calls fail with a version-related error** — GoHighLevel may have
  revised the `Version` header value; update `GHL_API_VERSION`.
- **"GHL_LOCATION_ID is not configured — contact search requires it"** —
  with `GHL_ADAPTER=real`, a contact-touching action whose ID the agent
  synthesized (e.g. `mock-contact-john-smith`) tried to resolve a real
  contact by name/email and couldn't, because `GHL_LOCATION_ID` isn't set.
  Set it, or use the dashboard's manual "Real GHL contact ID" override to
  bypass lookup entirely for that request. This is intentionally a
  specific, actionable error — never a bare "contact not found," which
  would wrongly read as a real data problem instead of a config gap.
- **"No GoHighLevel contact found matching \"...\""** — `GHL_LOCATION_ID`
  is set and the search ran for real, but no contact in that location
  matched the name/email the agent extracted from the request text. Use
  the manual override with a real contact ID, or rephrase the request with
  a name/email that exists in that GHL location.
